'use strict';

// Guest-side MCP tools against a scripted fake bridge on a Windows named pipe.
// Never touches ~/.liveshare-local: every test uses a temp LSWB_REGISTRY_DIR.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const EXTENSION_DIR = path.join(__dirname, '..');
const { version: PACKAGE_VERSION } = require('../package.json');
const tools = require('../mcp-tools.cjs');

const RESPONSE_TIMEOUT_MS = 15000;
const ROOT = 'vsls:/';
const WINDOWS_ONLY = { skip: process.platform !== 'win32' && 'named pipes require Windows' };
const WRITE_TOOLS = ['lswb_write_file', 'lswb_edit_file', 'lswb_save_file', 'lswb_rename_symbol', 'lswb_format'];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTempRegistry(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lswb-mcp-tools-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return path.join(base, 'instances');
}

function isDiscoveryProbe(body) {
  return body.op === 'info' && body.epoch === undefined;
}

function answer(socket, reply) {
  if (reply === 'drop') {
    socket.destroy();
    return;
  }
  socket.end(JSON.stringify(reply) + '\n');
}

function handleConnection(bridge, socket) {
  socket.setEncoding('utf8');
  let buffered = '';
  socket.on('error', () => {});
  socket.on('data', data => {
    buffered += data;
    const end = buffered.indexOf('\n');
    if (end === -1) {
      return;
    }
    const body = JSON.parse(buffered.slice(0, end));
    bridge.received.push(body);
    if (isDiscoveryProbe(body)) {
      answer(socket, { ok: true, result: bridge.info });
      return;
    }
    answer(socket, bridge.reply(body));
  });
}

// Starts a fake bridge and writes its discovery record into registryDir.
async function startScriptedBridge(t, registryDir, { roots = [{ name: 'proj', uri: ROOT }], epoch = 7, reply }) {
  const id = crypto.randomUUID();
  const pipeName = `liveshare-local-${process.pid}-${id}`;
  const bridge = {
    id,
    epoch,
    pipeName,
    received: [],
    info: { id, epoch, version: PACKAGE_VERSION, roots },
    reply,
  };
  const server = net.createServer(socket => handleConnection(bridge, socket));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(`\\\\.\\pipe\\${pipeName}`, resolve);
  });
  fs.mkdirSync(registryDir, { recursive: true });
  const record = { id, pipeName, epoch, version: PACKAGE_VERSION, pid: process.pid };
  fs.writeFileSync(path.join(registryDir, `${id}.json`), JSON.stringify(record));
  return bridge;
}

function operationRequests(bridge) {
  return bridge.received.filter(body => !isDiscoveryProbe(body));
}

function probeCount(bridge) {
  return bridge.received.filter(isDiscoveryProbe).length;
}

// ---------------------------------------------------------------------------
// MCP server subprocess
// ---------------------------------------------------------------------------

function startServer(t, registryDir) {
  const child = spawn(process.execPath, ['mcp-server.cjs'], {
    cwd: EXTENSION_DIR,
    env: { ...process.env, LSWB_REGISTRY_DIR: registryDir },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null) {
      child.kill();
    }
  });
  return createSession(child);
}

