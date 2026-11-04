'use strict';

// Shared fixtures for the MCP tool tests: a scripted fake bridge on a Windows
// named pipe and an mcp-server.cjs subprocess session.
// Never touches ~/.liveshare-local: every test uses a temp LSWB_REGISTRY_DIR.

const { spawn } = require('node:child_process');
const { removeTempDirectory } = require('./temp-cleanup.cjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const EXTENSION_DIR = path.join(__dirname, '..');
const { version: PACKAGE_VERSION } = require('../package.json');

const RESPONSE_TIMEOUT_MS = 15000;
const ROOT = 'vsls:/';
const WINDOWS_ONLY = { skip: process.platform !== 'win32' && 'named pipes require Windows' };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTempRegistry(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lswb-mcp-tools-'));
  t.after(() => removeTempDirectory(base, { prefix: 'lswb-mcp-tools-' }));
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

module.exports = {
  PACKAGE_VERSION,
  ROOT,
  WINDOWS_ONLY,
  makeTempRegistry,
  isDiscoveryProbe,
  startScriptedBridge,
  operationRequests,
  probeCount,
  startServer,
};
