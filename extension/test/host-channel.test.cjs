'use strict';
// Host channel: terminal selection for the one-time helper launch, access
// gating, uncertainty without replay, and the legacy settings that 0.3.0
// still reads. Requests themselves travel over the forwarded TCP port.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  delay,
  waitFor,
  handshakeOf,
  fakeHost,
  fixture,
  bindAndConnect,
} = require('./host-fixtures.cjs');

async function connectedFixture(t, options = {}) {
  let fake;
  const f = fixture(t, { ...options, bannerPort: () => fake.port });
  fake = await fakeHost(t, () => f.tokenOf());
  return { f, fake };
}

test('never selects an ordinary Guest terminal or writes a handshake when Host access is disabled/missing', async t => {
  const f = fixture(t, { settings: { 'host.enabled': false }, bannerPort: () => 1 });
  await assert.rejects(f.host.bind(f.root), { code: 'host_access_disabled' });
  assert.equal(f.scripts.length, 0);

  f.settings['host.enabled'] = true;
  f.vscode.window.terminals = [{ name: 'pwsh', shellIntegration: {}, creationOptions: { shellPath: 'pwsh.exe' } }];
  await assert.rejects(f.host.bind(f.root), { code: 'host_terminal_required' });
  assert.equal(f.scripts.length, 0);
  assert.equal(f.sent.length, 0);
});

test('known read-only shared terminals are rejected without a handshake or command', async t => {
  const f = fixture(t, { bannerPort: () => 1 });
  f.terminal.creationOptions.pty.isReadonly = true;
  await assert.rejects(f.host.bind(f.root), { code: 'host_terminal_required' });
  assert.equal(f.sent.length, 0);
  assert.equal(f.scripts.length, 0);
});

test('host.terminalName selects exactly one shared terminal by name', async t => {
  const f = fixture(t, { settings: { 'host.terminalName': 'other [Shared]' }, bannerPort: () => 1 });
  await assert.rejects(f.host.bind(f.root), { code: 'host_terminal_required' });
  f.settings['host.terminalName'] = 'powershell [Shared]';
  assert.deepEqual(f.host.status(f.root).candidates, ['powershell [Shared]']);
});

test('binding sends one launch line and releases the terminal output listener', async t => {
  const { f } = await connectedFixture(t);
  await bindAndConnect(f);
  assert.equal(f.sent.length, 1);
  assert.equal(f.listeners.size, 0);
  await f.host.request(f.root, 'search', { action: 'search', query: 'x' });
  assert.equal(f.sent.length, 1);
});

test('an unknown mutation outcome makes the channel uncertain and nothing is replayed', async t => {
  const { f, fake } = await connectedFixture(t);
  await bindAndConnect(f);
  fake.silentActions.add('writeBytes');
  const action = { action: 'writeBytes', path: 'a.bin', base64: '', size: 0 };
  await assert.rejects(f.host.request(f.root, 'writeBytes', action, { timeoutMs: 100 }), error => {
    assert.equal(error.code, 'host_outcome_unknown');
    assert.equal(error.details.mutationMayHaveOccurred, true);
    return true;
  });
  const writes = () => fake.requests.filter(x => x.action === 'writeBytes').length;
  assert.equal(writes(), 1);
  assert.equal(f.host.status(f.root).uncertain, true);

  await assert.rejects(f.host.request(f.root, 'search', { action: 'search', query: 'x' }), { code: 'host_channel_uncertain' });
  // Invalidating the binding is not an acknowledgement of recovery.
  f.identity.epochValue = 2;
  f.host.changed(true);
  await assert.rejects(f.host.request(f.root, 'search', { action: 'search', query: 'x' }), { code: 'host_channel_uncertain' });
  assert.equal(writes(), 1);
  assert.equal(f.sent.length, 1);
});

test('revoking Host access during the banner wait detaches the listener', async t => {
  const f = fixture(t, { mode: 'silent', bannerPort: () => 1 });
  const binding = f.host.bind(f.root);
  await waitFor(() => f.sent.length === 1);
  f.settings['host.enabled'] = false;
  f.host.changed(false);
  await assert.rejects(binding, { code: 'host_access_revoked' });
  assert.equal(f.listeners.size, 0);
});

test('only the legacy terminal.enabled=true still binds and serves Host requests, with one notice', async t => {
  const { f } = await connectedFixture(t, { settings: { 'host.enabled': undefined, 'terminal.enabled': true } });
  delete f.settings['host.enabled'];
  await bindAndConnect(f);
  const reply = await f.host.request(f.root, 'search', { action: 'search', query: 'x' });
  assert.equal(reply.action, 'search');
  f.host.status(f.root);
  const notices = f.logs.filter(line => line.includes('liveshareWorkspaceBridge.terminal.enabled is deprecated'));
  assert.equal(notices.length, 1);
  assert.match(notices[0], /host\.enabled/u);
  assert.deepEqual(f.updates, []);
});

test('legacy terminal.* limits and workspace path apply while the new keys are unset', async t => {
  const legacy = {
    'terminal.hostWorkspacePath': 'C:\\Projects\\Shared',
    'terminal.commandTimeoutMs': 5000,
    'terminal.maxOutputCharacters': 2048,
  };
  const { f } = await connectedFixture(t, { settings: legacy });
  await bindAndConnect(f);
  assert.match(f.sent[0], /C:\\Projects\\Shared/u);
  assert.match(f.scripts[0], /\[int\]\$DefaultTimeout = 5000/u);
  assert.match(f.scripts[0], /\[int\]\$OutputLimit = 2048/u);
});

test('a stored host.transport sharedTerminal runs as portForward with one log line and no prompt', async t => {
  const { f } = await connectedFixture(t, { settings: { 'host.transport': 'sharedTerminal' } });
  await bindAndConnect(f);
  await f.host.bind(f.root);
  const notices = f.logs.filter(line => line.includes('host.transport'));
  assert.equal(notices.length, 1);
  assert.match(notices[0], /sharedTerminal.*portForward/u);
  assert.ok(f.messages.every(x => !x.message.includes('host.transport')));
  assert.deepEqual(f.updates, []);
});

test('any other stored host.transport value is ignored without a notice', async t => {
  const { f } = await connectedFixture(t, { settings: { 'host.transport': 'carrierPigeon' } });
  await bindAndConnect(f);
  assert.equal(f.logs.filter(line => line.includes('host.transport')).length, 0);
  assert.equal(handshakeOf(f).state, 'bound');
  await delay(1);
});