function createSession(child) {
  const pending = new Map();
  let buffered = '';
  let stderr = '';
  let nextId = 1;

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => {
    stderr += data;
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', data => {
    buffered += data;
    let end = buffered.indexOf('\n');
    while (end !== -1) {
      deliver(JSON.parse(buffered.slice(0, end)));
      buffered = buffered.slice(end + 1);
      end = buffered.indexOf('\n');
    }
  });

  function deliver(message) {
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      waiter(message);
    }
  }

  function request(method, params) {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No response to ${method}. stderr: ${stderr}`)), RESPONSE_TIMEOUT_MS);
      pending.set(id, message => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async function callTool(name, args) {
    const response = await request('tools/call', { name, arguments: args });
    return response;
  }

  return { request, callTool };
}

// ---------------------------------------------------------------------------
// Per-tool round trips
// ---------------------------------------------------------------------------

const EDIT_RESULT = {
  applied: true,
  saved: false,
  files: [
    { changes: 1, saved: true, uri: 'vsls:/a.txt', version: 4, dirty: false, lineCount: 2, eol: 'LF' },
    {
      changes: 2,
      saved: false,
      uri: 'vsls:/b.txt',
      version: 9,
      dirty: true,
      lineCount: 5,
      eol: 'CRLF',
      error: { code: 'save_failed', message: 'Document.save() returned false; applied text remains in the editor.' },
    },
  ],
};

const CASES = [
  { tool: 'lswb_list_dir', op: 'list', fields: {} },
  { tool: 'lswb_list_dir', op: 'list', fields: { path: 'src' } },
  { tool: 'lswb_read_file', op: 'read', fields: { path: 'a.txt', startLine: 1, endLine: 3, withHash: true } },
  { tool: 'lswb_read_many', op: 'readMany', fields: { files: [{ path: 'a.txt' }, { path: 'b.txt', startLine: 2, endLine: 2, withHash: false }] } },
  { tool: 'lswb_create_file', op: 'create', fields: { path: 'new/c.txt', text: 'hi\n', eol: 'CRLF', parents: true } },
  { tool: 'lswb_write_file', op: 'write', fields: { path: 'a.txt', text: 'x', expectedVersion: 3, expectedHash: 'abc', allowDirty: false } },
  {
    tool: 'lswb_edit_file',
    op: 'edit',
    fields: {
      files: [
        { path: 'a.txt', expectedVersion: 3, changes: [{ oldText: 'a', newText: 'b', all: true }] },
        {
          path: 'b.txt',
          expectedHash: 'h',
          allowDirty: true,
          changes: [
            { startLine: 1, endLine: 2, newText: 'z', expectedText: 'y' },
            { range: { start: { line: 3, character: 0 }, end: { line: 3, character: 2 } }, newText: '' },
          ],
        },
      ],
    },
    result: EDIT_RESULT,
  },
  { tool: 'lswb_save_file', op: 'save', fields: { path: 'a.txt', expectedVersion: 5 } },
  { tool: 'lswb_mkdir', op: 'mkdir', fields: { path: 'dir/sub' } },
  { tool: 'lswb_stat', op: 'stat', fields: { path: 'a.txt' } },
  { tool: 'lswb_move', op: 'move', fields: { path: 'a.txt', to: 'b/a.txt', parents: false, overwrite: true } },
  { tool: 'lswb_delete', op: 'delete', fields: { path: 'old.txt' } },
  { tool: 'lswb_diagnostics', op: 'diagnostics', fields: { path: 'a.ts' } },
  { tool: 'lswb_document_symbols', op: 'symbols', fields: { path: 'a.ts' } },
  { tool: 'lswb_workspace_symbols', op: 'workspaceSymbols', fields: { query: 'Widget' } },
  { tool: 'lswb_definition', op: 'definition', fields: { path: 'a.ts', line: 4, character: 2 } },
  { tool: 'lswb_references', op: 'references', fields: { path: 'a.ts', line: 4 } },
  {
    tool: 'lswb_rename_symbol',
    op: 'renameSymbol',
    fields: { path: 'a.ts', line: 2, character: 1, newName: 'Gadget', preview: true, expectedVersion: 1, expectedHash: 'h', allowDirty: false },
  },
  { tool: 'lswb_format', op: 'format', fields: { path: 'a.ts', tabSize: 4, insertSpaces: false, expectedVersion: 2, allowDirty: true } },
];

function presetResult(entry, index) {
  if (entry.result) {
    return entry.result;
  }
  return { echo: entry.op, index, nested: { kept: [1, 2, 3] } };
}

test('every Guest tool sends exactly its fields and returns the result unchanged', WINDOWS_ONLY, async t => {
  const registryDir = makeTempRegistry(t);
  let current = null;
  const bridge = await startScriptedBridge(t, registryDir, {
    reply: () => ({ ok: true, result: current }),
  });
  const session = startServer(t, registryDir);

  for (const [index, entry] of CASES.entries()) {
    current = presetResult(entry, index);
    const before = operationRequests(bridge).length;
    const response = await session.callTool(entry.tool, { workspace: ROOT, ...entry.fields });
    const label = `${entry.tool} #${index}`;
    assert.equal(response.error, undefined, label);
    assert.notEqual(response.result.isError, true, label);
    assert.deepEqual(response.result.structuredContent, current, label);
    assert.deepEqual(JSON.parse(response.result.content[0].text), current, label);
    const sent = operationRequests(bridge).slice(before);
    assert.equal(sent.length, 1, label);
    const expected = { op: entry.op, instance: bridge.id, epoch: bridge.epoch, workspace: ROOT, ...entry.fields };
    assert.deepEqual(sent[0], expected, label);
  }
  const covered = new Set(CASES.map(entry => entry.tool));
  const guestTools = tools.TOOLS.map(tool => tool.name).filter(name => !['lswb_list_workspaces', 'lswb_status'].includes(name));
  assert.deepEqual(guestTools.filter(name => !covered.has(name)), []);
  // One lazy discovery bound the root for every later call.
  assert.equal(probeCount(bridge), 1);
});

