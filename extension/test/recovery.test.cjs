'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lswb-recovery-'));
  const commands = new Map(), children = [], logs = [], calls = [], context = { subscriptions: [] };
  let creates = 0, disposals = 0, changes = 0, identity, dispatch = async body => body;
  const api = { roots: () => [{ name: 'Fixture', uri: 'vsls:/' }], dispatch: body => { calls.push(body); return dispatch(body); }, workspaceChanged: () => changes++, dispose: () => disposals++ };
  const sdk = {
    window: { createOutputChannel: () => ({ appendLine: value => logs.push(value), dispose() {} }) },
    workspace: { getConfiguration: () => ({ get: (_, fallback) => fallback }), onDidChangeWorkspaceFolders: () => ({ dispose() {} }) },
    commands: { registerCommand: (name, callback) => { commands.set(name, callback); return { dispose() {} }; } }
  };
  const original = Module._load;
  delete require.cache[require.resolve('../extension.cjs')];
  let extension;
  try {
    Module._load = function(name, parent, isMain) {
      if (name === 'vscode') return sdk;
      if (name === 'node:os') return { ...os, homedir: () => home };
      if (name === './workspace.cjs') return { createWorkspaceApi: (_, value) => { creates++; identity = value; return api; } };
      if (name === 'node:child_process') return { spawn() {
        const child = new EventEmitter();
        child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.kill = () => { child.killed = true; child.emit('close', 0); return true; };
        child.replies = ''; child.stdin.on('data', chunk => child.replies += chunk);
        children.push(child); return child;
      } };
      return original.call(this, name, parent, isMain);
    };
    extension = require('../extension.cjs');
  } finally { Module._load = original; }
  t.after(() => {
    for (const item of context.subscriptions.slice().reverse()) item.dispose();
    assert.equal(path.dirname(home), os.tmpdir());
    assert.ok(path.basename(home).startsWith('lswb-recovery-'));
    fs.rmSync(home, { recursive: true, force: true });
  });
  extension.activate(context);
  return {
    commands, children, logs, calls, context,
    get creates() { return creates; }, get disposals() { return disposals; }, get changes() { return changes; },
    get identity() { return { id: identity.id, epoch: identity.epoch() }; },
    dispatch: fn => { dispatch = fn; },
    ready: () => children.at(-1).stdout.write(JSON.stringify({ kind: 'ready', ipc: { mode: 'ownerOnly' } }) + '\n'),
    request: body => children.at(-1).stdout.write(JSON.stringify({ kind: 'request', body }) + '\n'),
    records: () => fs.readdirSync(path.join(home, '.liveshare-local', 'instances')).filter(x => x.endsWith('.json'))
  };
}

test('runtime helper exit recovers without focus events, rebinding or replaying pending work', async t => {
  const f = fixture(t); await flush(); f.ready(); await flush();
  const identity = f.identity, first = f.children[0];
  let finish;
  f.dispatch(body => body.op === 'edit' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(body));
  f.request({ op: 'edit' }); await flush();
  first.emit('close', 1);
  assert.equal(f.records().length, 0);
  t.mock.timers.tick(999); await flush(); assert.equal(f.children.length, 1);
  t.mock.timers.tick(1); await flush(); assert.equal(f.children.length, 2);
  f.ready(); await flush(); f.request({ op: 'info' }); await flush();
  assert.deepEqual(f.calls, [{ op: 'edit' }, { op: 'info' }], 'Discovery stays available during pending provider work');
  f.request({ op: 'read' }); await flush();
  assert.equal(f.calls.length, 2, 'New workspace dispatch waits for the old request to settle');
  assert.deepEqual(f.identity, identity);
  assert.equal(f.creates, 1); assert.equal(f.changes, 0); assert.equal(f.disposals, 0);
  finish({ applied: true }); await flush();
  assert.deepEqual(f.calls, [{ op: 'edit' }, { op: 'info' }, { op: 'read' }]);
  assert.equal(first.replies, '', 'Late response must not reach a retired helper');
  assert.deepEqual(f.children[1].replies.trim().split('\n').map(line => JSON.parse(line).result.op), ['info', 'read']);
  assert.equal(f.records().length, 1);
});

test('three unstable recoveries back off and stop; explicit restart retains API state', async t => {
  const f = fixture(t); await flush();
  for (const delay of [1000, 2000, 4000]) {
    f.ready(); await flush(); const count = f.children.length;
    f.children.at(-1).emit('close', 1);
    t.mock.timers.tick(delay - 1); await flush(); assert.equal(f.children.length, count);
    t.mock.timers.tick(1); await flush(); assert.equal(f.children.length, count + 1);
  }
  f.ready(); await flush(); f.children.at(-1).emit('close', 1);
  t.mock.timers.tick(60000); await flush(); assert.equal(f.children.length, 4);
  assert.ok(f.logs.some(x => x.includes('three unstable restarts')));
  const previous = f.identity;
  f.commands.get('liveshareWorkspaceBridge.restart')(); await flush();
  assert.equal(f.children.length, 5); assert.equal(f.creates, 1); assert.equal(f.changes, 1);
  assert.notEqual(f.identity.id, previous.id); assert.equal(f.identity.epoch, previous.epoch + 1);
});

test('Stop cancels scheduled recovery and ignores retired helper frames', async t => {
  const f = fixture(t); await flush(); f.ready(); await flush();
  const first = f.children[0]; first.emit('close', 1);
  f.commands.get('liveshareWorkspaceBridge.stop')();
  first.stdout.write(JSON.stringify({ kind: 'request', body: { op: 'edit' } }) + '\n');
  t.mock.timers.tick(60000); await flush();
  assert.equal(f.children.length, 1); assert.deepEqual(f.calls, []); assert.equal(f.records().length, 0);
});

test('startup failure does not trigger runtime retries; stable runtime resets the retry budget', async t => {
  const f = fixture(t); await flush(); f.children[0].emit('close', 1);
  t.mock.timers.tick(60000); await flush(); assert.equal(f.children.length, 1);
  f.commands.get('liveshareWorkspaceBridge.restart')(); await flush();
  f.ready(); await flush(); f.children.at(-1).emit('close', 1);
  t.mock.timers.tick(1000); await flush(); f.ready(); await flush();
  t.mock.timers.tick(60000); f.children.at(-1).emit('close', 1);
  t.mock.timers.tick(1000); await flush(); assert.equal(f.children.length, 4);
});

test('disposal cancels recovery and releases the retained workspace API', async t => {
  const f = fixture(t); await flush(); f.ready(); await flush(); f.children[0].emit('close', 1);
  for (const item of f.context.subscriptions.slice().reverse()) item.dispose();
  f.context.subscriptions.length = 0;
  t.mock.timers.tick(60000); await flush();
  assert.equal(f.children.length, 1); assert.equal(f.disposals, 1);
});
