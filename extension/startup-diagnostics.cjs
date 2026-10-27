'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const{StringDecoder}=require('node:string_decoder');
const{projectStartupRecord}=require('./cli.cjs');
function classifyStartupStderr(text){return /about_Execution_Policies/iu.test(text)&&/UnauthorizedAccess|PSSecurityException/iu.test(text)?'execution_policy_related_startup_block':'helper_stderr_observed';}
function createStartupJournal({directory,pid,version,log=()=>{},now=Date.now}){
 let disposed=false,writeWarning=false;const filename=path.join(directory,pid+'.json');
 let record={producer:'lswb-startup-v1',schemaVersion:1,pid,extensionVersion:version,observedAt:new Date(now()).toISOString(),current:{health:'stopped',stage:'unknown',attemptId:null,epoch:null},shell:{},events:[]};
 const snapshot=()=>projectStartupRecord(record);
 function persist(){if(disposed)return;record.observedAt=new Date(now()).toISOString();const temporary=filename+'.'+crypto.randomUUID()+'.tmp';let handle=null,created=false;try{
  fs.mkdirSync(directory,{recursive:true});if(fs.lstatSync(directory).isSymbolicLink())throw new Error('unsafe_directory');
  const peers=fs.readdirSync(directory).filter(n=>/^[1-9]\d{0,9}\.json$/u.test(n)).map(n=>({name:n,stat:fs.lstatSync(path.join(directory,n))})).filter(x=>x.stat.isFile()&&!x.stat.isSymbolicLink()).sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs);
  for(const [index,peer]of peers.entries())if(peer.name!==pid+'.json'&&(index>=15||now()-peer.stat.mtimeMs>86400000)&&peer.stat.size<=16384){try{const value=JSON.parse(fs.readFileSync(path.join(directory,peer.name),'utf8'));if(projectStartupRecord(value))fs.unlinkSync(path.join(directory,peer.name));}catch{}}
  handle=fs.openSync(temporary,'wx');created=true;fs.writeFileSync(handle,JSON.stringify(snapshot()));fs.closeSync(handle);handle=null;fs.renameSync(temporary,filename);
 }catch{if(!writeWarning){writeWarning=true;log('Startup diagnostics could not be persisted under existing permissions; no access rights were changed.');}}
 finally{if(handle!==null)try{fs.closeSync(handle);}catch{}if(created)try{fs.unlinkSync(temporary);}catch{}}}
 function event(code,stage,encodingReplacementObserved=false){if(disposed)return;const stamp=new Date(now()).toISOString(),requested=snapshot().shell.requestedExecutableName;const old=record.events.find(e=>e.code===code&&e.stage===stage&&e.requestedExecutableName===requested&&now()-Date.parse(e.lastSeen)<30000);if(old){old.count=Math.min(1000,old.count+1);old.lastSeen=stamp;old.attemptId=record.current.attemptId;old.historical=false;old.encodingReplacementObserved||=encodingReplacementObserved;}else{record.events.push({code,stage,requestedExecutableName:requested,confidence:code==='execution_policy_related_startup_block'?'high':'unknown',firstSeen:stamp,lastSeen:stamp,count:1,historical:false,encodingReplacementObserved,attemptId:record.current.attemptId,firstAttemptId:record.current.attemptId});record.events=record.events.slice(-8);log('Guest local helper: '+code+' ('+stage+'), requested executable '+snapshot().shell.requestedExecutableName+', attempt '+record.current.attemptId+', epoch '+record.current.epoch+'. '+(code==='execution_policy_related_startup_block'?'Review effective policy and script trust for this helper identity, not a separate sandbox probe. ':'')+'Actual identity/policy scope may be unknown; no automatic shell or policy change.');}persist();}
 return{
  snapshot,
  begin(attemptId,epoch,executable){if(disposed)return;for(const e of record.events)e.historical=true;const name=String(executable).split(/[\\/]/u).at(-1).toLowerCase();record.current={health:'starting',stage:'access_setup',attemptId,epoch};record.shell={requestedExecutableName:['powershell.exe','pwsh.exe'].includes(name)?name:'other',metadataSource:'requested_only'};persist();},
  stage(stage){if(disposed)return;record.current.stage=stage;persist();},
  stderr(text,encodingIssue){const code=classifyStartupStderr(text);event(code,'helper_startup',encodingIssue);},
  spawnError(code){record.current.health='failed';event(code==='ENOENT'?'shell_executable_not_found':'helper_start_failed','process_start');},
  setupError(error){record.current.health='failed';record.current.stage=error?.stage==='account_enumeration'?'account_enumeration':'access_setup';event(error?.code==='execution_policy_related_startup_block'?error.code:'ipc_access_setup_failed',record.current.stage);},
  exited(){if(disposed)return;const wasReady=record.current.health==='ready';record.current.health='failed';record.current.stage=wasReady?'ipc_runtime':'helper_startup';if(!record.events.some(e=>!e.historical&&e.code==='execution_policy_related_startup_block')&&!record.events.some(e=>!e.historical&&['helper_start_failed','shell_executable_not_found'].includes(e.code)))event(wasReady?'ipc_helper_exited':'helper_startup_failed',record.current.stage);else persist();},
  ready(shell){if(disposed)return;record.current.health='ready';record.current.stage='ipc_runtime';record.shell={...record.shell,...shell,metadataSource:'helper_ready'};for(const e of record.events)e.historical=true;persist();log('Guest local IPC ready: attempt '+record.current.attemptId+', epoch '+record.current.epoch+'. Previous startup errors are historical.');},
  stop(){if(disposed)return;record.current.health='stopped';for(const e of record.events)e.historical=true;persist();},
  dispose(){if(disposed)return;disposed=true;try{fs.unlinkSync(filename);}catch{}}
 };
}
function captureStartupStderr(journal){const decoder=new StringDecoder('utf8');let tail='',reported=false,ended=false;return{write(value){if(ended)return;tail=(tail+(Buffer.isBuffer(value)?decoder.write(value):String(value))).slice(-8192);if(!reported&&classifyStartupStderr(tail)==='execution_policy_related_startup_block'){reported=true;journal.stderr(tail,tail.includes('\ufffd'));}},end(){if(ended)return;ended=true;tail=(tail+decoder.end()).slice(-8192);if(tail&&!reported)journal.stderr(tail,tail.includes('\ufffd'));tail='';}};}
module.exports={classifyStartupStderr,createStartupJournal,captureStartupStderr};