test('lswb_status returns extension info plus MCP process identity', WINDOWS_ONLY, async t => {
  const registryDir = makeTempRegistry(t);
  const info = { id: 'x', epoch: 7, roots: [], permissions: { read: true }, dirtyDocuments: ['vsls:/a.txt'] };
  const bridge = await startScriptedBridge(t, registryDir, {
    reply: () => ({ ok: true, result: info }),
  });
  const session = startServer(t, registryDir);

  const response = await session.callTool('lswb_status', { workspace: ROOT });
  assert.notEqual(response.result.isError, true);
  const structured = response.result.structuredContent;
  assert.equal(structured.mcp.account, os.userInfo().username);
  assert.equal(typeof structured.mcp.pid, 'number');
  assert.notEqual(structured.mcp.pid, process.pid);
  assert.equal(structured.mcp.serverVersion, PACKAGE_VERSION);
  assert.deepEqual({ ...structured, mcp: undefined }, { ...info, mcp: undefined });
  assert.deepEqual(operationRequests(bridge), [
    { op: 'info', instance: bridge.id, epoch: bridge.epoch, workspace: ROOT },
  ]);
});

// ---------------------------------------------------------------------------
// tools/list
// ---------------------------------------------------------------------------

test('tools/list exposes described, closed schemas bound to a workspace', async t => {
  const session = startServer(t, makeTempRegistry(t));
  const response = await session.request('tools/list', {});
  const listed = response.result.tools;
  assert.equal(listed.length, tools.TOOLS.length);
  for (const tool of listed) {
    assert.ok(tool.description.length > 0, tool.name);
    assert.ok(tool.description.includes('WHEN TO USE'), tool.name);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    assert.equal('validate' in tool, false, tool.name);
    if (tool.name !== 'lswb_list_workspaces') {
      assert.ok(tool.inputSchema.required.includes('workspace'), tool.name);
      assert.ok(tool.inputSchema.properties.workspace.description.includes('root uri from lswb_list_workspaces'), tool.name);
    }
  }
  const byName = Object.fromEntries(listed.map(tool => [tool.name, tool]));
  for (const name of WRITE_TOOLS) {
    assert.ok(byName[name].description.includes('expectedVersion'), name);
  }
  assert.ok(byName.lswb_save_file.inputSchema.required.includes('expectedVersion'));
  assert.deepEqual(byName.lswb_edit_file.inputSchema.properties.files.items.required, ['path', 'changes']);
  assert.equal(byName.lswb_edit_file.inputSchema.properties.expectedVersion, undefined);
  assert.ok(byName.lswb_delete.description.includes('Recursive deletion is not supported'));
});

// ---------------------------------------------------------------------------
// Binding and error handling
// ---------------------------------------------------------------------------

