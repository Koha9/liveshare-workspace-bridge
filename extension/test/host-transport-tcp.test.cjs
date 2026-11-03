'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const tcp = require('../host-transport-tcp.cjs');

const TOKEN = 'f'.repeat(64);

// A fake Host: `respond(request, socket)` decides what happens per connection.
function fakeHost(t, respond) {
  const requests = [];
  const server = net.createServer(socket => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('error', () => {});
    socket.on('data', chunk => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) {
        return;
      }
      const request = JSON.parse(buffer.slice(0, newline));
      requests.push(request);
      respond(request, socket);
    });
  });
  t.after(() => new Promise(resolve => server.close(() => resolve())));
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, requests }));
  });
}

function reply(socket, body) {
  socket.end(JSON.stringify(body) + '\n');
}

async function closedPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('a request and its reply round-trip with token and nonce appended', async t => {
  const host = await fakeHost(t, (request, socket) => reply(socket, { nonce: request.nonce, ok: true, result: { echo: request.path } }));
  const state = { uncertain: false };
  const response = await tcp.sendTcpRequest({ port: host.port, token: TOKEN, action: { action: 'stat', path: 'a.txt' }, state });
  assert.deepEqual(response.result, { echo: 'a.txt' });
  assert.equal(host.requests[0].token, TOKEN);
  assert.match(host.requests[0].nonce, /^[a-f0-9]{32}$/u);
  assert.equal(state.uncertain, false);
});

test('actions carrying token or nonce keys are refused before connecting', async t => {
  const host = await fakeHost(t, () => assert.fail('nothing may be sent'));
  const state = { uncertain: false };
  for (const action of [{ action: 'writeBytes', token: 'x' }, { action: 'writeBytes', nonce: 'x' }]) {
    assert.throws(() => tcp.sendTcpRequest({ port: host.port, token: TOKEN, action, state }), { code: 'invalid_argument' });
  }
  assert.equal(host.requests.length, 0);
  assert.equal(state.uncertain, false);
});

test('a request over 2 MiB is refused without sending', async t => {
  const host = await fakeHost(t, () => assert.fail('nothing may be sent'));
  const action = { action: 'writeBytes', base64: 'a'.repeat(tcp.REQUEST_LIMIT_BYTES) };
  assert.throws(() => tcp.sendTcpRequest({ port: host.port, token: TOKEN, action }), { code: 'host_request_too_large' });
  assert.equal(host.requests.length, 0);
});

test('a mismatched nonce is an invalid response and marks only mutations uncertain', async t => {
  const host = await fakeHost(t, (request, socket) => reply(socket, { nonce: 'other', ok: true, result: {} }));
  const readState = { uncertain: false };
  await assert.rejects(tcp.sendTcpRequest({ port: host.port, token: TOKEN, action: { action: 'stat' }, state: readState }), { code: 'invalid_host_response' });
  assert.equal(readState.uncertain, false);
  const writeState = { uncertain: false };
  await assert.rejects(tcp.sendTcpRequest({ port: host.port, token: TOKEN, action: { action: 'writeBytes' }, state: writeState }), error => {
    assert.equal(error.code, 'invalid_host_response');
    assert.equal(error.details.requestSent, true);
    assert.equal(error.details.mutationMayHaveOccurred, true);
    return true;
  });
  assert.equal(writeState.uncertain, true);
});

test('a reply without a nonce passes the helper refusal through', async t => {
  const host = await fakeHost(t, (request, socket) => reply(socket, { ok: false, error: { code: 'host_token_rejected', message: 'no' } }));
  const response = await tcp.sendTcpRequest({ port: host.port, token: TOKEN, action: { action: 'hello' } });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'host_token_rejected');
});

test('a response over 4 MiB is an invalid response', async t => {
  const host = await fakeHost(t, (request, socket) => {
    socket.end('{"pad":"' + 'x'.repeat(tcp.RESPONSE_LIMIT_BYTES) + '"}\n');
  });
  const state = { uncertain: false };
  await assert.rejects(tcp.sendTcpRequest({ port: host.port, token: TOKEN, action: { action: 'commitWrite' }, state }), { code: 'invalid_host_response' });
  assert.equal(state.uncertain, true);
});

test('a disconnect after writing is an unknown outcome; uncertain only for mutations', async t => {
  const host = await fakeHost(t, (request, socket) => socket.destroy());
  for (const [action, expected] of [['stat', false], ['search', false], ['applyPatch', true], ['startJob', true], ['copyFile', true]]) {
    const state = { uncertain: false };
    await assert.rejects(tcp.sendTcpRequest({ port: host.port, token: TOKEN, action: { action }, state }), error => {
      assert.equal(error.code, 'host_outcome_unknown');
      assert.equal(error.details.requestSent, true);
      return true;
    });
    assert.equal(state.uncertain, expected, action);
  }
});

