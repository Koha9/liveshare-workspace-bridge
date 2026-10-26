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
function records() {
  let names;
  try { names = fs.readdirSync(registry); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  const result = [];
  for (const name of names.filter(x => /^[0-9a-f-]+\.json$/u.test(x))) {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(registry, name), 'utf8'));
      if (/^[0-9a-f-]+$/u.test(entry.id) && /^liveshare-local-\d+-[0-9a-f-]+$/u.test(entry.pipeName)) result.push(entry);
    } catch {} // Ignore incomplete or stale records; discovery below checks server identity.
  }
  return result;
}
async function instances() {
  const found = [];
  for (const entry of records()) {
    try {
      const response = await request(entry, { op: 'info', instance: entry.id }, 2000);
      if (response.ok && response.result.id === entry.id) found.push({ ...entry, epoch: response.result.epoch, roots: response.result.roots, info: response.result });
    } catch {}
  }
  return found;
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
  const mode=['upload','download','apply-patch'].includes(args[0])?args.shift():null;
  while (args.length) {
    const key = args.shift();
    if (key === 'instances') { process.stdout.write(JSON.stringify(await instances(), null, 2) + '\n'); return; }
    if (key === '--help') { process.stdout.write('instances | [--instance ID --epoch N --workspace URI] [--request FILE]\nupload --input LOCAL --path SHARED [--overwrite --expected-current-sha256 HASH]\ndownload --path SHARED --output LOCAL [--overwrite]\napply-patch --input LOCAL.patch [--check-only]\nPin instance/epoch/workspace on all operations. JSON from stdin when --request is omitted.\n'); return; }
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
module.exports = { request, instances, records, unsuccessful, transferClient };
