'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { records, request } = require('../cli.cjs');
test('extension starts before joining, refreshes workspace epoch, restarts and removes registration on disposal', { skip: process.platform !== 'win32', timeout: 15000 }, async t => {
  const commands = new Map(), context = { subscriptions: [] };
  let changeFolders;
  class Uri { constructor(value) { this.value = value; this.scheme = 'vsls'; this.authority = ''; this.path = '/'; } toString() { return this.value; } }
  const vscode = {
    Uri,
    window: { createOutputChannel: () => ({ append() {}, appendLine() {}, dispose() {} }) },
    workspace: { workspaceFolders: [], textDocuments: [], isTrusted: true, getConfiguration: () => ({ get: () => '' }), onDidChangeWorkspaceFolders: callback => { changeFolders = callback; return { dispose() {} }; } },
    commands: { registerCommand: (name, callback) => { assert.equal(commands.has(name), false); commands.set(name, callback); return { dispose() { commands.delete(name); } }; } }
  };
  const loader = Module._load;
  let extension;
  try { Module._load = function(name, parent, isMain) { return name === 'vscode' ? vscode : loader.call(this, name, parent, isMain); }; extension = require('../extension.cjs'); }
  finally { Module._load = loader; }
  t.after(() => { for (const disposable of context.subscriptions.slice().reverse()) disposable.dispose(); });
  extension.activate(context);
  async function ownRecord(except) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const found = records().find(x => x.pid === process.pid && x.id !== except);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Own test extension did not register.');
  }
  const first = await ownRecord();
  assert.deepEqual(first.roots, []);
  vscode.workspace.workspaceFolders = [{ name: 'Lifecycle fixture', uri: new Uri('vsls:/') }]; changeFolders();
  const updated = records().find(x => x.id === first.id);
  assert.equal(updated.epoch, 2); assert.equal(updated.roots[0].name, 'Lifecycle fixture');
  const response = await request(updated, { op: 'info', instance: updated.id });
  assert.equal(response.result.epoch, 2); assert.equal(response.result.roots[0].uri, 'vsls:/');
  commands.get('liveshareWorkspace.stop')();
  assert.equal(records().some(x => x.id === first.id), false);
  commands.get('liveshareWorkspace.restart')();
  const restarted = await ownRecord(first.id);
  assert.equal(restarted.epoch, 3);
  for (const disposable of context.subscriptions.slice().reverse()) disposable.dispose();
  context.subscriptions.length = 0;
  assert.equal(records().some(x => x.id === restarted.id), false);
});
