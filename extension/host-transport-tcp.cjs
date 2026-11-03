'use strict';
// Port-forward transport: one request per loopback TCP connection, one UTF-8
// JSON line each way. A failure before the connection opens is a plain
// unavailability; after the request is written the outcome is unknown and
// mutating actions mark the channel uncertain. Nothing is ever resent.
const net = require('node:net');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { fail } = require('./core.cjs');
const { newNonce } = require('./host-bootstrap.cjs');

const MUTATION_ACTIONS = ['copyFile', 'copyDirectory', 'writeBytes', 'commitWrite', 'applyPatch', 'startJob'];
const REQUEST_LIMIT_BYTES = 2 * 1024 * 1024;
const RESPONSE_LIMIT_BYTES = 4 * 1024 * 1024;
const LOOPBACK = '127.0.0.1';
const PORT_MIN = 20000;
const PORT_MAX = 60000;

function transportError(code, message, details) {
  return Object.assign(new Error(message), { code, details });
}

function buildRequestLine(action, token, nonce) {
  if (!action || typeof action !== 'object') {
    fail('invalid_argument', 'A Host request must be an object.');
  }
  if (Object.hasOwn(action, 'token') || Object.hasOwn(action, 'nonce')) {
    fail('invalid_argument', 'Host request fields may not be named token or nonce.');
  }
  const line = JSON.stringify({ ...action, token, nonce }) + '\n';
  if (Buffer.byteLength(line, 'utf8') > REQUEST_LIMIT_BYTES) {
    fail('host_request_too_large', 'The Host request exceeds 2 MiB and was not sent.', { requestSent: false });
  }
  return line;
}

// Returns [error, reply]. A reply without a nonce is the helper refusing the
// frame itself (for example a rejected token); its error code is passed on.
function parseReply(text, nonce) {
  let reply;
  try {
    reply = JSON.parse(text);
  } catch {
    return [transportError('invalid_host_response', 'The Host response is not valid JSON.')];
  }
  if (!reply || typeof reply !== 'object' || typeof reply.ok !== 'boolean') {
    return [transportError('invalid_host_response', 'Invalid Host response.')];
  }
  if (reply.nonce === undefined && reply.ok === false) {
    return [null, reply];
  }
  if (reply.nonce !== nonce) {
    return [transportError('invalid_host_response', 'The Host response nonce does not match the request.')];
  }
  return [null, reply];
}

function sendTcpRequest(options) {
  const { port, token, action, state = null, host = LOOPBACK } = options;
  const timeoutMs = options.timeoutMs || 45000;
  const nonce = newNonce();
  const line = buildRequestLine(action, token, nonce);
  const mutation = MUTATION_ACTIONS.includes(action.action);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const chunks = [];
    let size = 0;
    let connected = false;
    let done = false;
    const settle = (error, reply) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (!error) {
        resolve(reply);
        return;
      }
      error.details = {
        ...error.details,
        action: action.action,
        requestSent: connected,
        mutationMayHaveOccurred: connected && mutation,
      };
      if (connected && mutation && state) {
        state.uncertain = true;
      }
      reject(error);
    };
    const unavailable = cause => transportError(
      'host_transport_unavailable',
      `The Host helper on 127.0.0.1:${port} could not be reached; the request was not sent.`,
      { errno: cause?.code || 'ETIMEDOUT' },
    );
    const unknown = reason => transportError(
      'host_outcome_unknown',
      `The Host helper did not answer (${reason}). Inspect the Host before retrying a mutation.`,
    );
    const timer = setTimeout(() => {
      settle(connected ? unknown('timed out') : unavailable(null));
    }, timeoutMs);
    function onData(chunk) {
      const newline = chunk.indexOf(10);
      const piece = newline < 0 ? chunk : chunk.subarray(0, newline);
      size += piece.length;
      if (size > RESPONSE_LIMIT_BYTES) {
        settle(transportError('invalid_host_response', 'The Host response exceeds 4 MiB.'));
        return;
      }
      chunks.push(piece);
      if (newline >= 0) {
        const [error, reply] = parseReply(Buffer.concat(chunks).toString('utf8'), nonce);
        settle(error, reply);
      }
    }
    socket.once('connect', () => {
      connected = true;
      socket.write(line);
    });
    socket.on('data', onData);
    socket.on('error', error => settle(connected ? unknown(error.code || 'socket error') : unavailable(error)));
    socket.on('close', () => settle(connected ? unknown('connection closed') : unavailable(null)));
  });
}

// netsh output lists "start end" pairs; administered ranges carry a trailing *.
function parseExcludedPortRanges(text) {
  const ranges = [];
  for (const line of String(text).split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\b/u.exec(line);
    if (!match) {
      continue;
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start <= end && end <= 65535) {
      ranges.push([start, end]);
    }
  }
  return ranges;
}