test('an unknown root uri is reported as workspace_not_found', WINDOWS_ONLY, async t => {
  const registryDir = makeTempRegistry(t);
  const bridge = await startScriptedBridge(t, registryDir, {
    reply: () => ({ ok: true, result: {} }),
  });
  const session = startServer(t, registryDir);

  const response = await session.callTool('lswb_read_file', { workspace: 'vsls:/other/', path: 'a.txt' });
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.code, 'workspace_not_found');
  assert.ok(response.result.structuredContent.message.includes('lswb_list_workspaces'));
  assert.deepEqual(operationRequests(bridge), []);
});

test('workspace_changed clears the binding and the next call rediscovers', WINDOWS_ONLY, async t => {
  const registryDir = makeTempRegistry(t);
  let changed = true;
  const bridge = await startScriptedBridge(t, registryDir, {
    reply: () => {
      if (changed) {
        changed = false;
        return { ok: false, error: { code: 'workspace_changed', message: 'Workspace changed since discovery; rediscover the instance.' } };
      }
      return { ok: true, result: { text: 'ok' } };
    },
  });
  const session = startServer(t, registryDir);

  const listed = await session.callTool('lswb_list_workspaces', {});
  assert.equal(listed.result.structuredContent.status, 'ready');
  assert.equal(probeCount(bridge), 1);

  const first = await session.callTool('lswb_read_file', { workspace: ROOT, path: 'a.txt' });
  assert.equal(first.result.isError, true);
  const structured = first.result.structuredContent;
  assert.equal(structured.code, 'workspace_changed');
  assert.ok(structured.message.includes('Call lswb_list_workspaces again and retry with the new workspace list.'));
  assert.ok(structured.message.includes('inspect the target before retrying'));
  assert.equal(probeCount(bridge), 1);

  const second = await session.callTool('lswb_read_file', { workspace: ROOT, path: 'a.txt' });
  assert.notEqual(second.result.isError, true);
  assert.deepEqual(second.result.structuredContent, { text: 'ok' });
  assert.equal(probeCount(bridge), 2);
  assert.equal(operationRequests(bridge).length, 2);
});

test('binding-code errors remove the in-process binding entry', WINDOWS_ONLY, async t => {
  const registryDir = makeTempRegistry(t);
  const previous = process.env.LSWB_REGISTRY_DIR;
  process.env.LSWB_REGISTRY_DIR = registryDir;
  t.after(() => {
    if (previous === undefined) {
      delete process.env.LSWB_REGISTRY_DIR;
    } else {
      process.env.LSWB_REGISTRY_DIR = previous;
    }
    tools.clearBindings();
  });
  const bridge = await startScriptedBridge(t, registryDir, {
    reply: () => ({ ok: false, error: { code: 'instance_mismatch', message: 'The selected VS Code instance changed.', details: { a: 1 } } }),
  });
  const readFile = tools.TOOLS.find(tool => tool.name === 'lswb_read_file');

  tools.clearBindings();
  const listWorkspaces = tools.TOOLS.find(tool => tool.name === 'lswb_list_workspaces');
  await listWorkspaces.handler({});
  assert.deepEqual(tools.getBinding(ROOT), {
    instance: bridge.id,
    epoch: bridge.epoch,
    pipeName: bridge.pipeName,
    pid: process.pid,
  });

  const outcome = await readFile.handler({ workspace: ROOT, path: 'a.txt' });
  assert.equal(outcome.isError, true);
  assert.equal(outcome.structuredContent.code, 'instance_mismatch');
  assert.deepEqual(outcome.structuredContent.details, { a: 1 });
  assert.equal(tools.getBinding(ROOT), undefined);
  assert.deepEqual(tools.bindingRoots(), []);
});

test('non-binding extension errors keep their code and the binding', WINDOWS_ONLY, async t => {
  const registryDir = makeTempRegistry(t);
  const error = { code: 'content_changed', message: 'Document version changed.', details: { actualVersion: 9 } };
  const bridge = await startScriptedBridge(t, registryDir, {
    reply: () => ({ ok: false, error }),
  });
  const session = startServer(t, registryDir);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await session.callTool('lswb_save_file', { workspace: ROOT, path: 'a.txt', expectedVersion: 1 });
    assert.equal(response.result.isError, true);
    assert.deepEqual(response.result.structuredContent, error);
  }
  assert.equal(probeCount(bridge), 1);
});

