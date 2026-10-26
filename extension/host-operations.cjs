'use strict';
const crypto = require('node:crypto');
const { fail, integer } = require('./core.cjs');
const { patchPaths } = require('./patch.cjs');
const OPERATIONS = ['hostStatus','hostBind','hostStat','copy','copyDirectory','search','findFiles','applyPatch','readBytes','writeBytes','hostExec','hostJobPoll','hostJobCancel','hostJobForget','transferOpenRead','transferBeginWrite','transferRead','transferWrite','transferCommit','transferAbort'];
function base64Bytes(value, limit) {
  if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) fail('invalid_base64', 'Use canonical base64 within the configured chunk size.');
  const data = Buffer.from(value, 'base64'); if (data.length > limit) fail('chunk_limit', 'Chunk exceeds configured limit.'); return data;
}
function patterns(value, name) {
  if (value === undefined || value === '') return [];
  const result = Array.isArray(value) ? value : [value];
  if (result.length > 100 || result.some(x => typeof x !== 'string' || x.length > 4096 || /[\x00-\x1f]/u.test(x))) fail('invalid_argument', `${name} must be a glob or array of at most 100 globs.`);
  return result;
}
function createHostOperations({ vscode, host, permissions, resolve, rejectDirty, noteExternalChange }) {
  async function dispatch(r) {
    const { root } = resolve(r, '', true), uri = root.uri;
    if (r.op === 'hostStatus') return host.status(uri);
    permissions.assert(r.op);
    if (r.op === 'hostBind') return host.bind(uri, r);
    const request = action => host.request(uri, r.op, action);
    const limit = permissions.value('transfer.chunkBytes', 32768);
    const path = () => { const result = resolve(r, r.path); return result.uri; };
    const parentOption = () => { if (r.parents === true) permissions.assert('mkdir'); return r.parents !== false && permissions.enabled('mkdir'); };
    if (r.op === 'hostStat') { const target=path(); if (r.withHash) permissions.assert('readBytes'); if(r.withTextHash)permissions.assert('read');const refreshed=r.withTextHash?noteExternalChange(target,uri):null;const result=await request({ action:'stat',path:r.path,withHash:r.withHash === true,inspectTextPaths:refreshed?.paths });if(refreshed)refreshed(result.textStates);return result; }
    if (r.op === 'search' || r.op === 'findFiles') {
      const args = { action:r.op, include:patterns(r.op === 'findFiles' ? r.pattern : r.include,'include'),exclude:patterns(r.exclude,'exclude'),useExcludes:r.useExcludes !== false, limit:integer(r.limit ?? 500,'limit',1,10000) };
      if (r.op === 'search') {
        if (typeof r.query !== 'string' || !r.query || r.query.length > 10000) fail('invalid_query','query must contain 1..10000 characters.');
        Object.assign(args,{query:r.query,regex:r.regex === true,caseSensitive:r.caseSensitive === true,wholeWord:r.wholeWord === true});
      }
      const result = await request(args);
      return { ...result, unsavedDocuments:vscode.workspace.textDocuments.filter(d=>d.uri.scheme===uri.scheme && d.uri.authority===uri.authority && d.isDirty).map(d=>d.uri.toString()), warning:'Host results cover saved disk files. Dirty buffers are not saved or merged into these results.' };
    }
    if (r.op === 'copy' || r.op === 'copyDirectory') {
      if(r.op==='copyDirectory'&&r.overwrite===true)fail('not_supported','Directory copies require a new destination; merge/recursive replacement is not provided.');
      const source=path(), destination=resolve(r,r.to).uri;
      if(source.toString()===destination.toString())fail('invalid_destination','Source and destination must differ.');
      rejectDirty(source);rejectDirty(destination);if(r.overwrite)permissions.assert('write');
      const refreshed=noteExternalChange(destination,uri);const result=await request({action:r.op==='copy'?'copyFile':'copyDirectory',path:r.path,to:r.to,overwrite:r.overwrite===true,parents:parentOption(),inspectTextPaths:refreshed.paths});
      refreshed(result.textStates);return {...result,from:source.toString(),to:destination.toString()};
    }
    if(r.op==='readBytes'){const source=path();const result=await request({action:'readBytes',path:r.path});const data=base64Bytes(result.base64,limit);if(data.length!==result.bytes||crypto.createHash('sha256').update(data).digest('hex')!==result.sha256)fail('host_transfer_integrity','Host byte read failed integrity validation.');return {...result,uri:source.toString(),scope:'saved_host_file'};}
    if(r.op==='writeBytes'){
      const target=path();rejectDirty(target);const data=base64Bytes(r.base64,limit);
      if(r.overwrite)permissions.assert('write');
      const refreshed=noteExternalChange(target,uri);const result=await request({action:'writeBytes',path:r.path,base64:r.base64,size:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex'),overwrite:r.overwrite===true,expectedCurrentSha256:r.expectedCurrentSha256,parents:parentOption(),inspectTextPaths:refreshed.paths});
      refreshed(result.textStates);return {...result,uri:target.toString()};
    }
    if(r.op==='applyPatch'){
      for(const permission of ['edit','create','delete','move'])permissions.assert(permission);
      const paths=patchPaths(r.patch);for(const filename of paths)rejectDirty(resolve(r,filename).uri);
      const refreshed=r.checkOnly===true?[]:paths.map(filename=>noteExternalChange(resolve(r,filename).uri,uri));
      const result=await request({action:'applyPatch',patch:r.patch,paths,checkOnly:r.checkOnly===true,inspectTextPaths:refreshed.flatMap(f=>f.paths)});
      for(const finish of refreshed)finish(result.textStates);
      return result;
    }
    if(r.op==='hostExec'){
      if(typeof r.command!=='string'||!r.command||r.command.length>8000)fail('invalid_argument','command must contain 1..8000 characters.');
      resolve(r,r.cwd??'',true);
      const waitMs=integer(r.waitMs??1000,'waitMs',0,5000), timeoutMs=integer(r.timeoutMs??permissions.value('terminal.commandTimeoutMs',120000),'timeoutMs',1000,3600000);
      const affected=r.affectedPaths??[];if(!Array.isArray(affected)||affected.length>100)fail('invalid_argument','affectedPaths must contain at most 100 relative paths.');
      const refreshed=affected.map(filename=>{const target=resolve(r,filename).uri;rejectDirty(target);return noteExternalChange(target,uri);});
      const result=await request({action:'startJob',command:r.command,cwd:r.cwd??'',timeoutMs,waitMs,inspectTextPaths:refreshed.flatMap(f=>f.paths)});
      const completed=result.state!=='running';if(completed)for(const finish of refreshed)finish(result.textStates);
      host.jobs.set(result.jobId,{key:host.key(uri),refreshed,completed});return {...result,fileChanges:affected.length?'declared_paths':'not_tracked'};
    }
    if(['hostJobPoll','hostJobCancel','hostJobForget'].includes(r.op)){
      const entry=host.resource(host.jobs,r.jobId,uri);
      if(r.op==='hostJobForget'&&entry.refreshed?.length&&!entry.completed)fail('job_result_required','Poll the final job result before forgetting a command with affectedPaths.');
      const action=r.op==='hostJobPoll'?'pollJob':r.op==='hostJobCancel'?'cancelJob':'forgetJob';
      const result=await request({action,jobId:r.jobId,waitMs:integer(r.waitMs??0,'waitMs',0,5000),stdoutOffset:integer(r.stdoutOffset??0,'stdoutOffset',0,2147483647),stderrOffset:integer(r.stderrOffset??0,'stderrOffset',0,2147483647),inspectTextPaths:entry.completed?[]:entry.refreshed?.flatMap(f=>f.paths)});
      if(result.state&&result.state!=='running'&&!entry.completed){for(const finish of entry.refreshed||[])finish(result.textStates);entry.completed=true;}
      if(r.op==='hostJobForget')host.jobs.delete(r.jobId);return result;
    }
    if(r.op==='transferOpenRead'){
      permissions.assert('readBytes');const source=path();const result=await request({action:'openRead',path:r.path});host.transfers.set(result.transferId,{key:host.key(uri),type:'read',path:r.path,uri:source});return result;
    }
    if(r.op==='transferBeginWrite'){
      permissions.assert('writeBytes');const target=path();rejectDirty(target);if(r.overwrite)permissions.assert('write');
      if(!Number.isSafeInteger(r.size)||r.size<0)fail('invalid_argument','size must be a nonnegative safe integer.');
      const result=await request({action:'beginWrite',path:r.path,size:r.size,overwrite:r.overwrite===true,expectedCurrentSha256:r.expectedCurrentSha256,parents:parentOption()});host.transfers.set(result.transferId,{key:host.key(uri),type:'write',path:r.path,uri:target,overwrite:r.overwrite===true});return result;
    }
    if(r.op.startsWith('transfer')){
      const entry=host.resource(host.transfers,r.transferId,uri);
      permissions.assert(entry.type==='read'?'readBytes':'writeBytes');
      if(r.op==='transferAbort'){
        const result=await request({action:'abortTransfer',transferId:r.transferId});host.transfers.delete(r.transferId);return result;
      }
      if(r.op==='transferRead'){
        if(entry.type!=='read')fail('transfer_type','This is not a download.');
        if(!Number.isSafeInteger(r.offset)||r.offset<0)fail('invalid_argument','offset must be a nonnegative safe integer.');
        return request({action:'readChunk',transferId:r.transferId,offset:r.offset,count:integer(r.count??limit,'count',1,limit)});
      }
      if(entry.type!=='write')fail('transfer_type','This is not an upload.');rejectDirty(entry.uri);
      if(r.op==='transferWrite'){base64Bytes(r.base64,limit);return request({action:'writeChunk',transferId:r.transferId,sequence:integer(r.sequence,'sequence',0,2147483647),base64:r.base64});}
      if(r.op==='transferCommit'){
        if(entry.overwrite)permissions.assert('write');
        if(!/^[a-f0-9]{64}$/iu.test(r.sha256))fail('invalid_argument','sha256 must contain 64 hexadecimal characters.');
        const refreshed=noteExternalChange(entry.uri,uri);const result=await request({action:'commitWrite',transferId:r.transferId,path:entry.path,sha256:r.sha256,overwrite:entry.overwrite,inspectTextPaths:refreshed.paths});host.transfers.delete(r.transferId);refreshed(result.textStates);return result;
      }
    }
    fail('unknown_operation','Unknown Host operation.');
  }
  return {dispatch};
}
module.exports={OPERATIONS,createHostOperations,base64Bytes,patterns};