function queryExcludedPortRanges() {
  if (process.platform !== 'win32') {
    return Promise.resolve([]);
  }
  const netsh = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'netsh.exe');
  const args = ['interface', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp'];
  return new Promise(resolve => {
    try {
      execFile(netsh, args, { windowsHide: true, timeout: 5000 }, (error, stdout) => {
        resolve(error ? [] : parseExcludedPortRanges(stdout));
      });
    } catch {
      resolve([]);
    }
  });
}

// Excluded (for example Hyper-V) ports fail with EACCES; any bind error counts as busy.
function isPortFree(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, LOOPBACK, () => server.close(() => resolve(true)));
  });
}

function isExcluded(port, ranges) {
  return ranges.some(([start, end]) => port >= start && port <= end);
}

function randomOffset(span) {
  return Math.floor(Math.random() * span);
}

async function chooseGuestPort(options = {}) {
  const excludedRanges = options.excludedRanges || [];
  const isFree = options.isFree || isPortFree;
  const random = options.random || randomOffset;
  const attempts = options.attempts || 50;
  const span = PORT_MAX - PORT_MIN + 1;
  const start = random(span);
  let tried = 0;
  for (let step = 0; step < span && tried < attempts; step++) {
    const port = PORT_MIN + ((start + step) % span);
    if (isExcluded(port, excludedRanges)) {
      continue;
    }
    tried++;
    if (await isFree(port)) {
      return port;
    }
  }
  fail('host_port_unavailable', `No free local port in ${PORT_MIN}..${PORT_MAX} after ${tried} attempts.`);
}

function notSharedMessage(port) {
  return `Host has not shared port ${port} yet.`;
}

function foreignPortMessage(port) {
  return `Port ${port} on this machine is used by something else; if Live Share remapped the port, `
    + 'set liveshareWorkspaceBridge.host.guestPort to the port shown in the Live Share view.';
}

function classifyHello(reply, port) {
  if (!reply.ok) {
    if (reply.error?.code === 'host_token_rejected') {
      return { reason: 'foreign_port', message: foreignPortMessage(port) };
    }
    return { fatal: transportError(reply.error?.code || 'host_error', reply.error?.message || 'Host hello failed.') };
  }
  if (reply.result?.transport !== 'tcp') {
    return { reason: 'foreign_port', message: foreignPortMessage(port) };
  }
  if (reply.result.protocol !== 3) {
    return { fatal: transportError('host_protocol_mismatch', 'Unexpected Host helper protocol.') };
  }
  return { done: true, result: reply.result };
}

// A refused connection means nothing listens yet; a connection that closes
// without a reply is Live Share's local end waiting for the Host side.
function classifyFailure(error, port) {
  if (error.code === 'host_transport_unavailable' || error.code === 'host_outcome_unknown') {
    return { reason: 'not_shared', message: notSharedMessage(port) };
  }
  if (error.code === 'invalid_host_response') {
    return { reason: 'foreign_port', message: foreignPortMessage(port) };
  }
  return { fatal: error };
}

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function attemptOnce(attempt, port) {
  try {
    return classifyHello(await attempt(port), port);
  } catch (error) {
    return classifyFailure(error, port);
  }
}

// Polls hello until it succeeds, the signal aborts or the deadline passes.
// targetPort() is read every round so a guestPort change applies immediately.
// None of these failures mark the channel uncertain: hello changes nothing.
async function awaitForwardedPort(options) {
  const { attempt, targetPort, signal } = options;
  const notify = options.notify || (() => {});
  const intervalMs = options.intervalMs ?? 2000;
  const deadline = Date.now() + options.timeoutMs;
  let previous = null;
  while (true) {
    if (signal?.aborted) {
      throw signal.reason;
    }
    const port = targetPort();
    const outcome = await attemptOnce(attempt, port);
    if (signal?.aborted) {
      throw signal.reason;
    }
    if (outcome.done) {
      return { port, hello: outcome.result };
    }
    if (outcome.fatal) {
      throw outcome.fatal;
    }
    if (outcome.message !== previous?.message) {
      notify({ ...outcome, port });
    }
    previous = outcome;
    if (Date.now() + intervalMs > deadline) {
      const message = outcome.message + ' The forwarded-port handshake timed out; bind again after the Host shares the port.';
      fail('host_port_forward_required', message, { needsUser: true, port, reason: outcome.reason });
    }
    await abortableDelay(intervalMs, signal);
  }
}

module.exports = {
  MUTATION_ACTIONS,
  REQUEST_LIMIT_BYTES,
  RESPONSE_LIMIT_BYTES,
  sendTcpRequest,
  parseExcludedPortRanges,
  queryExcludedPortRanges,
  isPortFree,
  chooseGuestPort,
  awaitForwardedPort,
  notSharedMessage,
  foreignPortMessage,
};