test('a dropped connection after sending is transport_outcome_unknown and never replayed', WINDOWS_ONLY, async t => {
  const registryDir = makeTempRegistry(t);
  const bridge = await startScriptedBridge(t, registryDir, {
    reply: () => 'drop',
  });
  const session = startServer(t, registryDir);

  const response = await session.callTool('lswb_write_file', { workspace: ROOT, path: 'a.txt', text: 'x', expectedVersion: 1 });
  assert.equal(response.result.isError, true);
  const structured = response.result.structuredContent;
  assert.equal(structured.code, 'transport_outcome_unknown');
  assert.equal(structured.details.requestSent, true);
  assert.ok(structured.message.includes('The request may have been applied; inspect the target before retrying.'));
  // Give any accidental retry time to arrive before counting.
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(operationRequests(bridge).length, 1);
});

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

test('invalid tool arguments are rejected with -32602 before any request', async t => {
  const session = startServer(t, makeTempRegistry(t));
  const invalid = [
    ['lswb_read_file', { workspace: ROOT }],
    ['lswb_read_file', { path: 'a.txt' }],
    ['lswb_read_file', { workspace: ROOT, path: 'a.txt', extra: 1 }],
    ['lswb_definition', { workspace: ROOT, path: 'a.ts', line: '4' }],
    ['lswb_read_file', { workspace: ROOT, path: 'a.txt', startLine: 1.5 }],
    ['lswb_edit_file', { workspace: ROOT, expectedVersion: 1, files: [{ path: 'a', changes: [{ oldText: 'a', newText: 'b' }] }] }],
    ['lswb_edit_file', { workspace: ROOT, files: [{ path: 'a', changes: [{ oldText: 'a' }] }] }],
    ['lswb_create_file', { workspace: ROOT, path: 'a', text: 'x', eol: 'CR' }],
    ['lswb_save_file', { workspace: ROOT, path: 'a.txt' }],
    ['lswb_read_many', { workspace: ROOT, files: ['a.txt'] }],
  ];
  for (const [name, args] of invalid) {
    const response = await session.callTool(name, args);
    assert.equal(response.error && response.error.code, -32602, `${name} ${JSON.stringify(args)}`);
  }
});

test('validateAgainstSchema reports specific nested paths', () => {
  const edit = tools.TOOLS.find(tool => tool.name === 'lswb_edit_file');
  const bad = { workspace: ROOT, files: [{ path: 'a', changes: [{ newText: 'x' }, { newText: 1 }] }] };
  assert.equal(edit.validate(bad), 'files[0].changes[1].newText must be a string.');
  const range = { workspace: ROOT, files: [{ path: 'a', changes: [{ newText: '', range: { start: { line: 0 }, end: { line: 0, character: 0 } } }] }] };
  assert.equal(edit.validate(range), 'files[0].changes[0].range.start.character is required.');
  const misplaced = { workspace: ROOT, files: [{ path: 'a', changes: [{ newText: 'x' }], expectedVersion: 2, oops: true }] };
  assert.equal(edit.validate(misplaced), 'files[0].oops is not an allowed argument.');
  const good = { workspace: ROOT, files: [{ path: 'a', expectedVersion: 2, changes: [{ startLine: 1, endLine: 1, newText: 'x' }] }] };
  assert.equal(edit.validate(good), null);
  const create = tools.TOOLS.find(tool => tool.name === 'lswb_create_file');
  assert.equal(create.validate({ workspace: ROOT, path: 'a', text: '', eol: 'CR' }), 'eol must be one of LF, CRLF.');
  assert.equal(tools.validateAgainstSchema({ type: 'integer' }, 2.5, 'n'), 'n must be an integer.');
});