test('a refused connection is unavailable and never uncertain', async () => {
  const port = await closedPort();
  const state = { uncertain: false };
  await assert.rejects(tcp.sendTcpRequest({ port, token: TOKEN, action: { action: 'writeBytes' }, state }), error => {
    assert.equal(error.code, 'host_transport_unavailable');
    assert.equal(error.details.requestSent, false);
    assert.equal(error.details.mutationMayHaveOccurred, false);
    assert.equal(error.details.errno, 'ECONNREFUSED');
    return true;
  });
  assert.equal(state.uncertain, false);
});

test('a silent Host times out as an unknown outcome', async t => {
  const host = await fakeHost(t, () => {});
  const state = { uncertain: false };
  await assert.rejects(tcp.sendTcpRequest({ port: host.port, token: TOKEN, action: { action: 'writeBytes' }, state, timeoutMs: 100 }), { code: 'host_outcome_unknown' });
  assert.equal(state.uncertain, true);
});

const NETSH_SAMPLE = [
  '',
  'Protocol tcp Port Exclusion Ranges',
  '',
  'Start Port    End Port',
  '----------    --------',
  '      2942        3041',
  '     20000       20009',
  '     20015       20015     *',
  '',
  '* - Administered port exclusions.',
  '',
].join('\r\n');

test('netsh exclusion output is parsed into ranges', () => {
  assert.deepEqual(tcp.parseExcludedPortRanges(NETSH_SAMPLE), [[2942, 3041], [20000, 20009], [20015, 20015]]);
  assert.deepEqual(tcp.parseExcludedPortRanges(''), []);
});

test('chooseGuestPort skips excluded ranges and busy ports', async () => {
  const probed = [];
  const busy = new Set([20010, 20011, 20012]);
  const port = await tcp.chooseGuestPort({
    excludedRanges: tcp.parseExcludedPortRanges(NETSH_SAMPLE),
    random: () => 0,
    isFree: async candidate => {
      probed.push(candidate);
      return !busy.has(candidate) && candidate !== 20013;
    },
  });
  assert.equal(port, 20014);
  assert.deepEqual(probed, [20010, 20011, 20012, 20013, 20014]);
});

test('chooseGuestPort gives up after 50 probes', async () => {
  let probes = 0;
  const choice = tcp.chooseGuestPort({ random: () => 100, isFree: async () => { probes++; return false; } });
  await assert.rejects(choice, { code: 'host_port_unavailable' });
  assert.equal(probes, 50);
});

function helloReply(result) {
  return { ok: true, result: { protocol: 3, transport: 'tcp', chunkBytes: 32768, ...result } };
}

test('the handshake keeps polling while the port is not shared, then succeeds', async () => {
  const notices = [];
  let calls = 0;
  const attempt = async port => {
    calls++;
    if (calls < 3) {
      throw Object.assign(new Error('refused'), { code: 'host_transport_unavailable' });
    }
    return helloReply({ port });
  };
  const result = await tcp.awaitForwardedPort({ attempt, targetPort: () => 41000, notify: x => notices.push(x), intervalMs: 5, timeoutMs: 5000 });
  assert.equal(result.port, 41000);
  assert.equal(calls, 3);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].message, 'Host has not shared port 41000 yet.');
});

test('a foreign service on the port is reported and a guestPort change is picked up', async () => {
  const notices = [];
  let target = 41000;
  const attempt = async port => {
    if (port === 41000) {
      target = 42000;
      return { ok: false, error: { code: 'host_token_rejected', message: 'no' } };
    }
    return helloReply({});
  };
  const result = await tcp.awaitForwardedPort({ attempt, targetPort: () => target, notify: x => notices.push(x), intervalMs: 5, timeoutMs: 5000 });
  assert.equal(result.port, 42000);
  assert.equal(notices[0].reason, 'foreign_port');
  assert.match(notices[0].message, /liveshareWorkspaceBridge\.host\.guestPort/u);
  assert.match(notices[0].message, /Port 41000 on this machine/u);
});

test('a wrong protocol stops the handshake; a timeout needs the user', async () => {
  const wrong = async () => helloReply({ protocol: 2 });
  await assert.rejects(tcp.awaitForwardedPort({ attempt: wrong, targetPort: () => 1, intervalMs: 5, timeoutMs: 1000 }), { code: 'host_protocol_mismatch' });
  const refused = async () => {
    throw Object.assign(new Error('refused'), { code: 'host_transport_unavailable' });
  };
  await assert.rejects(tcp.awaitForwardedPort({ attempt: refused, targetPort: () => 1, intervalMs: 5, timeoutMs: 30 }), error => {
    assert.equal(error.code, 'host_port_forward_required');
    assert.equal(error.details.needsUser, true);
    return true;
  });
});

test('aborting the handshake stops polling with the abort reason', async () => {
  const controller = new AbortController();
  let calls = 0;
  const attempt = async () => {
    calls++;
    throw Object.assign(new Error('refused'), { code: 'host_transport_unavailable' });
  };
  const waiting = tcp.awaitForwardedPort({ attempt, targetPort: () => 1, intervalMs: 20, timeoutMs: 60000, signal: controller.signal });
  setTimeout(() => controller.abort(Object.assign(new Error('cancelled'), { code: 'host_bind_cancelled' })), 30);
  await assert.rejects(waiting, { code: 'host_bind_cancelled' });
  const after = calls;
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(calls, after);
});
