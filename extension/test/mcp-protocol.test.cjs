'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { removeTempDirectory } = require('./temp-cleanup.cjs');

const EXTENSION_DIR = path.join(__dirname, '..');
const { version: PACKAGE_VERSION } = require('../package.json');
const RESPONSE_TIMEOUT_MS = 10000;

function makeTempRegistry(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lswb-mcp-'));
  t.after(() => removeTempDirectory(base, { prefix: 'lswb-mcp-' }));
  // Nested on purpose: discover() also reads <parent>/startup-diagnostics.
  return path.join(base, 'instances');
}

function startServer(t, registryDir) {
  const child = spawn(process.execPath, ['mcp-server.cjs'], {
    cwd: EXTENSION_DIR,
    env: { ...process.env, LSWB_REGISTRY_DIR: registryDir },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const session = createSession(child);
  t.after(() => {
    if (child.exitCode === null) {
      child.kill();
    }
  });
  return session;
}

function createSession(child) {
  const received = [];
  const nonJson = [];
  const waiters = [];
  let buffered = '';
  let stderr = '';

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => {
    stderr += data;
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', data => {
    buffered += data;
    let end = buffered.indexOf('\n');
    while (end !== -1) {
      acceptLine(buffered.slice(0, end));
      buffered = buffered.slice(end + 1);
      end = buffered.indexOf('\n');
    }
  });
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));

  function acceptLine(line) {
    try {
      received.push(JSON.parse(line));
    } catch {
      nonJson.push(line);
    }
    wake();
  }

  function wake() {
    while (waiters.length && received.length) {
      waiters.shift().resolve(received.shift());
    }
  }

  function next() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No response. stderr: ${stderr}`)), RESPONSE_TIMEOUT_MS);
      waiters.push({
        resolve: value => {
          clearTimeout(timer);
          resolve(value);
        },
      });
      wake();
    });
  }

  function sendRaw(text) {
    child.stdin.write(text + '\n');
  }

  function send(message) {
    sendRaw(JSON.stringify({ jsonrpc: '2.0', ...message }));
  }

  async function request(id, method, params) {
    send({ id, method, ...(params === undefined ? {} : { params }) });
    const response = await next();
    assert.equal(response.id, id);
    return response;
  }

  async function close() {
    child.stdin.end();
    const code = await exited;
    if (buffered) {
      nonJson.push(buffered);
    }
    return code;
  }

  return { send, sendRaw, next, request, close, nonJson, received };
}

function initializeParams(protocolVersion) {
  return {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  };
}

async function closeCleanly(session) {
  assert.equal(await session.close(), 0);
  assert.deepEqual(session.nonJson, []);
  assert.deepEqual(session.received, []);
}

test('mcp handshake, ping, tools/list and an empty discovery', async t => {
  const session = startServer(t, makeTempRegistry(t));

  const init = await session.request(1, 'initialize', initializeParams('2025-06-18'));
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.deepEqual(init.result.serverInfo, { name: 'liveshare-workspace-bridge', version: PACKAGE_VERSION });

  session.send({ method: 'notifications/initialized' });
  const ping = await session.request(2, 'ping');
  assert.deepEqual(ping.result, {});

  const list = await session.request(3, 'tools/list');
  const tool = list.result.tools.find(candidate => candidate.name === 'lswb_list_workspaces');
  assert.ok(tool, 'tools/list includes lswb_list_workspaces');
  assert.ok(tool.description.includes('WHEN TO USE'));
  assert.deepEqual(tool.inputSchema, { type: 'object', properties: {}, additionalProperties: false });

  const call = await session.request(4, 'tools/call', { name: 'lswb_list_workspaces', arguments: {} });
  assert.notEqual(call.result.isError, true);
  assert.equal(call.result.structuredContent.status, 'no_records');
  assert.deepEqual(call.result.structuredContent.workspaces, []);
  assert.equal(call.result.content[0].type, 'text');
  assert.deepEqual(JSON.parse(call.result.content[0].text), call.result.structuredContent);

  await closeCleanly(session);
});

test('protocol version negotiation echoes supported versions and falls back otherwise', async t => {
  const session = startServer(t, makeTempRegistry(t));
  const older = await session.request(1, 'initialize', initializeParams('2024-11-05'));
  assert.equal(older.result.protocolVersion, '2024-11-05');
  const unknown = await session.request(2, 'initialize', initializeParams('1999-01-01'));
  assert.equal(unknown.result.protocolVersion, '2025-06-18');
  await closeCleanly(session);
});

test('malformed, unknown and invalid requests return JSON-RPC errors without stopping the server', async t => {
  const session = startServer(t, makeTempRegistry(t));

  session.sendRaw('{"jsonrpc":"2.0","id":1,"method":');
  const parse = await session.next();
  assert.equal(parse.id, null);
  assert.equal(parse.error.code, -32700);

  const unknown = await session.request(2, 'no/such/method');
  assert.equal(unknown.error.code, -32601);

  const missing = await session.request(3, 'initialize', { capabilities: {} });
  assert.equal(missing.error.code, -32602);

  const badTool = await session.request(4, 'tools/call', { name: 'lswb_missing', arguments: {} });
  assert.equal(badTool.error.code, -32602);

  const extraArgs = await session.request(5, 'tools/call', { name: 'lswb_list_workspaces', arguments: { x: 1 } });
  assert.equal(extraArgs.error.code, -32602);

  session.send({ method: 'notifications/unknown' });
  const ping = await session.request(6, 'ping');
  assert.deepEqual(ping.result, {});

  await closeCleanly(session);
});

test('an oversized line is rejected with -32600 and the server keeps answering', async t => {
  const session = startServer(t, makeTempRegistry(t));
  const padding = 'x'.repeat(4 * 1024 * 1024 + 1024);
  session.sendRaw(`{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":"${padding}"}}`);
  session.send({ id: 2, method: 'ping' });

  const rejected = await session.next();
  assert.equal(rejected.id, null);
  assert.equal(rejected.error.code, -32600);
  const ping = await session.next();
  assert.equal(ping.id, 2);
  assert.deepEqual(ping.result, {});

  await closeCleanly(session);
});

