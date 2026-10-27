'use strict';
const path=require('node:path');const{spawn}=require('node:child_process');
const{classifyStartupStderr}=require('./startup-diagnostics.cjs');
const MODES=['ownerOnly','allLocalUsers','selectedUsers'];
const ACCESS_KEYS=['ipc.accessMode','ipc.selectedUserSids','ipc.allowCodexSandboxClients'];
// Trust is a User setting. Do not accept workspace values or contributed defaults.
function userValue(config,key,fallback){if(config.inspect){const detail=config.inspect(key);return detail?.globalValue===undefined?fallback:detail.globalValue;}const value=config.get(key,fallback);return value===undefined?fallback:value;}
function explicit(config,key){return config.inspect?config.inspect(key)?.globalValue!==undefined:config.get(key)!==undefined;}
function selectedSids(config){const value=userValue(config,'ipc.selectedUserSids',[]);if(!Array.isArray(value)||value.length>256||value.some(x=>typeof x!=='string'||x.length>184))throw new Error('Selected users must be an array of at most 256 SID strings.');return [...new Set(value)];}
function readAccess(config){const mode=userValue(config,'ipc.accessMode','ownerOnly');if(!MODES.includes(mode))throw new Error('Unknown IPC access mode; select ownerOnly, allLocalUsers or selectedUsers.');return{mode,selectedUserSids:mode==='selectedUsers'?selectedSids(config):[],legacyMigrationRequired:!explicit(config,'ipc.accessMode')&&userValue(config,'ipc.allowCodexSandboxClients',false)===true};}
function listLocalUsers(powershell,spawnProcess=spawn){return new Promise((resolve,reject)=>{const child=spawnProcess(powershell,['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(__dirname,'pipe-host.ps1'),'-ListLocalUsers'],{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',done=false;child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);if(error){error.stage='account_enumeration';reject(error);}else resolve(result);};const timer=setTimeout(()=>{child.kill();finish(new Error('Local account enumeration timed out. No access setting was changed.'));},10000);child.on('error',e=>finish(e));child.stdout.on('data',x=>{stdout+=x;if(stdout.length>1024*1024){child.kill();finish(new Error('Local account catalog exceeds its limit.'));}});child.stderr.on('data',x=>{if(stderr.length<8192)stderr+=x});child.on('close',code=>{if(code!==0){const error=new Error('Cannot enumerate machine-local users; inspect local startup diagnostics.');error.code=classifyStartupStderr(stderr);error.stage='account_enumeration';finish(error);return;}try{const accounts=JSON.parse(stdout);if(!Array.isArray(accounts))throw new Error('Invalid local account catalog.');finish(null,accounts);}catch(e){finish(e);}});});}
async function prepareAccess(config,state,listUsers,target){
 const read=readAccess(config);if(!read.legacyMigrationRequired)return read;
 // A partially edited new policy is ambiguous: never replace it with guessed trust.
 if(explicit(config,'ipc.selectedUserSids')&&!state.get('ipc.legacySidSnapshot'))throw new Error('Legacy IPC trust and a new SID list coexist without a mode. Select the intended access mode manually.');
 let sids=state.get('ipc.legacySidSnapshot');
 if(sids===undefined){const users=await listUsers();sids=users.filter(x=>['codexsandboxoffline','codexsandboxonline'].includes(x.Name.split('\\').at(-1).toLowerCase())).map(x=>x.Sid);await state.update('ipc.legacySidSnapshot',sids);}
 if(!Array.isArray(sids)||sids.some(x=>typeof x!=='string'))throw new Error('Invalid saved legacy SID snapshot; select users manually.');
 // Recheck after asynchronous reads so a manual mode change wins.
 if(!readAccess(config).legacyMigrationRequired)return readAccess(config);
 const existing=userValue(config,'ipc.selectedUserSids',[]);
 if(explicit(config,'ipc.selectedUserSids')&&JSON.stringify(existing)!==JSON.stringify(sids))throw new Error('Selected SIDs changed during migration; no mode was overwritten.');
 await config.update('ipc.selectedUserSids',sids,target);
 if(!readAccess(config).legacyMigrationRequired)return readAccess(config);
 if(JSON.stringify(userValue(config,'ipc.selectedUserSids',[]))!==JSON.stringify(sids))throw new Error('Selected SIDs changed during migration; no mode was overwritten.');
 await config.update('ipc.accessMode','selectedUsers',target);
 return{mode:'selectedUsers',selectedUserSids:sids,legacyMigrationRequired:false,migratedLegacy:true};
}
function pickerItems(users,selected){const chosen=new Set(selected);const items=users.map(x=>({label:x.Name,description:x.Disabled?'Disabled local account':'Local account',detail:x.Sid,sid:x.Sid,picked:chosen.has(x.Sid)}));for(const sid of selected)if(!users.some(x=>x.Sid===sid))items.push({label:'Unavailable selected account',description:'Deleted, foreign or invalid SID; not granted',detail:sid,sid,picked:true});return items;}
async function configureAccess(vscode,listUsers){
 const config=vscode.workspace.getConfiguration('liveshareWorkspaceBridge');
 const choice=await vscode.window.showQuickPick([{label:'Owner only (default)',description:'Only the Windows user running this bridge',mode:'ownerOnly'},{label:'All machine-local accounts',description:'Same Windows session only; no remote or domain accounts',mode:'allLocalUsers'},{label:'Selected machine-local accounts',description:'Choose local users; stable SIDs survive account renames',mode:'selectedUsers'}],{title:'Live Share Workspace Bridge: IPC Access Mode',placeHolder:'Trust applies to all processes of allowed accounts, not only Codex.'});
 if(!choice)return false;let sids;
 if(choice.mode==='allLocalUsers')await listUsers(); // Refuse unavailable/DC catalogs before writing a policy.
 if(choice.mode==='selectedUsers'){const users=await listUsers();const picked=await vscode.window.showQuickPick(pickerItems(users,selectedSids(config)),{title:'Select Local Accounts',canPickMany:true,placeHolder:'Saved by SID. Deleted/recreated accounts are not substituted by name.'});if(picked===undefined)return false;sids=picked.map(x=>x.sid);}
 if(choice.mode!=='ownerOnly'){
  const host=config.get('terminal.enabled',false)===true?'Host terminal access is enabled; allowed processes may also run Host commands if other requirements are met.':'Host terminal access remains independently controlled.';
  const confirmed=await vscode.window.showWarningMessage('Trust '+(choice.mode==='allLocalUsers'?'all current machine-local accounts':'the selected local accounts')+' in this Windows session? Their processes can use bridge permissions outside Codex filesystem sandbox limits. '+host,{modal:true},'Apply Access Mode');if(confirmed!=='Apply Access Mode')return false;
 }
 if(sids!==undefined)await config.update('ipc.selectedUserSids',sids,vscode.ConfigurationTarget.Global);
 await config.update('ipc.accessMode',choice.mode,vscode.ConfigurationTarget.Global);return true;
}
module.exports={MODES,ACCESS_KEYS,readAccess,prepareAccess,listLocalUsers,pickerItems,configureAccess};
