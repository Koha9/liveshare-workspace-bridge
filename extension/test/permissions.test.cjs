'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createPermissions,DEFINITIONS,HOST_OPERATIONS,configurationProperties}=require('../permissions.cjs');
const {OPERATIONS}=require('../workspace.cjs');
function fixture(){const settings={};const permissions=createPermissions({workspace:{getConfiguration:()=>({get:key=>settings[key]})}});return {settings,permissions};}
test('terminal default is off; every Host operation is linked to it while Guest reads remain available',()=>{
 const {permissions}=fixture();for(const op of HOST_OPERATIONS)assert.equal(permissions.reason(op)?.code,'terminal_access_disabled',op);
 assert.equal(permissions.reason('read'),null);assert.equal(permissions.reason('edit'),null);assert.equal(permissions.reason('searchSnapshot'),null);
});
test('master switch and each operation permission take effect immediately without restart',()=>{
 const {settings,permissions}=fixture();settings['terminal.enabled']=true;
 for(const key of Object.keys(DEFINITIONS)){settings['permissions.'+key]=false;assert.equal(permissions.reason(key)?.code,'operation_disabled',key);settings['permissions.'+key]=true;assert.equal(permissions.reason(key),null,key);}
 settings['agent.enabled']=false;for(const op of OPERATIONS.filter(x=>!['info','hostStatus'].includes(x)))assert.equal(permissions.reason(op)?.code,'agent_access_disabled',op);
 settings['agent.enabled']=true;assert.equal(permissions.reason('read'),null);
});
test('raw commands cannot bypass a restricted operation and document mutations honor the save switch',()=>{
 const {settings,permissions}=fixture();settings['terminal.enabled']=true;settings['permissions.delete']=false;
 assert.equal(permissions.reason('hostExec').code,'raw_commands_restricted');assert.equal(permissions.reason('search'),null);
 settings['permissions.delete']=true;settings['permissions.save']=false;
 for(const op of ['edit','write','create','renameSymbol','format'])assert.equal(permissions.reason(op).permission,'save');
 assert.equal(permissions.reason('hostJobPoll').code,'raw_commands_restricted');
});
test('invalid permission values fail closed instead of inheriting an enabled default',()=>{
 const {settings,permissions}=fixture();settings['agent.enabled']='false';assert.equal(permissions.reason('read').code,'agent_access_disabled');
 settings['agent.enabled']=true;settings['permissions.read']='true';assert.equal(permissions.reason('read').code,'operation_disabled');
});
test('unvalidated sustained downloads are rejected before a Host request even with all permissions',()=>{
 const {settings,permissions}=fixture();settings['terminal.enabled']=true;
 for(const op of ['transferOpenRead','transferRead'])assert.equal(permissions.reason(op).code,'feature_unavailable');
 assert.equal(permissions.reason('transferBeginWrite'),null);assert.equal(permissions.reason('readBytes'),null);
});
test('manifest contains the same English user-level controls as the server gate definitions',()=>{
 const expected=configurationProperties(),actual=require('../package.json').contributes.configuration.properties;
 for(const [key,value]of Object.entries(expected)){assert.deepEqual(actual[key],value,key);assert.equal(actual[key].scope,'machine');assert.ok(!/[\u3400-\u9fff\u3040-\u30ff]/u.test(actual[key].markdownDescription||actual[key].description));}
});
