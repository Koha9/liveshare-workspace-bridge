'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createPermissions,DEFINITIONS,HOST_OPERATIONS,configurationProperties}=require('../permissions.cjs');
const {OPERATIONS}=require('../workspace.cjs');
function fixture(){const settings={};const permissions=createPermissions({workspace:{getConfiguration:()=>({get:key=>settings[key]})}});return {settings,permissions};}
test('Host access default is off; every Host operation is linked to it while Guest reads remain available',()=>{
 const {permissions}=fixture();for(const op of HOST_OPERATIONS)assert.equal(permissions.reason(op)?.code,'host_access_disabled',op);
 assert.equal(permissions.reason('read'),null);assert.equal(permissions.reason('edit'),null);assert.equal(permissions.reason('searchSnapshot'),null);
});
test('master switch and each operation permission take effect immediately without restart',()=>{
 const {settings,permissions}=fixture();settings['host.enabled']=true;
 for(const key of Object.keys(DEFINITIONS)){settings['permissions.'+key]=false;assert.equal(permissions.reason(key)?.code,'operation_disabled',key);settings['permissions.'+key]=true;assert.equal(permissions.reason(key),null,key);}
 settings['agent.enabled']=false;for(const op of OPERATIONS.filter(x=>!['info','hostStatus'].includes(x)))assert.equal(permissions.reason(op)?.code,'agent_access_disabled',op);
 settings['agent.enabled']=true;assert.equal(permissions.reason('read'),null);
});
test('raw commands cannot bypass a restricted operation and document mutations honor the save switch',()=>{
 const {settings,permissions}=fixture();settings['host.enabled']=true;settings['permissions.delete']=false;
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
 const {settings,permissions}=fixture();settings['host.enabled']=true;
 for(const op of ['transferOpenRead','transferRead'])assert.equal(permissions.reason(op).code,'feature_unavailable');
 assert.equal(permissions.reason('transferBeginWrite'),null);assert.equal(permissions.reason('readBytes'),null);
});
test('manifest contains the same English user-level controls as the server gate definitions',()=>{
 const expected=configurationProperties(),actual=require('../package.json').contributes.configuration.properties;
 for(const [key,value]of Object.entries(expected)){assert.deepEqual(actual[key],value,key);assert.equal(actual[key].scope,'machine');assert.ok(!/[\u3400-\u9fff\u3040-\u30ff]/u.test(actual[key].markdownDescription||actual[key].description));}
});
test('manifest text is agent-neutral and does not claim a port-free Host channel', () => {
  const manifest = require('../package.json');
  const mode = configurationProperties()['liveshareWorkspaceBridge.ipc.accessMode'];
  assert.doesNotMatch(manifest.description, /without ports|copied tokens/);
  assert.match(manifest.description, /MCP server/);
  assert.doesNotMatch(mode.markdownDescription, /Codex/);
  assert.ok(!manifest.keywords.includes('codex'));
  assert.ok(manifest.keywords.includes('mcp'));
});
test('IPC access mode schema offers only ownerOnly and selectedUsers',()=>{
 const {MODES}=require('../ipc-access.cjs');
 const manifest=require('../package.json').contributes.configuration.properties;
 const mode=configurationProperties()['liveshareWorkspaceBridge.ipc.accessMode'];
 assert.deepEqual(mode.enum,MODES);
 assert.equal(mode.enumDescriptions.length,MODES.length);
 assert.equal(mode.default,'ownerOnly');
 assert.match(mode.markdownDescription,/allLocalUsers.*removed in 0\.3\.0.*ownerOnly/);
 const legacy=manifest['liveshareWorkspaceBridge.ipc.allowCodexSandboxClients'];
 assert.doesNotMatch(legacy.deprecationMessage,/allLocalUsers/);
});

// A VS Code-like configuration: get() returns the manifest default for an
// unset key, so only inspect() tells whether a key was set explicitly.
function inspectFixture(userValues) {
  const defaults = { 'host.enabled': false, 'terminal.enabled': false, 'host.commandTimeoutMs': 120000, 'terminal.commandTimeoutMs': 120000 };
  const config = {
    get: key => (Object.hasOwn(userValues, key) ? userValues[key] : defaults[key]),
    inspect: key => ({ key, defaultValue: defaults[key], globalValue: userValues[key] }),
  };
  const permissions = createPermissions({ workspace: { getConfiguration: () => config } });
  return { userValues, permissions };
}

test('only the legacy terminal.enabled=true still enables every Host operation', () => {
  const { permissions } = inspectFixture({ 'terminal.enabled': true });
  for (const op of HOST_OPERATIONS) {
    if (!['transferOpenRead', 'transferRead'].includes(op)) {
      assert.equal(permissions.reason(op), null, op);
    }
  }
  assert.equal(permissions.value('host.enabled', false), true);
  assert.deepEqual(permissions.legacySettingsInUse(), ['terminal.enabled']);
  assert.equal(permissions.snapshot(['hostBind']).hostEnabled, true);
});

test('an explicit new Host key wins over the legacy key; a default does not', () => {
  const explicit = inspectFixture({ 'terminal.enabled': true, 'host.enabled': false });
  assert.equal(explicit.permissions.reason('search').code, 'host_access_disabled');
  assert.deepEqual(explicit.permissions.legacySettingsInUse(), []);
  const timeout = inspectFixture({ 'terminal.commandTimeoutMs': 5000 });
  assert.equal(timeout.permissions.value('host.commandTimeoutMs', 120000), 5000);
  const neither = inspectFixture({});
  assert.equal(neither.permissions.value('host.enabled', false), false);
  assert.equal(neither.permissions.value('host.commandTimeoutMs', 120000), 120000);
  assert.deepEqual(neither.permissions.legacySettingsInUse(), []);
});

test('legacy values keep fail-closed type checks', () => {
  const { permissions } = inspectFixture({ 'terminal.enabled': 'true' });
  assert.equal(permissions.reason('search').code, 'host_access_disabled');
});

test('renamed and removed keys stay in the manifest only as deprecated entries', () => {
  const properties = configurationProperties();
  const renamed = { enabled: 'enabled', name: 'terminalName', hostWorkspacePath: 'workspacePath', commandTimeoutMs: 'commandTimeoutMs', maxOutputCharacters: 'maxOutputCharacters' };
  for (const [oldName, newName] of Object.entries(renamed)) {
    const legacy = properties[`liveshareWorkspaceBridge.terminal.${oldName}`];
    const current = properties[`liveshareWorkspaceBridge.host.${newName}`];
    assert.ok(current, newName);
    assert.equal(current.deprecationMessage, undefined, newName);
    assert.match(legacy.deprecationMessage, new RegExp(`host\.${newName}`, 'u'), oldName);
    assert.equal(legacy.default, current.default, oldName);
  }
  assert.match(properties['liveshareWorkspaceBridge.host.transport'].deprecationMessage, /portForward/u);
  for (const property of Object.values(properties)) {
    assert.doesNotMatch(property.markdownDescription || property.description || '', /terminal\.enabled#/u);
  }
});
