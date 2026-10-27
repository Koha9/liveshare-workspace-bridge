#!/usr/bin/env node
'use strict';
// Self-contained: this file is also distributed as the Codex skill client.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const registry = path.join(os.homedir(), '.liveshare-local', 'instances');
const MAX_REQUEST = 2 * 1024 * 1024, MAX_RESPONSE = 4 * 1024 * 1024;
const STARTUP_CODES=['execution_policy_related_startup_block','shell_executable_not_found','helper_start_failed','helper_startup_failed','ipc_access_setup_failed','ipc_helper_exited','helper_stderr_observed'];
const STARTUP_STAGES=['access_setup','account_enumeration','process_start','helper_startup','ipc_runtime','unknown'];
const POLICY_VALUES=['Restricted','AllSigned','RemoteSigned','Unrestricted','Bypass','Undefined','Default','unknown'];
const oneOf=(value,values,fallback='unknown')=>values.includes(value)?value:fallback;
const safeVersion=value=>typeof value==='string'&&/^\d{1,4}(?:\.\d{1,8}){1,4}$/u.test(value)?value:'unknown';
const safeTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const safeAttempt=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/u.test(value)?value:null;
function projectStartupRecord(value) {
  if(!value||value.producer!=='lswb-startup-v1'||value.schemaVersion!==1||!Number.isSafeInteger(value.pid)||value.pid<1||!safeTime(value.observedAt))return null;
  const current=value.current||{},shell=value.shell||{};
  const events=(Array.isArray(value.events)?value.events:[]).slice(-8).map(e=>({code:oneOf(e.code,STARTUP_CODES,'helper_stderr_observed'),stage:oneOf(e.stage,STARTUP_STAGES),requestedExecutableName:oneOf(e.requestedExecutableName,['powershell.exe','pwsh.exe','other']),confidence:oneOf(e.confidence,['high','low','unknown']),firstSeen:safeTime(e.firstSeen),lastSeen:safeTime(e.lastSeen),attemptId:safeAttempt(e.attemptId),firstAttemptId:safeAttempt(e.firstAttemptId),count:Number.isSafeInteger(e.count)?Math.min(1000,Math.max(1,e.count)):1,historical:e.historical===true,encodingReplacementObserved:e.encodingReplacementObserved===true}));
  return {producer:'lswb-startup-v1',schemaVersion:1,pid:value.pid,extensionVersion:typeof value.extensionVersion==='string'&&/^\d+\.\d+\.\d+$/u.test(value.extensionVersion)?value.extensionVersion:'unknown',observedAt:safeTime(value.observedAt),origin:{component:current.stage==='account_enumeration'?'guest_local_account_enumeration_helper':current.stage==='access_setup'?'guest_local_bridge_access_setup':'guest_local_ipc_helper',side:'guest',location:'local'},current:{health:oneOf(current.health,['starting','failed','ready','stopped']),stage:oneOf(current.stage,STARTUP_STAGES),attemptId:typeof current.attemptId==='string'&&/^[a-f0-9-]{36}$/u.test(current.attemptId)?current.attemptId:null,epoch:Number.isSafeInteger(current.epoch)&&current.epoch>=0?current.epoch:null},shell:{requestedExecutableName:oneOf(shell.requestedExecutableName,['powershell.exe','pwsh.exe','other']),actualExecutableName:oneOf(shell.actualExecutableName,['powershell.exe','pwsh.exe']),version:safeVersion(shell.version),edition:oneOf(shell.edition,['Desktop','Core']),effectiveExecutionPolicy:oneOf(shell.effectiveExecutionPolicy,POLICY_VALUES),policyScopes:Object.fromEntries(['MachinePolicy','UserPolicy','Process','CurrentUser','LocalMachine'].map(k=>[k,oneOf(shell.policyScopes?.[k],POLICY_VALUES)])),metadataSource:oneOf(shell.metadataSource,['requested_only','helper_ready']),actualIdentity:'unknown',externalProbeIdentity:'unknown',identityComparison:'unknown'},events};
}
function readStartupDiagnostics(options={}) {
  const disk=options.fsImpl||fs,directory=options.directory||path.join(path.dirname(registry),'startup-diagnostics');
  const records=[],issues=[];let names;
  try{if(disk.lstatSync(directory).isSymbolicLink())return{status:'unsafe_directory',records,issues};names=disk.readdirSync(directory).filter(x=>/^[1-9]\d{0,9}\.json$/u.test(x));}
  catch(e){return{status:e.code==='ENOENT'?'missing':['EPERM','EACCES'].includes(e.code)?'denied':'unavailable',records,issues};}
  const limited=names.length>32;
  for(const name of names.slice(0,32))try{
    const file=path.join(directory,name),stat=disk.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>16384){issues.push({code:'invalid_startup_record'});continue;}
    const record=projectStartupRecord(JSON.parse(disk.readFileSync(file,'utf8')));if(!record||String(record.pid)+'.json'!==name){issues.push({code:'invalid_startup_record'});continue;}
    const age=(options.now??Date.now())-Date.parse(record.observedAt);if(age>86400000||age< -300000)continue;
    records.push(record);
  }catch(e){issues.push({code:['EPERM','EACCES'].includes(e.code)?'startup_record_denied':'invalid_startup_record'});}
  return{status:'read',records,issues,truncated:limited};
}
function transportError(message, sent) {
  return Object.assign(new Error(message), { code: sent ? 'transport_outcome_unknown' : 'transport_unavailable', requestSent: sent });
}
function requestOnce(instance, body, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_REQUEST) { reject(Object.assign(new Error('Request exceeds 2 MiB.'), { code: 'request_limit' })); return; }
    const socket = net.createConnection(`\\\\.\\pipe\\${instance.pipeName}`);
    let buffer = '', bytes = 0, sent = false, done = false;
    const finish = (err, result) => {
      if (done) return; done = true; clearTimeout(timer); socket.destroy();
      if (err) reject(err); else resolve(result);
    };
    const timer = setTimeout(() => finish(transportError('IPC timeout. If requestSent=true, inspect state before retrying a mutation.', sent)), timeoutMs);
    socket.setEncoding('utf8');
    socket.once('connect', () => { sent = true; socket.write(serialized + '\n'); });
    socket.on('data', data => {
      bytes += Buffer.byteLength(data, 'utf8');
      if (bytes > MAX_RESPONSE) { finish(transportError('IPC response exceeds 4 MiB; operation outcome may be unknown.', sent)); return; }
      buffer += data;
      const end = buffer.indexOf('\n');
      if (end >= 0) {
        try { finish(null, JSON.parse(buffer.slice(0, end))); }
        catch { finish(transportError('Invalid IPC reply; operation outcome may be unknown.', sent)); }
      }
    });
    socket.once('error', err => finish(Object.assign(transportError(err.message, sent), { transportCode: err.code })));
    socket.once('close', () => { if (!done) finish(transportError('IPC closed without a reply.', sent)); });
  });
}
async function request(instance, body, timeoutMs = 60000) {
  const deadline = Date.now() + Math.min(1500, timeoutMs);
  for (;;) {
    try { return await requestOnce(instance, body, timeoutMs); }
    catch (err) {
      // Retry only before connecting/sending. Never repeat a request with an uncertain outcome.
      if (err.requestSent === false && ['EBUSY', 'EPIPE', 'ENOENT', 'ECONNREFUSED'].includes(err.transportCode) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 75));
      else throw err;
    }
  }
}
function inspectRecords(options = {}) {
  const location = options.registryPath || registry, disk = options.fsImpl || fs;
  let names;
  try { names = disk.readdirSync(location); }
  catch (err) { return { registry: { path: location, status: err.code === 'ENOENT' ? 'missing' : ['EACCES','EPERM'].includes(err.code) ? 'denied' : 'unavailable' }, records: [], issues: err.code === 'ENOENT' ? [] : [{ stage: 'registry', code: err.code || 'registry_unavailable' }] }; }
  const result = [], issues = [];
  for (const name of names.filter(x => /^[0-9a-f-]+\.json$/u.test(x))) {
    try {
      const entry = JSON.parse(disk.readFileSync(path.join(location, name), 'utf8'));
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !/^[0-9a-f-]+$/u.test(entry.id) || !/^liveshare-local-\d+-[0-9a-f-]+$/u.test(entry.pipeName)) throw Object.assign(new Error('Invalid instance record.'), { code: 'invalid_record' });
      result.push(entry);
    } catch (err) { issues.push({ stage: 'record', record: name, code: err.code || 'invalid_record' }); }
  }
  return { registry: { path: location, status: 'ready' }, records: result, issues };
}
function records() {
  const inspected = inspectRecords();
  if (['denied','unavailable'].includes(inspected.registry.status)) throw Object.assign(new Error('Cannot read the bridge instance registry. Run diagnose for details.'), { code: 'discovery_access_failed', details: inspected });
  return inspected.records;
}
async function discover(options = {}) {
  const inspected = inspectRecords(options), found = [], probes = [], probe = options.probe || request;
  for (const entry of inspected.records) {
    try {
      const response = await probe(entry, { op: 'info', instance: entry.id }, options.timeoutMs || 2000);
      if (!response.ok || response.result?.id !== entry.id || !Array.isArray(response.result?.roots)) {
        probes.push({ id: entry.id, status: 'invalid_response', code: response.error?.code || 'instance_identity_mismatch' }); continue;
      }
      found.push({ ...entry, epoch: response.result.epoch, roots: response.result.roots, info: response.result });
      probes.push({ id: entry.id, status: 'connected', rootCount: response.result.roots.length });
    } catch (err) {
      probes.push({ id: entry.id, status: ['EPERM','EACCES'].includes(err.transportCode || err.code) ? 'denied' : err.transportCode === 'ENOENT' ? 'stale' : 'unreachable', code: err.code || 'probe_failed', ...(err.transportCode ? { transportCode: err.transportCode } : {}), ...(err.requestSent !== undefined ? { requestSent: err.requestSent } : {}) });
    }
  }
  const denied = inspected.registry.status === 'denied' || inspected.issues.some(x => ['EPERM','EACCES'].includes(x.code)) || probes.some(x => x.status === 'denied');
  const hasRoots = found.some(x => x.roots.length);
  const failures = inspected.issues.length + probes.filter(x => x.status !== 'connected').length;
  const status = hasRoots ? failures ? 'partial' : 'ready' : denied ? 'access_denied' : found.length ? 'no_shared_workspace' : inspected.records.length ? 'unavailable' : inspected.issues.length || inspected.registry.status === 'unavailable' ? 'invalid_registry' : 'no_records';
  const startupDiagnostics=options.fsImpl&&!options.startupDirectory?{status:'not_checked',records:[],issues:[]}:readStartupDiagnostics({directory:options.startupDirectory||path.join(path.dirname(inspected.registry.path),'startup-diagnostics'),fsImpl:options.startupFsImpl,now:options.now});
  startupDiagnostics.records=startupDiagnostics.records.map(record=>{const live=found.find(x=>x.pid===record.pid);return{...record,probeCorrelation:live?'ipc_connected':'not_verified',currentFailureConfirmed:false,events:record.events.map(e=>({...e,historical:!!live||record.current.health==='ready'||e.historical}))};});
  return { readOnly: true, registry: inspected.registry, recordCount: inspected.records.length, status, instances: found, probes, issues: inspected.issues, startupDiagnostics };
}
function diagnosticReport(report) {
  return { ...report, instances: report.instances.map(({id,epoch,version,pid,roots,ipc}) => ({id,epoch,version,pid,roots,ipc})) };
}
async function instances() {
  const report = await discover();
  if (['access_denied','unavailable','invalid_registry'].includes(report.status)) throw Object.assign(new Error('Bridge discovery failed; this is not a verified empty workspace list. Run diagnose. For EPERM/EACCES ask the user to review Configure IPC Access and the selected local account SIDs; never change permissions automatically.'), { code: report.status === 'access_denied' ? 'discovery_access_denied' : 'discovery_unavailable', details: diagnosticReport(report) });
  return report.instances;
}
function unsuccessful(response, op) {
  if (!response.ok) return true;
  const r = response.result;
  if (op === 'hostJobCancel') return !['cancelled','completed'].includes(r?.state);
  return r?.applied === false && !(r?.checked && r?.checkOnly) || r?.saved === false || r?.dirty === true && r?.applied === true || r?.files?.some(x => x.ok === false || x.saved === false) || ['timed_out','cancelled'].includes(r?.state) || r?.state === 'completed' && r?.exitCode !== undefined && !(['search','findFiles'].includes(op) ? [0,1].includes(r.exitCode) : r.exitCode === 0);
}
async function selected(body, options) {
  const chosen = options.instance || body.instance;
  if (chosen && body.op !== 'info' && body.epoch === undefined && options.epoch === undefined) throw new Error('Pin --epoch from instances along with --instance to avoid following a changed workspace.');
  const candidates = chosen ? records().filter(x=>x.id===chosen) : (await instances()).filter(x=>x.roots.length);
  if(candidates.length!==1)throw new Error(`Expected one instance, found ${candidates.length}. Run instances and explicitly select the intended window.`);
  const instance=candidates[0];
  const base={instance:instance.id,epoch:body.epoch??(options.epoch===undefined?instance.epoch:Number(options.epoch)),workspace:body.workspace??options.workspace};
  if(body.op!=='info'&&!base.workspace)throw new Error('Set workspace to an exact root URI returned by instances.');
  return {instance,base};
}
async function transferClient(mode, options) {
  if(!options.path)throw new Error('--path is required.');
  const {instance,base}=await selected({op:mode},options);
  let transferId, temporary, inputHandle;
  let lastProgress=0;
  const progress=(bytes,total)=>{if(options.progress&&(bytes===total||Date.now()-lastProgress>=1000)){lastProgress=Date.now();process.stderr.write(`${mode}: ${bytes}/${total} bytes\n`);}};
  const call=async body=>{const reply=await request(instance,{...base,...body});if(!reply.ok)throw Object.assign(new Error(reply.error.message),{code:reply.error.code,details:reply.error.details});return reply.result;};
  try {
    if(mode==='upload'){
      if(!options.input)throw new Error('--input is required.');
      inputHandle=fs.openSync(options.input,'r');const initial=fs.fstatSync(inputHandle);if(!initial.isFile())throw new Error('Upload input must be a file.');
      const begin=await call({op:'transferBeginWrite',path:options.path,size:initial.size,overwrite:options.overwrite===true,expectedCurrentSha256:options['expected-current-sha256']});transferId=begin.transferId;
      const hash=crypto.createHash('sha256'), buffer=Buffer.alloc(begin.chunkBytes);let total=0,sequence=0;
      for(;;){const count=fs.readSync(inputHandle,buffer,0,buffer.length,null);if(!count)break;hash.update(buffer.subarray(0,count));await call({op:'transferWrite',transferId,sequence:sequence++,base64:buffer.subarray(0,count).toString('base64')});total+=count;progress(total,initial.size);}
      const current=fs.fstatSync(inputHandle);if(current.size!==initial.size||current.mtimeMs!==initial.mtimeMs||total!==initial.size)throw new Error('Local upload source changed during transfer.');
      const sha256=hash.digest('hex');const result=await call({op:'transferCommit',transferId,sha256});transferId=null;
      if(result.sha256!==sha256||!result.written)throw new Error('Host upload acknowledgement failed integrity validation; inspect the target.');
      return {ok:true,result:{...result,path:options.path,bytes:total}};
    }
    if(!options.output)throw new Error('--output is required.');
    if(/^(?:vsls|file):/iu.test(options.output))throw new Error('Download output must be a local filesystem path.');
    const output=path.resolve(options.output);if(!options.overwrite&&fs.existsSync(output))throw new Error('Local destination already exists.');
    temporary=output+'.lswb-'+crypto.randomUUID()+'.part';const handle=fs.openSync(temporary,'wx');
    let total=0,verifiedSha256;const hash=crypto.createHash('sha256');
    try{
      const begin=await call({op:'transferOpenRead',path:options.path});transferId=begin.transferId;
      for(;;){const chunk=await call({op:'transferRead',transferId,offset:total,count:begin.chunkBytes});const data=Buffer.from(chunk.base64,'base64');if(chunk.offset!==total||chunk.nextOffset!==total+data.length||data.length>begin.chunkBytes||(!data.length&&!chunk.complete))throw new Error('Invalid download chunk offset.');let written=0;while(written<data.length)written+=fs.writeSync(handle,data,written,data.length-written,null);hash.update(data);total+=data.length;progress(total,begin.size);if(chunk.complete){verifiedSha256=hash.digest('hex');if(total!==begin.size||verifiedSha256!==chunk.sha256)throw new Error('Download SHA-256 mismatch.');break;}}
    }finally{fs.closeSync(handle);}
    await call({op:'transferAbort',transferId});transferId=null;
    if(options.overwrite)fs.renameSync(temporary,output);
    else {fs.copyFileSync(temporary,output,fs.constants.COPYFILE_EXCL);fs.unlinkSync(temporary);}
    temporary=null;return {ok:true,result:{downloaded:true,path:options.path,output,bytes:total,sha256:verifiedSha256}};
  }finally{
    if(inputHandle!==undefined)fs.closeSync(inputHandle);
    if(transferId)try{await call({op:'transferAbort',transferId});}catch{}
    if(temporary)try{fs.unlinkSync(temporary);}catch{}
  }
}
async function main() {
  const args = process.argv.slice(2), options = {};
  if (args.length === 1 && args[0] === 'diagnose') { const report = await discover(); process.stdout.write(JSON.stringify({ ok: report.instances.some(x=>x.roots.length), result: diagnosticReport(report) }, null, 2)+'\n'); if (!report.instances.some(x=>x.roots.length)) process.exitCode=1; return; }
  const mode=['upload','download','apply-patch'].includes(args[0])?args.shift():null;
  while (args.length) {
    const key = args.shift();
    if (key === 'instances') { process.stdout.write(JSON.stringify(await instances(), null, 2) + '\n'); return; }
    if (key === '--help') { process.stdout.write('instances | diagnose (read-only discovery diagnostics) | [--instance ID --epoch N --workspace URI] [--request FILE]\nupload --input LOCAL --path SHARED [--overwrite --expected-current-sha256 HASH]\ndownload --path SHARED --output LOCAL [--overwrite] (unavailable in v0.2)\napply-patch --input LOCAL.patch [--check-only]\nPin instance/epoch/workspace on all operations. JSON from stdin when --request is omitted.\n'); return; }
    if(['--overwrite','--check-only','--progress'].includes(key)){options[key.slice(2)]=true;continue;}
    if (!['--instance', '--workspace', '--request', '--epoch','--input','--output','--path','--expected-current-sha256'].includes(key) || !args.length) throw new Error(`Unknown or incomplete option: ${key}`);
    options[key.slice(2)] = args.shift();
  }
  if(mode==='upload'||mode==='download'){const response=await transferClient(mode,options);process.stdout.write(JSON.stringify(response,null,2)+'\n');return;}
  if(mode==='apply-patch'&&!options.input)throw new Error('--input is required.');
  const raw = mode==='apply-patch' ? JSON.stringify({op:'applyPatch',patch:fs.readFileSync(options.input,'utf8').replace(/^\uFEFF/u,''),checkOnly:options['check-only']===true}) : fs.readFileSync(options.request || 0, 'utf8').replace(/^\uFEFF/u, '');
  if (Buffer.byteLength(raw, 'utf8') > MAX_REQUEST) throw new Error('Request exceeds 2 MiB.');
  const body = JSON.parse(raw);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Request must be an object.');
  const {instance,base}=await selected(body,options);
  const response = await request(instance, {...body,...base});
  process.stdout.write(JSON.stringify(response, null, 2) + '\n');
  if (unsuccessful(response,body.op)) process.exitCode = 1;
}
if (require.main === module) main().catch(err => { process.stdout.write(JSON.stringify({ ok: false, error: { code: err.code || 'client_error', message: err.message, ...(err.details !== undefined ? { details: err.details } : {}), ...(err.requestSent !== undefined ? { requestSent: err.requestSent } : {}) } }, null, 2) + '\n'); process.exitCode = 1; });
module.exports = { request, instances, records, inspectRecords, discover, diagnosticReport, unsuccessful, transferClient, projectStartupRecord, readStartupDiagnostics };
