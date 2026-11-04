'use strict';
const { removeTempDirectory } = require('./temp-cleanup.cjs');
// Dispatch-layer scheduling in extension.cjs, with a fake IPC helper process.
// The real pipe-host.ps1 forwards one request at a time; several in-flight
// frames occur only when an older request outlives a replaced helper. This
// test drives that scheduling directly.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.replies = [];
  child.stdin = new PassThrough();
  child.stdin.on('data', chunk => {
    for (const line of chunk.toString('utf8').split('\n').filter(Boolean)) {
      child.replies.push(JSON.parse(line));
    }
  });
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  child.frame = value => child.stdout.write(JSON.stringify(value) + '\n');
  return child;
}

function fakeVscode() {
  const disposable = { dispose() {} };
  return {
    window: {
      createOutputChannel: () => ({ appendLine() {}, append() {}, dispose() {} }),
    },
    workspace: {
      getConfiguration: () => ({ get: () => undefined }),
      onDidChangeWorkspaceFolders: () => disposable,
      onDidChangeConfiguration: () => disposable,
    },
    commands: { registerCommand: () => disposable },
  };
}

// Blocks hostBind and list until released; every other op answers at once.
function fakeApi(release) {
  return {
    dispatch(body) {
      if (body.op === 'hostBind' || body.op === 'list') {
        return release.then(() => ({ op: body.op }));
      }
      return { op: body.op };
    },
    roots: () => [],
    permissions: { value: () => true },
    dispose() {},
    workspaceChanged() {},
    terminalClosed() {},
    configurationChanged() {},
  };
}

// Spreads the real module so a new ipc-access export cannot silently break
// activation here; only the parts that touch settings, accounts or UI are stubbed.
function fakeIpcAccess() {
  const realIpcAccess = require('../ipc-access.cjs');
  return {
    ...realIpcAccess,
    prepareAccess: async () => ({ mode: 'ownerOnly', selectedUserSids: [], migratedLegacy: false }),
    listLocalUsers: async () => [],
    configureAccess: async () => {},
    noticeRemovedMode: async () => {},
  };
}

function loadExtension(stubs) {
  const loader = Module._load;
  const modulePath = require.resolve('../extension.cjs');
  delete require.cache[modulePath];
  Module._load = function load(name, parent, isMain) {
    if (Object.hasOwn(stubs, name)) {
      return stubs[name];
    }
    return loader.call(this, name, parent, isMain);
  };
  try {
    return require('../extension.cjs');
  } finally {
    Module._load = loader;
  }
}

async function waitForReplies(child, count) {
  const deadline = Date.now() + 3000;
  while (child.replies.length < count) {
    if (Date.now() > deadline) {
      throw new Error(`Expected ${count} replies, got ${child.replies.length}.`);
    }
    await delay(10);
  }
}

test('a pending hostBind does not block hostStatus or info; other ops stay queued', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lswb-dispatch-home-'));
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  let releaseQueue;
  const release = new Promise(resolve => {
    releaseQueue = resolve;
  });
  const child = fakeChild();
  const context = { subscriptions: [] };
  t.after(async () => {
    for (const disposable of context.subscriptions.slice().reverse()) {
      disposable.dispose();
    }
    Object.defineProperty(process, 'platform', platform);
    await removeTempDirectory(home, { prefix: 'lswb-dispatch-home-' });
  });
  const extension = loadExtension({
    vscode: fakeVscode(),
    'node:os': { ...os, homedir: () => home },
    'node:child_process': { spawn: () => child },
    './workspace.cjs': { createWorkspaceApi: () => fakeApi(release) },
    './ipc-access.cjs': fakeIpcAccess(),
    './mcp-launcher-install.cjs': { installLauncher() {}, launcherPath: () => '', renderMcpConfig: () => '' },
    './mcp-definition-provider.cjs': { registerMcpDefinitionProvider: () => ({ dispose() {} }) },
  });
  extension.activate(context);
  await delay(20);
  child.frame({ kind: 'ready', shell: {}, ipc: { mode: 'ownerOnly' } });
  await delay(20);

  child.frame({ kind: 'request', body: { op: 'hostBind' } });
  child.frame({ kind: 'request', body: { op: 'list' } });
  child.frame({ kind: 'request', body: { op: 'hostStatus' } });
  child.frame({ kind: 'request', body: { op: 'info' } });
  await waitForReplies(child, 2);
  await delay(50);
  assert.deepEqual(child.replies.map(x => x.result.op), ['hostStatus', 'info']);

  releaseQueue();
  await waitForReplies(child, 4);
  assert.deepEqual(child.replies.map(x => x.result.op), ['hostStatus', 'info', 'hostBind', 'list']);
});
