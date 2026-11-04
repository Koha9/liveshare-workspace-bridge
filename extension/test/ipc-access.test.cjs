'use strict';
const{test}=require('node:test');const assert=require('node:assert/strict');const{MODES,readAccess,prepareAccess,pickerItems,configureAccess,listLocalUsers,noticeRemovedMode}=require('../ipc-access.cjs');
function fixture(values={}){const settings={...values},cache=new Map(),writes=[];const config={get:(key,fallback)=>settings[key]===undefined?fallback:settings[key],inspect:key=>({globalValue:settings[key]}),update:async(key,value)=>{writes.push(key);settings[key]=value;}};return{settings,config,writes,state:{get:key=>cache.get(key),update:async(key,value)=>{cache.set(key,value)}}};}
const users=[{Sid:'S-1-5-21-1-2-3-1001',Name:'PC\\CodexSandboxOffline'},{Sid:'S-1-5-21-1-2-3-1002',Name:'PC\\CodexSandboxOnline'},{Sid:'S-1-5-21-1-2-3-1003',Name:'PC\\Other'}];
test('release defaults to ownerOnly; explicit modes override the legacy boolean',()=>{assert.equal(readAccess(fixture().config).mode,'ownerOnly');const f=fixture({'ipc.accessMode':'ownerOnly','ipc.allowCodexSandboxClients':true});assert.equal(readAccess(f.config).legacyMigrationRequired,false);assert.throws(()=>readAccess(fixture({'ipc.accessMode':'Everyone'}).config));});
test('workspace values and extension-contributed defaults cannot broaden the User trust policy',()=>{const config={get:()=> 'allLocalUsers',inspect:()=>({workspaceValue:'allLocalUsers',defaultValue:'allLocalUsers'})};assert.equal(readAccess(config).mode,'ownerOnly');assert.equal(readAccess(config).legacyMigrationRequired,false);});
test('legacy true migrates only two existing SIDs; false never migrates or enumerates',async()=>{const f=fixture({'ipc.allowCodexSandboxClients':true});const result=await prepareAccess(f.config,f.state,async()=>users,1);assert.equal(result.mode,'selectedUsers');assert.deepEqual(f.settings['ipc.selectedUserSids'],users.slice(0,2).map(x=>x.Sid));assert.equal(f.settings['ipc.accessMode'],'selectedUsers');assert.equal(f.writes.some(x=>x.includes('terminal')),false);const off=fixture();await prepareAccess(off.config,off.state,async()=>{throw new Error('must not enumerate')},1);assert.deepEqual(off.writes,[]);});
test('cached SID migration does not re-resolve renamed or recreated account names',async()=>{const f=fixture({'ipc.allowCodexSandboxClients':true});await f.state.update('ipc.legacySidSnapshot',[users[0].Sid]);await prepareAccess(f.config,f.state,async()=>{throw new Error('must not resolve names again')},1);assert.deepEqual(f.settings['ipc.selectedUserSids'],[users[0].Sid]);});
test('manual mode changes during enumeration win; ambiguous hand-edited selections are preserved',async()=>{const f=fixture({'ipc.allowCodexSandboxClients':true});const out=await prepareAccess(f.config,f.state,async()=>{f.settings['ipc.accessMode']='ownerOnly';return users},1);assert.equal(out.mode,'ownerOnly');assert.deepEqual(f.writes,[]);const ambiguous=fixture({'ipc.allowCodexSandboxClients':true,'ipc.selectedUserSids':[users[2].Sid]});await assert.rejects(prepareAccess(ambiguous.config,ambiguous.state,async()=>users,1),/coexist/);assert.deepEqual(ambiguous.writes,[]);});
test('picker shows current names and preserves unavailable SIDs without name substitution',()=>{const items=pickerItems([{...users[0],Name:'PC\\Renamed'}],[users[0].Sid,'S-1-5-21-1-2-3-9999']);assert.equal(items[0].label,'PC\\Renamed');assert.equal(items[0].picked,true);assert.equal(items[1].label,'Unavailable selected account');assert.equal(items[1].sid,'S-1-5-21-1-2-3-9999');});
test('cancelled selected-user UI leaves settings unchanged and explains Host scope',async()=>{
 const f=fixture({'terminal.enabled':true});
 let warning;
 let count=0;
 const sdk={
  ConfigurationTarget:{Global:1},
  workspace:{getConfiguration:()=>f.config},
  window:{
   showQuickPick:async()=>++count%2===1?{mode:'selectedUsers'}:[{sid:users[2].Sid}],
   showWarningMessage:async message=>{warning=message;return undefined;},
  },
 };
 await configureAccess(sdk,async()=>users);
 assert.match(warning,/Host terminal access is enabled/);
 assert.deepEqual(f.writes,[]);
 await assert.rejects(configureAccess(sdk,async()=>{throw new Error('Local catalog unavailable');}),/catalog unavailable/);
 assert.deepEqual(f.writes,[]);
 count=0;
 sdk.window.showQuickPick=async()=>++count===1?{mode:'selectedUsers'}:undefined;
 await configureAccess(sdk,async()=>users);
 assert.deepEqual(f.writes,[]);
});
test('access modes are only ownerOnly and selectedUsers; the picker offers no broader mode',async()=>{
 assert.deepEqual(MODES,['ownerOnly','selectedUsers']);
 const f=fixture();
 let offered;
 const sdk={
  ConfigurationTarget:{Global:1},
  workspace:{getConfiguration:()=>f.config},
  window:{showQuickPick:async items=>{offered=items;return undefined;}},
 };
 assert.equal(await configureAccess(sdk,async()=>users),false);
 assert.deepEqual(offered.map(x=>x.mode),['ownerOnly','selectedUsers']);
 assert.deepEqual(f.writes,[]);
});
test('removed allLocalUsers value runs as ownerOnly and reports the requested mode',async()=>{
 const f=fixture({'ipc.accessMode':'allLocalUsers','ipc.selectedUserSids':[users[2].Sid],'ipc.allowCodexSandboxClients':true});
 const read=readAccess(f.config);
 assert.equal(read.mode,'ownerOnly');
 assert.deepEqual(read.selectedUserSids,[]);
 assert.equal(read.requestedMode,'allLocalUsers');
 assert.equal(read.deprecatedModeIgnored,true);
 assert.equal(read.legacyMigrationRequired,false);
 const prepared=await prepareAccess(f.config,f.state,async()=>{throw new Error('must not enumerate');},1);
 assert.equal(prepared.mode,'ownerOnly');
 assert.equal(prepared.requestedMode,'allLocalUsers');
 assert.deepEqual(f.writes,[]);
 assert.equal(readAccess(fixture({'ipc.accessMode':'ownerOnly'}).config).deprecatedModeIgnored,undefined);
 assert.throws(()=>readAccess(fixture({'ipc.accessMode':'AllLocalUsers'}).config),/ownerOnly or selectedUsers/);
});
test('removed-mode notice logs, prompts once per session, offers Configure IPC Access and writes no setting',async()=>{
 const f=fixture({'ipc.accessMode':'allLocalUsers'});
 const access=readAccess(f.config);
 const logs=[];
 const prompts=[];
 const executed=[];
 const sdk={
  window:{showInformationMessage:async(message,...actions)=>{prompts.push({message,actions});return actions[0];}},
  commands:{executeCommand:async name=>{executed.push(name);}},
 };
 const session={};
 await noticeRemovedMode(sdk,access,session,line=>logs.push(line));
 await noticeRemovedMode(sdk,access,session,line=>logs.push(line));
 assert.equal(prompts.length,1);
 assert.equal(prompts[0].message,"IPC Access Mode 'allLocalUsers' was removed in 0.3.0; the bridge now runs as ownerOnly. Agents connect through the MCP server under your own account. Use Configure IPC Access if you need selectedUsers.");
 assert.deepEqual(prompts[0].actions,['Configure IPC Access']);
 assert.deepEqual(executed,['liveshareWorkspaceBridge.configureAccess']);
 assert.equal(logs.length,2);
 assert.match(logs[0],/allLocalUsers.*ownerOnly/);
 assert.deepEqual(f.writes,[]);
 const quiet=[];
 await noticeRemovedMode(sdk,readAccess(fixture().config),{},line=>quiet.push(line));
 assert.deepEqual(quiet,[]);
 assert.equal(prompts.length,1);
});
test('confirmed selected-user UI saves SIDs rather than names without changing terminal/legacy permissions',async()=>{const f=fixture({'terminal.enabled':false});let count=0;const sdk={ConfigurationTarget:{Global:1},workspace:{getConfiguration:()=>f.config},window:{showQuickPick:async()=>++count===1?{mode:'selectedUsers'}:[{sid:users[2].Sid,label:'PC\\Renamed'}],showWarningMessage:async()=> 'Apply Access Mode'}};assert.equal(await configureAccess(sdk,async()=>users),true);assert.deepEqual(f.settings['ipc.selectedUserSids'],[users[2].Sid]);assert.equal(f.settings['ipc.accessMode'],'selectedUsers');assert.deepEqual(f.writes,['ipc.selectedUserSids','ipc.accessMode']);assert.equal(f.settings['terminal.enabled'],false);});
test('account enumeration preserves Unicode names across arbitrary process output chunks',async()=>{const{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};const expected=[{Sid:users[0].Sid,Name:'PC\\测试😀',Disabled:false}],bytes=Buffer.from(JSON.stringify(expected));const offset=bytes.indexOf(Buffer.from('测'));const task=listLocalUsers('unused',()=>child);child.stdout.write(bytes.subarray(0,offset+1));child.stdout.write(bytes.subarray(offset+1,offset+2));child.stdout.end(bytes.subarray(offset+2));child.stderr.end();child.emit('close',0);assert.deepEqual(await task,expected);});
