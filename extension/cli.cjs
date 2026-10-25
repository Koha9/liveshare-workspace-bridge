#!/usr/bin/env node
'use strict';
// Self-contained: this file is also distributed as the Codex skill client.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const registry = path.join(os.homedir(), '.liveshare-local', 'instances');
const MAX_REQUEST = 2 * 1024 * 1024, MAX_RESPONSE = 4 * 1024 * 1024;
function transportError(message, sent) {
  return Object.assign(new Error(message), { code: sent ? 'transport_outcome_unknown' : 'transport_unavailable', requestSent: sent });
}
function requestOnce(instance, body, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_REQUEST) { reject(Object.assign(new Error('Request exceeds 2 MiB.'), { code: 'request_limit' })); return; }
    const socket = net.createConnection(`\\\\.\\pipe\\${instance.pipeName}`);
    let buffer = '', bytes = 0, sent = false, done = false;
    const finish = (err, result) => {
      if (done) return; done = true; clearTimeout(timer); socket.destroy();
      if (err) reject(err); else resolve(result);
    };
    const timer = setTimeout(() => finish(transportError('IPC timeout. If requestSent=true, inspect state before retrying a mutation.', sent)), timeoutMs);
    socket.setEncoding('utf8');
    socket.once('connect', () => { sent = true; socket.write(serialized + '\n'); });
    socket.on('data', data => {
      bytes += Buffer.byteLength(data, 'utf8');
      if (bytes > MAX_RESPONSE) { finish(transportError('IPC response exceeds 4 MiB; operation outcome may be unknown.', sent)); return; }
      buffer += data;
      const end = buffer.indexOf('\n');
      if (end >= 0) {
        try { finish(null, JSON.parse(buffer.slice(0, end))); }
        catch { finish(transportError('Invalid IPC reply; operation outcome may be unknown.', sent)); }
      }
    });
    socket.once('error', err => finish(Object.assign(transportError(err.message, sent), { transportCode: err.code })));
    socket.once('close', () => { if (!done) finish(transportError('IPC closed without a reply.', sent)); });
  });
}
async function request(instance, body, timeoutMs = 30000) {
  const deadline = Date.now() + Math.min(1500, timeoutMs);
  for (;;) {
    try { return await requestOnce(instance, body, timeoutMs); }
    catch (err) {
      // Retry only before connecting/sending. Never repeat a request with an uncertain outcome.
      if (err.requestSent === false && ['EBUSY', 'EPIPE', 'ENOENT', 'ECONNREFUSED'].includes(err.transportCode) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 75));
      else throw err;
    }
  }
}
function records() {
  let names;
  try { names = fs.readdirSync(registry); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  const result = [];
  for (const name of names.filter(x => /^[0-9a-f-]+\.json$/u.test(x))) {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(registry, name), 'utf8'));
      if (/^[0-9a-f-]+$/u.test(entry.id) && /^liveshare-local-\d+-[0-9a-f-]+$/u.test(entry.pipeName)) result.push(entry);
    } catch {} // Ignore incomplete or stale records; discovery below checks server identity.
  }
  return result;
}
async function instances() {
  const found = [];
  for (const entry of records()) {
    try {
      const response = await request(entry, { op: 'info', instance: entry.id }, 2000);
      if (response.ok && response.result.id === entry.id) found.push({ ...entry, epoch: response.result.epoch, roots: response.result.roots, info: response.result });
    } catch {}
  }
  return found;
}
function unsuccessful(response) {
  if (!response.ok) return true;
  const r = response.result;
  return r?.applied === false || r?.saved === false || r?.dirty === true && r?.applied === true || r?.files?.some(x => x.ok === false || x.saved === false);
}
async function main() {
  const args = process.argv.slice(2), options = {};
  while (args.length) {
    const key = args.shift();
    if (key === 'instances') { process.stdout.write(JSON.stringify(await instances(), null, 2) + '\n'); return; }
    if (key === '--help') { process.stdout.write('instances | [--instance ID] [--workspace URI] [--epoch N] [--request FILE]\nJSON from stdin when --request is omitted. paths are workspace-relative.\n'); return; }
    if (!['--instance', '--workspace', '--request', '--epoch'].includes(key) || !args.length) throw new Error(`Unknown or incomplete option: ${key}`);
    options[key.slice(2)] = args.shift();
  }
  const raw = fs.readFileSync(options.request || 0, 'utf8').replace(/^\uFEFF/u, '');
  if (Buffer.byteLength(raw, 'utf8') > MAX_REQUEST) throw new Error('Request exceeds 2 MiB.');
  const body = JSON.parse(raw);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Request must be an object.');
  const chosen = options.instance || body.instance;
  if (chosen && body.op !== 'info' && body.epoch === undefined && options.epoch === undefined) throw new Error('Pin --epoch from instances along with --instance to avoid following a changed workspace.');
  let candidates;
  if (chosen) candidates = records().filter(x => x.id === chosen); // No info ping for a selected instance.
  else candidates = (await instances()).filter(x => x.roots.length);
  if (candidates.length !== 1) throw new Error(`Expected one instance, found ${candidates.length}. Run instances and explicitly select the intended window.`);
  const instance = candidates[0];
  body.instance = instance.id;
  body.epoch ??= options.epoch === undefined ? instance.epoch : Number(options.epoch);
  body.workspace ??= options.workspace;
  if (body.op !== 'info' && !body.workspace) throw new Error('Set workspace to an exact root URI returned by instances.');
  const response = await request(instance, body);
  process.stdout.write(JSON.stringify(response, null, 2) + '\n');
  if (unsuccessful(response)) process.exitCode = 1;
}
if (require.main === module) main().catch(err => { process.stdout.write(JSON.stringify({ ok: false, error: { code: err.code || 'client_error', message: err.message, ...(err.requestSent !== undefined ? { requestSent: err.requestSent } : {}) } }, null, 2) + '\n'); process.exitCode = 1; });
module.exports = { request, instances, records, unsuccessful };
