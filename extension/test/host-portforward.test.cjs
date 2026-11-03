'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { createPermissions } = require('../permissions.cjs');
const { createHostChannel } = require('../host-channel.cjs');
const bootstrap = require('../host-bootstrap.cjs');

const TOKEN_PATTERN = /\[string\]\$Token = '([A-Za-z0-9_-]+)'/u;
const BOOT_NONCE = /'LSWB_BOOT_FAILED:'\+'([a-f0-9]{32})'/u;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fake Host helper speaking the host-server.ps1 line protocol.
function fakeHost(t, getToken) {
  const requests = [];
  const server = net.createServer(socket => {
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
      if (request.token !== getToken()) {
        socket.end(JSON.stringify({ ok: false, error: { code: 'host_token_rejected', message: 'no' } }) + '\n');
        return;
      }
      let result = { complete: true, action: request.action };
      if (request.action === 'hello') {
        result = { protocol: 3, transport: 'tcp', chunkBytes: 32768 };
      }
      socket.end(JSON.stringify({ nonce: request.nonce, ok: true, result }) + '\n');
    });
  });
  t.after(() => new Promise(resolve => server.close(() => resolve())));
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, requests }));
  });
}

async function closedPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function fixture(t, options = {}) {
  const settings = { 'terminal.enabled': true, 'host.transport': 'portForward', ...options.settings };
  const listeners = new Set();
  const events = [];
  const sent = [];
  const messages = [];
  const logs = [];
  const scripts = [];
  const emit = text => {
    for (const callback of listeners) {
      callback(text);
    }
  };
  const tokenOf = () => TOKEN_PATTERN.exec(scripts.at(-1) || '')?.[1];
  const respondToLaunch = nonce => {
    if (options.mode === 'bootFail') {
      const encoded = Buffer.from(JSON.stringify({ message: 'host_port_unavailable: No free loopback port.' })).toString('base64');
      emit(`\r\nLSWB_BOOT_FAILED:${nonce}:${encoded}\r\nLSWB_END:${nonce}\r\n`);
      return;
    }
    const banner = JSON.stringify({ port: options.bannerPort(), protocol: 3, token: tokenOf().slice(0, 8) });
    events.push('banner');
    emit('\x1b]0;pwsh\x07LSWB_LISTEN\r\nING:' + banner + '\r\nLive Share Workspace Bridge host helper listening.\r\n');
  };
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
        setTimeout(() => respondToLaunch(match[1]), 1);
      }
    },
  };
  const vscode = {
    window: {
      terminals: [terminal],
      showInformationMessage(message, ...items) {
        messages.push({ message, items });
        return options.choice ? Promise.resolve(options.choice) : new Promise(() => {});
      },
      showWarningMessage(message) {
        messages.push({ message, warning: true });
      },
      createOutputChannel: () => ({ appendLine: line => logs.push(line), dispose() {} }),
    },
    workspace: {
      getConfiguration: () => ({ get: key => settings[key] }),
      fs: {
        async writeFile(uri, bytes) {
          scripts.push(Buffer.from(bytes).toString('utf8'));
          events.push('write');
        },
        async delete(uri, flags) {
          events.push('delete:' + uri.toString() + ':' + JSON.stringify(flags));
        },
      },
    },
    Uri: { joinPath: (root, name) => ({ toString: () => 'vsls:/' + name }) },
  };
  const permissions = createPermissions(vscode);
  const host = createHostChannel(vscode, { epoch: () => 1 }, permissions);
  t.after(() => host.dispose());
  const root = { toString: () => 'vsls:/' };
  return { settings, host, root, terminal, sent, messages, logs, events, scripts, tokenOf };
}

test('portForward binds through a forwarded port and serves requests over TCP', async t => {
  let fake;
  const f = fixture(t, { bannerPort: () => fake.port });
  fake = await fakeHost(t, () => f.tokenOf());
  const bound = await f.host.bind(f.root);
  assert.equal(bound.bound, true);
  assert.equal(bound.transport, 'portForward');
  assert.equal(bound.port, fake.port);

  // Token only in the rendered file, never on the terminal line; the file is
  // removed with non-recursive flags once the banner arrived.
  const token = f.tokenOf();
  assert.ok(token.length >= 32);
  assert.equal(f.sent.length, 1);
  assert.ok(!f.sent[0].includes(token));
  assert.ok(!f.sent[0].includes(token.slice(0, 8)));
  const deletion = f.events.findIndex(x => x.startsWith('delete:'));
  assert.ok(deletion > f.events.indexOf('banner'));
  assert.match(f.events[deletion], /^delete:vsls:\/\.lswb-bootstrap-[0-9a-f-]+\.txt:\{"recursive":false,"useTrash":false\}$/u);

  const prompt = f.messages.find(x => x.items?.includes('Cancel'));
  assert.ok(prompt.message.includes('"Live Share: Share Server"'));
  assert.ok(prompt.message.includes(`enter port ${fake.port}`));
  assert.ok(f.logs.some(line => line.includes(`port ${fake.port}`)));

  const status = f.host.status(f.root);
  assert.equal(status.transport, 'portForward');
  assert.equal(status.bound, true);
  assert.equal(status.port, fake.port);
  assert.equal(status.handshake.state, 'bound');
  assert.equal(status.uncertain, false);

  const reply = await f.host.request(f.root, 'hostStat', { action: 'stat', path: 'a.txt' });
  assert.deepEqual(reply, { complete: true, action: 'stat' });
  assert.equal(f.sent.length, 1);
  const stat = fake.requests.at(-1);
  assert.equal(stat.token, token);
  assert.equal(stat.path, 'a.txt');
});

