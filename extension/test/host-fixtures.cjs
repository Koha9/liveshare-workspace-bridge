'use strict';
// Shared fakes for Host channel tests: a VS Code-like configuration, a shared
// Host terminal that answers the helper launch with a banner, and a fake Host
// helper speaking the host-server.ps1 line protocol.
const net = require('node:net');
const { createPermissions, configurationProperties, NAMESPACE } = require('../permissions.cjs');
const { createHostChannel } = require('../host-channel.cjs');

const TOKEN_PATTERN = /\[string\]\$Token = '([A-Za-z0-9_-]+)'/u;
const BOOT_NONCE = /'LSWB_BOOT_FAILED:'\+'([a-f0-9]{32})'/u;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Condition not reached in time.');
    }
    await delay(10);
  }
}

function handshakeOf(f) {
  return f.host.status(f.root).handshake;
}

function manifestDefaults() {
  const defaults = {};
  for (const [key, property] of Object.entries(configurationProperties())) {
    defaults[key.slice(NAMESPACE.length + 1)] = property.default;
  }
  return defaults;
}

// Like VS Code: get() falls back to the manifest default, inspect() reports
// only what the user set, and update() is recorded so tests can prove that
// nothing is written.
function fakeConfiguration(settings, updates) {
  const defaults = manifestDefaults();
  return {
    get: key => (Object.hasOwn(settings, key) ? settings[key] : defaults[key]),
    inspect: key => ({ key, defaultValue: defaults[key], globalValue: settings[key] }),
    update: async (key, value) => {
      updates.push({ key, value });
    },
  };
}

function replyLine(request, getToken) {
  if (request.token !== getToken()) {
    return { ok: false, error: { code: 'host_token_rejected', message: 'no' } };
  }
  let result = { complete: true, action: request.action };
  if (request.action === 'hello') {
    result = { protocol: 3, transport: 'tcp', chunkBytes: 32768 };
  }
  return { nonce: request.nonce, ok: true, result };
}

// While fake.accepting is false a connection closes without a reply, like
// Live Share's local end before the Host has shared the port. Actions listed
// in fake.silentActions are read but never answered.
function fakeHost(t, getToken, accepting = true) {
  const requests = [];
  const fake = { port: null, requests, accepting, silentActions: new Set() };
  const sockets = new Set();
  const server = net.createServer(socket => {
    if (!fake.accepting) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('error', () => {});
    socket.on('data', chunk => {
      buffer += chunk;
      if (!buffer.includes('\n')) {
        return;
      }
      const request = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
      requests.push(request);
      if (fake.silentActions.has(request.action)) {
        return;
      }
      socket.end(JSON.stringify(replyLine(request, getToken)) + '\n');
    });
  });
  t.after(() => new Promise(resolve => {
    for (const socket of sockets) {
      socket.destroy();
    }
    server.close(() => resolve());
  }));
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      fake.port = server.address().port;
      resolve(fake);
    });
  });
}

async function closedPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function sharedTerminal(onLaunch, sent) {
  const listeners = new Set();
  const pty = {
    handleInput() {},
    onDidWrite(callback) {
      listeners.add(callback);
      return { dispose: () => listeners.delete(callback) };
    },
  };
  const terminal = {
    name: 'powershell [Shared]',
    creationOptions: { pty },
    sendText(command) {
      sent.push(command);
      const match = BOOT_NONCE.exec(command);
      if (match) {
        setTimeout(() => onLaunch(match[1]), 1);
      }
    },
  };
  const emit = text => {
    for (const callback of listeners) {
      callback(text);
    }
  };
  return { terminal, listeners, emit };
}

function fakeWindow(terminal, options, record) {
  return {
    terminals: [terminal],
    showInformationMessage(message, ...items) {
      record.messages.push({ message, items });
      return options.choice ? Promise.resolve(options.choice) : new Promise(() => {});
    },
    showWarningMessage(message) {
      record.messages.push({ message, warning: true });
    },
    createOutputChannel: () => ({ appendLine: line => record.logs.push(line), dispose() {} }),
  };
}

function fixture(t, options = {}) {
  const settings = { 'host.enabled': true, ...options.settings };
  const record = { events: [], sent: [], messages: [], logs: [], scripts: [], updates: [] };
  const tokenOf = () => TOKEN_PATTERN.exec(record.scripts.at(-1) || '')?.[1];
  let shared;
  const respondToLaunch = nonce => {
    if (options.mode === 'bootFail') {
      const encoded = Buffer.from(JSON.stringify({ message: 'host_port_unavailable: No free loopback port.' })).toString('base64');
      shared.emit(`\r\nLSWB_BOOT_FAILED:${nonce}:${encoded}\r\nLSWB_END:${nonce}\r\n`);
      return;
    }
    if (options.mode === 'silent') {
      return;
    }
    const banner = JSON.stringify({ port: options.bannerPort(), protocol: 3, token: tokenOf().slice(0, 8) });
    record.events.push('banner');
    shared.emit('\x1b]0;pwsh\x07LSWB_LISTEN\r\nING:' + banner + '\r\nLive Share Workspace Bridge host helper listening.\r\n');
  };
  shared = sharedTerminal(respondToLaunch, record.sent);
  const vscode = {
    window: fakeWindow(shared.terminal, options, record),
    workspace: {
      getConfiguration: () => fakeConfiguration(settings, record.updates),
      fs: {
        async writeFile(uri, bytes) {
          record.scripts.push(Buffer.from(bytes).toString('utf8'));
          record.events.push('write');
        },
        async delete(uri, flags) {
          record.events.push('delete:' + uri.toString() + ':' + JSON.stringify(flags));
        },
      },
    },
    Uri: { joinPath: (root, name) => ({ toString: () => 'vsls:/' + name }) },
  };
  const permissions = createPermissions(vscode);
  const identity = { epochValue: 1, epoch: () => identity.epochValue };
  const internal = { handshakeIntervalMs: 20, ...options.internal };
  const host = createHostChannel(vscode, identity, permissions, internal);
  t.after(() => host.dispose());
  const root = { toString: () => 'vsls:/' };
  return {
    ...record,
    settings,
    vscode,
    host,
    root,
    terminal: shared.terminal,
    listeners: shared.listeners,
    tokenOf,
    identity,
  };
}

async function bindAndConnect(f) {
  const result = await f.host.bind(f.root);
  await waitFor(() => handshakeOf(f).state === 'bound');
  return result;
}

module.exports = {
  delay,
  waitFor,
  handshakeOf,
  fakeHost,
  closedPort,
  fixture,
  bindAndConnect,
};
