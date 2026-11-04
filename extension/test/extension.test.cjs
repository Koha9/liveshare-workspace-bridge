'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspectRecords, request } = require('../cli.cjs');
const manifest = require('../package.json');
const { removeTempDirectory, recordingChildProcess } = require('./temp-cleanup.cjs');
test('extension starts before joining, refreshes workspace epoch, restarts and removes registration on disposal', { skip: process.platform !== 'win32', timeout: 90000 }, async t => {
  const localHome=fs.mkdtempSync(path.join(os.tmpdir(),'lswb-lifecycle-home-'));
  const records=()=>inspectRecords({registryPath:path.join(localHome,'.liveshare-local','instances')}).records;
  const commands = new Map(), context = { subscriptions: [] };
  let changeFolders, changeConfiguration;
  const settings = {};
  const bridgeOutput = [];
  const notices = [];
  class Uri { constructor(value) { this.value = value; this.scheme = 'vsls'; this.authority = ''; this.path = '/'; } toString() { return this.value; } }
  const vscode = {
    Uri,
    window: { createOutputChannel: name => { assert.equal(name, manifest.displayName); return { append: text => bridgeOutput.push(text), appendLine: text => bridgeOutput.push(text + "\n"), dispose() {} }; },
      showInformationMessage: async message => {
        notices.push(message);
        return undefined;
      },
    },
    workspace: { workspaceFolders: [], textDocuments: [], isTrusted: true, getConfiguration: section => ({ get: key => { assert.ok(Object.hasOwn(manifest.contributes.configuration.properties, `${section}.${key}`)); assert.equal(section, 'liveshareWorkspaceBridge'); return key === 'powershell' ? '' : settings[key]; } }), onDidChangeWorkspaceFolders: callback => { changeFolders = callback; return { dispose() {} }; }, onDidChangeConfiguration: callback => { changeConfiguration = callback; return { dispose() {} }; } },
    commands: { registerCommand: (name, callback) => { assert.equal(commands.has(name), false); commands.set(name, callback); return { dispose() { commands.delete(name); } }; } }
  };
  const loader = Module._load;
  let extension;
  // Record the real IPC helpers so cleanup can wait for them to exit.
  const helpers = [];
  const recordedChildProcess = recordingChildProcess(helpers);
  try { Module._load = function(name, parent, isMain) { if(name==='node:os')return {...os,homedir:()=>localHome};if(name==='node:child_process')return recordedChildProcess;return name === 'vscode' ? vscode : loader.call(this, name, parent, isMain); }; extension = require('../extension.cjs'); }
  finally { Module._load = loader; }
  t.after(async () => {
    for (const disposable of context.subscriptions.slice().reverse()) disposable.dispose();
    assert.equal(path.dirname(localHome), os.tmpdir());
    assert.ok(path.basename(localHome).startsWith('lswb-lifecycle-home-'));
    await removeTempDirectory(localHome, { prefix: 'lswb-lifecycle-home-', children: helpers });
  });
  // A record left by a window whose process exited is removed at activation.
  const leftoverDirectory = path.join(localHome, '.liveshare-local', 'instances');
  const leftoverPid = await new Promise((resolve, reject) => {
    const child = require('node:child_process').spawn(process.execPath, ['-e', ''], { windowsHide: true });
    child.on('error', reject);
    child.on('exit', () => resolve(child.pid));
  });
  const leftoverId = require('node:crypto').randomUUID();
  const leftover = path.join(leftoverDirectory, `${leftoverId}.json`);
  fs.mkdirSync(leftoverDirectory, { recursive: true });
  fs.writeFileSync(leftover, JSON.stringify({ id: leftoverId, epoch: 1, version: '0.2.4', pipeName: `liveshare-local-${leftoverPid}-${leftoverId}`, pid: leftoverPid, roots: [] }));
  extension.activate(context);
  assert.equal(fs.existsSync(leftover), false);
  assert.ok(bridgeOutput.join('').includes('Removed 1 discovery record(s) left by exited VS Code windows.'));
  assert.deepEqual([...commands.keys()].sort(), manifest.contributes.commands.map(x => x.command).sort());
  assert.ok(commands.has('liveshareWorkspaceBridge.copyMcpConfig'));
  const launcher = path.join(localHome, '.liveshare-local', 'mcp-server.cjs');
  assert.deepEqual(fs.readFileSync(launcher), fs.readFileSync(path.join(__dirname, '..', 'mcp-launcher.cjs')));
  await commands.get('liveshareWorkspaceBridge.copyMcpConfig')();
  assert.ok(bridgeOutput.join('').includes(JSON.stringify(launcher.replace(/\\/g, '/'))));
  async function ownRecord(except) {
    // PowerShell compiles the native IPC helper at startup. Shared Windows CI
    // runners can take longer than five seconds under parallel test load.
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const found = records().find(x => x.pid === process.pid && x.id !== except);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Own test extension did not register within 20 seconds. Bridge output:\n${bridgeOutput.join('').slice(-4000) || '(no output)'}`);
  }
  const first = await ownRecord();
  assert.deepEqual(first.roots, []);
  vscode.workspace.workspaceFolders = [{ name: 'Lifecycle fixture', uri: new Uri('vsls:/') }]; changeFolders();
  const updated = records().find(x => x.id === first.id);
  assert.equal(updated.epoch, 2); assert.equal(updated.roots[0].name, 'Lifecycle fixture');
  const response = await request(updated, { op: 'info', instance: updated.id });
  assert.equal(response.result.epoch, 2); assert.equal(response.result.roots[0].uri, 'vsls:/');
  commands.get('liveshareWorkspaceBridge.stop')();
  assert.equal(records().some(x => x.id === first.id), false);
  commands.get('liveshareWorkspaceBridge.restart')();
  const restarted = await ownRecord(first.id);
  assert.equal(restarted.epoch, 3);
  assert.equal(restarted.ipc.mode, 'ownerOnly');
  settings['ipc.accessMode'] = 'selectedUsers';
  changeConfiguration({ affectsConfiguration: key => key === 'liveshareWorkspaceBridge.ipc.accessMode' });
  const trusted = await ownRecord(restarted.id);
  assert.equal(trusted.epoch, 4); assert.equal(trusted.ipc.mode, 'selectedUsers');
  assert.equal((await request(trusted, {op:'info',instance:trusted.id})).result.ipc.mode, 'selectedUsers');
  settings['ipc.accessMode'] = 'ownerOnly';
  changeConfiguration({ affectsConfiguration: key => key === 'liveshareWorkspaceBridge.ipc.accessMode' });
  const revoked = await ownRecord(trusted.id);
  assert.equal(revoked.epoch, 5); assert.equal(revoked.ipc.mode, 'ownerOnly');
  assert.equal(records().some(x=>x.id===trusted.id), false);
  settings['ipc.accessMode'] = 'allLocalUsers';
  changeConfiguration({ affectsConfiguration: key => key === 'liveshareWorkspaceBridge.ipc.accessMode' });
  const removed = await ownRecord(revoked.id);
  assert.equal(removed.epoch, 6);
  assert.equal(removed.ipc.mode, 'ownerOnly');
  assert.equal(removed.ipc.requestedMode, 'allLocalUsers');
  assert.equal(removed.ipc.deprecatedModeIgnored, true);
  const removedInfo = (await request(removed, { op: 'info', instance: removed.id })).result.ipc;
  assert.equal(removedInfo.mode, 'ownerOnly');
  assert.equal(removedInfo.requestedMode, 'allLocalUsers');
  assert.equal(removedInfo.deprecatedModeIgnored, true);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /'allLocalUsers' was removed in 0\.3\.0/);
  commands.get('liveshareWorkspaceBridge.restart')();
  const removedAgain = await ownRecord(removed.id);
  assert.equal(removedAgain.ipc.mode, 'ownerOnly');
  assert.equal(notices.length, 1);
  assert.equal(settings['ipc.accessMode'], 'allLocalUsers');
  for (const disposable of context.subscriptions.slice().reverse()) disposable.dispose();
  context.subscriptions.length = 0;
  assert.equal(records().some(x => x.id === revoked.id), false);
});