test('closing the terminal keeps a portForward binding; dispose sends shutdown', async t => {
  let fake;
  const f = fixture(t, { bannerPort: () => fake.port });
  fake = await fakeHost(t, () => f.tokenOf());
  await f.host.bind(f.root);
  f.host.terminalClosed(f.terminal);
  assert.equal(f.host.status(f.root).bound, true);
  await f.host.request(f.root, 'hostStat', { action: 'stat', path: 'b.txt' });
  assert.equal(f.sent.length, 1);
  f.host.dispose();
  await delay(100);
  assert.equal(fake.requests.at(-1).action, 'shutdown');
});

test('Cancel stops the handshake without marking the channel uncertain', async t => {
  const port = await closedPort();
  const f = fixture(t, { bannerPort: () => port, choice: 'Cancel' });
  await assert.rejects(f.host.bind(f.root), { code: 'host_bind_cancelled' });
  const status = f.host.status(f.root);
  assert.equal(status.uncertain, false);
  assert.equal(status.bound, false);
  assert.equal(status.handshake.state, 'cancelled');
  assert.ok(f.events.some(x => x.startsWith('delete:')));
});

test('a reported boot failure fails fast, deletes the bootstrap and is not uncertain', async t => {
  const f = fixture(t, { mode: 'bootFail' });
  await assert.rejects(f.host.bind(f.root), { code: 'host_port_unavailable' });
  assert.equal(f.host.status(f.root).uncertain, false);
  assert.ok(f.events.some(x => x.startsWith('delete:')));
});

test('switching back to sharedTerminal shuts the helper down before using the terminal', async t => {
  let fake;
  const f = fixture(t, { bannerPort: () => fake.port });
  fake = await fakeHost(t, () => f.tokenOf());
  await f.host.bind(f.root);
  f.settings['host.transport'] = 'sharedTerminal';
  const pending = f.host.request(f.root, 'hostStat', { action: 'stat', path: 'c.txt' });
  await delay(100);
  assert.equal(fake.requests.at(-1).action, 'shutdown');
  assert.equal(f.sent.length, 2);
  assert.ok(f.sent[1].includes('-FunctionName'));
  f.host.dispose();
  await assert.rejects(pending);
});

test('an unknown transport value is a configuration error', async t => {
  const f = fixture(t, { settings: { 'host.transport': 'carrierPigeon' } });
  await assert.rejects(f.host.bind(f.root), { code: 'invalid_configuration' });
  assert.equal(f.host.status(f.root).transport, null);
  assert.equal(f.sent.length, 0);
});

function silentTerminal() {
  const listeners = new Set();
  const pty = {
    handleInput() {},
    onDidWrite(callback) {
      listeners.add(callback);
      return { dispose: () => listeners.delete(callback) };
    },
  };
  return { terminal: { name: 'x [Shared]', creationOptions: { pty }, sendText() {} }, listeners };
}

function listenOptions(terminal, state, timeoutMs) {
  return {
    terminal,
    permissions: { assert() {} },
    state,
    op: 'hostBind',
    nonce: 'e'.repeat(32),
    tokenPrefix: 'abcdefgh',
    command: 'launch',
    timeoutMs,
  };
}

test('a missing banner times out and marks the channel uncertain', async () => {
  const { terminal, listeners } = silentTerminal();
  const state = { pending: null, uncertain: false };
  await assert.rejects(bootstrap.awaitListening(listenOptions(terminal, state, 30)), { code: 'host_terminal_required' });
  assert.equal(state.uncertain, true);
  assert.equal(state.pending, null);
  assert.equal(listeners.size, 0);
});

test('a terminal closed during the banner wait is not uncertain', async () => {
  const { terminal } = silentTerminal();
  const state = { pending: null, uncertain: false };
  const waiting = bootstrap.awaitListening(listenOptions(terminal, state, 5000));
  assert.equal(state.pending.kind, 'banner');
  state.pending.reject({ code: 'host_channel_closed', message: 'closed' }, false);
  await assert.rejects(waiting, { code: 'host_channel_closed' });
  assert.equal(state.uncertain, false);
});
