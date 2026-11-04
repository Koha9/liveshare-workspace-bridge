'use strict';
// Starts real Host helper scripts in Windows PowerShell and talks to them
// over loopback TCP, for the Windows-only Host helper tests.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { removeTempDirectory, waitForExit } = require('./temp-cleanup.cjs');

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

const STOP_TIMEOUT_MS = 10000;
// Helper processes started by each test. t.after hooks run in registration
// order, so a directory created before its helper would otherwise be removed
// while PowerShell still holds a handle in it (EPERM on Windows).
const helpers = new WeakMap();

function helpersOf(t) {
  if (!helpers.has(t)) {
    helpers.set(t, new Set());
  }
  return helpers.get(t);
}

// A foreground Host helper never exits on its own, so it is killed first;
// removeTempDirectory then only confirms the exit before deleting.
function stopHelper(child) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
  }
  return waitForExit(child, STOP_TIMEOUT_MS);
}

function makeRoot(t, prefix = PREFIX) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    const children = [...helpersOf(t)];
    await Promise.all(children.map(stopHelper));
    await removeTempDirectory(directory, { prefix, children });
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
    '-Token', options.token,
    '-Port', String(options.port),
    '-WorkspaceRoot', options.root,
    '-IdleTimeoutMs', String(options.idleMs),
  ];
  return startScript(t, SCRIPT, args);
}

function startScript(t, script, scriptArgs) {
  const args = [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script,
    ...scriptArgs,
  ];
  const child = spawn(powershellPath(), args, { windowsHide: true, env: powershellEnv() });
  const state = { stdout: '', stderr: '' };
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  helpersOf(t).add(child);
  t.after(() => stopHelper(child));
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

module.exports = {
  SKIP,
  SCRIPT,
  powershellPath,
  powershellEnv,
  makeRoot,
  freePorts,
  listen,
  closeServer,
  startServer,
  startScript,
  send,
  request,
};
