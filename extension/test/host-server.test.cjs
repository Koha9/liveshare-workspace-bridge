'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const SKIP = process.platform !== 'win32';
const SCRIPT = path.join(__dirname, '..', 'host-server.ps1');
const PREFIX = 'lswb server ';

function powershellPath() {
  return path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
}

function powershellEnv() {
  const modules = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules');
  return { ...process.env, PSModulePath: modules + ';' + (process.env.PSModulePath || '') };
}

function makeRoot(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(directory).startsWith(PREFIX));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function listen(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(null));
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise(resolve => server.close(() => resolve()));
}

// Find `count` consecutive free loopback ports. Excluded (Hyper-V) ports fail
// to bind with EACCES, so probing also avoids reserved ranges.
async function freePorts(count) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const first = 20000 + crypto.randomInt(40000 - count);
    const servers = [];
    for (let offset = 0; offset < count; offset++) {
      const server = await listen(first + offset);
      if (!server) break;
      servers.push(server);
    }
    await Promise.all(servers.map(closeServer));
    if (servers.length === count) return first;
  }
  throw new Error('No free consecutive loopback ports found.');
}

function startServer(t, options) {
  const args = [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', SCRIPT,
    '-Token', options.token,
    '-Port', String(options.port),
    '-WorkspaceRoot', options.root,
    '-IdleTimeoutMs', String(options.idleMs),
  ];
  const child = spawn(powershellPath(), args, { windowsHide: true, env: powershellEnv() });
  const state = { stdout: '', stderr: '' };
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { state.stderr += chunk; });
  const banner = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No LSWB_LISTENING line.\n' + state.stdout + state.stderr)), 60000);
    child.stdout.on('data', chunk => {
      state.stdout += chunk;
      const match = /^LSWB_LISTENING:(.*)$/mu.exec(state.stdout);
      if (match && state.stdout.includes('Press Ctrl+C to stop.')) {
        clearTimeout(timer);
        resolve(JSON.parse(match[1].trim()));
      }
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Host helper exited with ${code}.\n` + state.stdout + state.stderr));
    });
  });
  return { child, state, exited, banner };
}

function send(port, payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    let received = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => { received += chunk; });
    socket.on('error', error => {
      if (!received) reject(error);
    });
    socket.on('close', () => {
      try {
        resolve(JSON.parse(received));
      } catch (error) {
        reject(new Error('Invalid response: ' + received.slice(0, 200)));
      }
    });
    socket.write(text + '\n');
  });
}

function request(port, token, action, fields = {}) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  return send(port, { token, nonce, action, ...fields }).then(reply => ({ reply, nonce }));
}

test('Host TCP helper answers hello, rejects bad tokens and oversized lines, serves stat and shuts down', { skip: SKIP, timeout: 120000 }, async t => {
  const root = makeRoot(t);
  const token = crypto.randomBytes(24).toString('hex');
  const port = await freePorts(1);
  const server = startServer(t, { token, port, root, idleMs: 60000 });
  const banner = await server.banner;
  assert.deepEqual(banner, { port, protocol: 3, token: token.slice(0, 8) });
  assert.match(server.state.stdout, /Live Share Workspace Bridge host helper listening on 127\.0\.0\.1:\d+\. Idle exit after 1 minutes\. Press Ctrl\+C to stop\./u);

  const hello = await request(port, token, 'hello');
  assert.equal(hello.reply.ok, true, JSON.stringify(hello.reply));
  assert.equal(hello.reply.nonce, hello.nonce);
  assert.equal(hello.reply.result.protocol, 3);
  assert.equal(hello.reply.result.transport, 'tcp');
  assert.equal(hello.reply.result.root.toLowerCase(), fs.realpathSync.native(root).toLowerCase());

  const rejected = await request(port, 'wrong-' + token, 'hello');
  assert.equal(rejected.reply.ok, false);
  assert.equal(rejected.reply.error.code, 'host_token_rejected');
  assert.equal(rejected.reply.result, undefined);
  assert.equal(rejected.reply.nonce, undefined);

  const content = Buffer.from('host server stat sample\n', 'utf8');
  fs.writeFileSync(path.join(root, 'sample.txt'), content);
  const stat = await request(port, token, 'stat', { path: 'sample.txt', withHash: true });
  assert.equal(stat.reply.ok, true, JSON.stringify(stat.reply));
  assert.equal(stat.reply.result.directory, false);
  assert.equal(stat.reply.result.size, content.length);
  assert.equal(stat.reply.result.sha256, crypto.createHash('sha256').update(content).digest('hex'));
  assert.equal(typeof stat.reply.result.mtime, 'string');
  assert.equal(typeof stat.reply.result.ctime, 'string');

  const oversized = JSON.stringify({ token, nonce: 'big', action: 'hello', pad: 'a'.repeat(2 * 1024 * 1024 + 64) });
  const limited = await send(port, oversized);
  assert.equal(limited.ok, false);
  assert.equal(limited.error.code, 'request_limit');
  const after = await request(port, token, 'hello');
  assert.equal(after.reply.ok, true);

  const stop = await request(port, token, 'shutdown');
  assert.equal(stop.reply.ok, true);
  assert.equal(stop.reply.result.stopping, true);
  assert.equal(await server.exited, 0, server.state.stdout + server.state.stderr);
  assert.match(server.state.stdout, /\] stat ok sample\.txt/u);
  assert.doesNotMatch(server.state.stdout, new RegExp(token));
});

test('Host TCP helper moves to the next port when the candidate is occupied', { skip: SKIP, timeout: 120000 }, async t => {
  const root = makeRoot(t);
  const token = crypto.randomBytes(24).toString('hex');
  const port = await freePorts(2);
  const blocker = await listen(port);
  assert.ok(blocker, 'Could not occupy the candidate port.');
  t.after(() => closeServer(blocker));
  const server = startServer(t, { token, port, root, idleMs: 60000 });
  const banner = await server.banner;
  assert.equal(banner.port, port + 1);
  const hello = await request(port + 1, token, 'hello');
  assert.equal(hello.reply.ok, true);
  await request(port + 1, token, 'shutdown');
  assert.equal(await server.exited, 0);
});

test('Host TCP helper exits on its own after the idle timeout', { skip: SKIP, timeout: 120000 }, async t => {
  const root = makeRoot(t);
  const token = crypto.randomBytes(24).toString('hex');
  const port = await freePorts(1);
  const server = startServer(t, { token, port, root, idleMs: 3000 });
  await server.banner;
  assert.equal(await server.exited, 0, server.state.stdout + server.state.stderr);
  assert.match(server.state.stdout, /Idle timeout reached/u);
});
