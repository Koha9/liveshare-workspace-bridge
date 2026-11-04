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

// Fake Host helper speaking the host-server.ps1 line protocol. While
// fake.accepting is false a connection closes without a reply, like Live
// Share's local end before the Host has shared the port.
function fakeHost(t, getToken, accepting = true) {
  const requests = [];
  const fake = { port: null, requests, accepting };
  const server = net.createServer(socket => {
    if (!fake.accepting) {
      socket.destroy();
      return;
    }
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
  const identity = { epochValue: 1, epoch: () => identity.epochValue };
  const internal = { handshakeIntervalMs: 20, ...options.internal };
  const host = createHostChannel(vscode, identity, permissions, internal);
  t.after(() => host.dispose());
  const root = { toString: () => 'vsls:/' };
  return { settings, host, root, terminal, sent, messages, logs, events, scripts, tokenOf, identity };
}

async function bindAndConnect(f) {
  const result = await f.host.bind(f.root);
  await waitFor(() => handshakeOf(f).state === 'bound');
  return result;
}

test('portForward binds through a forwarded port and serves requests over TCP', async t => {
  let fake;
  const f = fixture(t, { bannerPort: () => fake.port });
  fake = await fakeHost(t, () => f.tokenOf());
  const started = await bindAndConnect(f);
  assert.equal(started.bound, false);
  assert.equal(started.transport, 'portForward');
  assert.equal(started.handshake.hostPort, fake.port);

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
  await bindAndConnect(f);
  f.host.terminalClosed(f.terminal);
  assert.equal(f.host.status(f.root).bound, true);
  await f.host.request(f.root, 'hostStat', { action: 'stat', path: 'b.txt' });
  assert.equal(f.sent.length, 1);
  f.host.dispose();
  await delay(100);
  assert.equal(fake.requests.at(-1).action, 'shutdown');
});

test('hostBind returns waitingForward after the banner while the handshake continues', async t => {
  let fake;
  const f = fixture(t, { bannerPort: () => fake.port });
  fake = await fakeHost(t, () => f.tokenOf(), false);
  const started = await f.host.bind(f.root);
  assert.equal(started.bound, false);
  assert.equal(started.transport, 'portForward');
  assert.equal(started.workspace, 'vsls:/');
  assert.equal(started.handshake.state, 'waitingForward');
  assert.equal(started.handshake.hostPort, fake.port);
  assert.equal(started.handshake.guestPort, fake.port);
  assert.match(started.next, new RegExp(`Live Share: Share Server.*port ${fake.port}`, 'u'));
  assert.match(started.next, /lswb_host_status/u);
  assert.ok(f.events.some(x => x.startsWith('delete:')));
  assert.ok(f.messages.some(x => x.items?.includes('Cancel')));

  // Status stays readable while the handshake is still polling.
  await delay(60);
  const waiting = f.host.status(f.root);
  assert.equal(waiting.bound, false);
  assert.equal(waiting.uncertain, false);
  assert.equal(waiting.handshake.state, 'waitingForward');
  assert.equal(waiting.handshake.hostPort, fake.port);

  // A repeated bind reports the same handshake without guiding again.
  const again = await f.host.bind(f.root);
  assert.equal(again.bound, false);
  assert.equal(again.handshake.state, 'waitingForward');
  assert.equal(f.scripts.length, 1);
  assert.equal(f.sent.length, 1);

  // Other Host requests fail fast and send nothing.
  const searches = () => fake.requests.filter(x => x.action === 'search').length;
  await assert.rejects(f.host.request(f.root, 'search', { action: 'search', query: 'x' }), error => {
    assert.equal(error.code, 'host_handshake_pending');
    assert.equal(error.details.hostPort, fake.port);
    assert.equal(error.details.requestSent, false);
    assert.match(error.message, /lswb_host_status/u);
    return true;
  });
  assert.equal(searches(), 0);
  assert.equal(f.host.status(f.root).uncertain, false);

  fake.accepting = true;
  await waitFor(() => handshakeOf(f).state === 'bound');
  const bound = f.host.status(f.root);
  assert.equal(bound.bound, true);
  assert.equal(bound.port, fake.port);
  assert.ok(f.messages.some(x => x.message.includes(`connected on port ${fake.port}`)));
  const reply = await f.host.request(f.root, 'search', { action: 'search', query: 'x' });
  assert.equal(reply.action, 'search');
  assert.equal(f.sent.length, 1);
});

test('an unbound Host request starts the helper once and returns host_handshake_pending', async t => {
  let fake;
  const f = fixture(t, { bannerPort: () => fake.port });
  fake = await fakeHost(t, () => f.tokenOf(), false);
  const search = () => f.host.request(f.root, 'search', { action: 'search', query: 'y' });
  await assert.rejects(search(), { code: 'host_handshake_pending' });
  assert.equal(handshakeOf(f).state, 'waitingForward');
  await assert.rejects(search(), { code: 'host_handshake_pending' });
  assert.equal(f.sent.length, 1);
  assert.equal(f.host.status(f.root).uncertain, false);
});

test('Cancel stops the handshake without marking the channel uncertain; the next bind guides again', async t => {
  const port = await closedPort();
  const f = fixture(t, { bannerPort: () => port, choice: 'Cancel' });
  const started = await f.host.bind(f.root);
  assert.equal(started.bound, false);
  await waitFor(() => handshakeOf(f).state === 'cancelled');
  const status = f.host.status(f.root);
  assert.equal(status.uncertain, false);
  assert.equal(status.bound, false);
  assert.equal(status.handshake.code, 'host_bind_cancelled');
  assert.match(status.handshake.message, /Ctrl\+C/u);
  assert.ok(f.events.some(x => x.startsWith('delete:')));

  await f.host.bind(f.root);
  assert.equal(f.scripts.length, 2);
  assert.equal(f.sent.length, 2);
});

test('a handshake timeout leaves a failed status and a later bind guides again', async t => {
  const port = await closedPort();
  const f = fixture(t, { bannerPort: () => port, internal: { handshakeTimeoutMs: 80 } });
  await f.host.bind(f.root);
  await waitFor(() => handshakeOf(f).state === 'failed');
  const handshake = handshakeOf(f);
  assert.equal(handshake.code, 'host_port_forward_required');
  assert.match(handshake.message, /Ctrl\+C/u);
  assert.equal(f.host.status(f.root).uncertain, false);
  await f.host.bind(f.root);
  assert.equal(f.sent.length, 2);
});

test('dispose aborts a background handshake and never installs a binding', async t => {
  let fake;
  const f = fixture(t, { bannerPort: () => fake.port });
  fake = await fakeHost(t, () => f.tokenOf(), false);
  await f.host.bind(f.root);
  f.host.dispose();
  await waitFor(() => handshakeOf(f).state === 'failed');
  assert.equal(handshakeOf(f).code, 'host_channel_closed');
  fake.accepting = true;
  await delay(80);
  assert.equal(f.host.status(f.root).bound, false);
  assert.equal(fake.requests.length, 0);
});

test('a workspace change aborts a background handshake', async t => {
  let fake;
  const f = fixture(t, { bannerPort: () => fake.port });
  fake = await fakeHost(t, () => f.tokenOf(), false);
  await f.host.bind(f.root);
  f.identity.epochValue = 2;
  f.host.changed(true);
  await waitFor(() => handshakeOf(f).state === 'failed');
  assert.equal(handshakeOf(f).code, 'workspace_changed');
  fake.accepting = true;
  await delay(80);
  assert.equal(f.host.status(f.root).bound, false);
});

test('switching to sharedTerminal during a handshake aborts it before using the terminal', async t => {
  let fake;
  const f = fixture(t, { bannerPort: () => fake.port });
  fake = await fakeHost(t, () => f.tokenOf(), false);
  await f.host.bind(f.root);
  f.settings['host.transport'] = 'sharedTerminal';
  const pending = f.host.request(f.root, 'hostStat', { action: 'stat', path: 'd.txt' });
  await waitFor(() => f.sent.length === 2);
  assert.equal(handshakeOf(f).state, 'failed');
  assert.equal(handshakeOf(f).code, 'host_transport_changed');
  assert.ok(f.sent[1].includes('-FunctionName'));
  f.host.dispose();
  await assert.rejects(pending);
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
  await bindAndConnect(f);
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
