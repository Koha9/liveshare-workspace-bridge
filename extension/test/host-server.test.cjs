'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  SKIP,
  makeRoot,
  freePorts,
  listen,
  closeServer,
  startServer,
  startScript,
  send,
  request,
} = require('./host-server-helpers.cjs');

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

test('rendered single-file Host helper runs without the core or runtime files beside it', { skip: SKIP, timeout: 120000 }, async t => {
  const { renderServerBootstrap } = require('../host-bootstrap.cjs');
  const root = makeRoot(t);
  const scriptDirectory = makeRoot(t);
  const token = crypto.randomBytes(32).toString('hex');
  const port = await freePorts(1);
  const script = path.join(scriptDirectory, 'rendered-helper.ps1');
  fs.writeFileSync(script, renderServerBootstrap({ token, port, portAttempts: 1, idleTimeoutMs: 60000 }));
  assert.deepEqual(fs.readdirSync(scriptDirectory), ['rendered-helper.ps1']);
  const server = startScript(t, script, ['-WorkspaceRoot', root]);
  const banner = await server.banner;
  assert.deepEqual(banner, { port, protocol: 3, token: token.slice(0, 8) });

  const hello = await request(port, token, 'hello');
  assert.equal(hello.reply.ok, true, JSON.stringify(hello.reply));
  assert.equal(hello.reply.result.protocol, 3);
  assert.equal(hello.reply.result.transport, 'tcp');

  // A lone CR line is empty after trimming, not a two-byte line.
  const carriage = await send(port, '\r');
  assert.equal(carriage.ok, false);
  assert.equal(carriage.error.code, 'invalid_frame');

  const stop = await request(port, token, 'shutdown');
  assert.equal(stop.reply.result.stopping, true);
  assert.equal(await server.exited, 0, server.state.stdout + server.state.stderr);
  assert.doesNotMatch(server.state.stdout, new RegExp(token));
});