test('an invalid registry is reported as a tool error, not an empty list', async t => {
  const registryDir = makeTempRegistry(t);
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(path.join(registryDir, `${crypto.randomUUID()}.json`), '{"secret":"do not echo"');
  const session = startServer(t, registryDir);

  const call = await session.request(1, 'tools/call', { name: 'lswb_list_workspaces', arguments: {} });
  assert.equal(call.result.isError, true);
  const structured = call.result.structuredContent;
  assert.equal(structured.code, 'discovery_invalid_registry');
  assert.equal(typeof structured.message, 'string');
  assert.equal(structured.details.status, 'invalid_registry');
  assert.equal(structured.details.issues.length, 1);
  assert.equal(call.result.content[0].text.includes('do not echo'), false);

  await closeCleanly(session);
});

function startFakeBridge(t, info) {
  const pipeName = `liveshare-local-${process.pid}-${info.id}`;
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    let buffered = '';
    socket.on('data', data => {
      buffered += data;
      if (buffered.includes('\n')) {
        socket.end(JSON.stringify({ ok: true, result: info }) + '\n');
      }
    });
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(`\\\\.\\pipe\\${pipeName}`, () => resolve(pipeName));
  });
}

test('a live bridge instance is listed as a ready workspace', { skip: process.platform !== 'win32' && 'named pipes require Windows' }, async t => {
  const registryDir = makeTempRegistry(t);
  const id = crypto.randomUUID();
  const roots = [{ name: 'proj', uri: 'vsls:/' }];
  const pipeName = await startFakeBridge(t, { id, epoch: 2, version: PACKAGE_VERSION, roots });
  fs.mkdirSync(registryDir, { recursive: true });
  const record = { id, pipeName, epoch: 1, version: PACKAGE_VERSION, pid: process.pid };
  fs.writeFileSync(path.join(registryDir, `${id}.json`), JSON.stringify(record));
  const session = startServer(t, registryDir);

  const call = await session.request(1, 'tools/call', { name: 'lswb_list_workspaces', arguments: {} });
  assert.notEqual(call.result.isError, true);
  const structured = call.result.structuredContent;
  assert.equal(structured.status, 'ready');
  assert.deepEqual(structured.workspaces, [
    { instance: id, epoch: 2, version: PACKAGE_VERSION, pid: process.pid, roots },
  ]);
  assert.equal(structured.probes[0].status, 'connected');
  assert.deepEqual(structured.issues, []);

  await closeCleanly(session);
});
