'use strict';
// End-to-end checks of the Host actions (host-core.ps1 and host-runtime.cs)
// through the rendered single-file Host helper over loopback TCP.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { renderServerBootstrap } = require('../host-bootstrap.cjs');
const { SKIP, makeRoot, freePorts, startScript, request } = require('./host-server-helpers.cjs');

const ALL_BYTES = Buffer.from(Array.from({ length: 256 }, (_, index) => index));

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function startHelper(t, root) {
  const token = crypto.randomBytes(32).toString('hex');
  const port = await freePorts(1);
  const scripts = makeRoot(t, 'lswb runtime ');
  const script = path.join(scripts, 'helper.ps1');
  const options = { token, port, portAttempts: 1, idleTimeoutMs: 60000, outputLimit: 1024, chunkBytes: 32768, transferTtl: 10000 };
  fs.writeFileSync(script, renderServerBootstrap(options));
  const server = startScript(t, script, ['-WorkspaceRoot', root]);
  await server.banner;
  const call = async (action, fields = {}) => (await request(port, token, action, fields)).reply;
  return { server, call };
}

async function checkBytes(call, root) {
  const base64 = ALL_BYTES.toString('base64');
  const hash = sha256(ALL_BYTES);
  const escape = await call('stat', { path: '../outside' });
  assert.equal(escape.ok, false);
  assert.equal(escape.error.code, 'outside_workspace');

  const write = await call('writeBytes', { path: 'bytes.bin', base64, sha256: hash });
  assert.ok(write.ok && write.result.written, JSON.stringify(write));
  const read = await call('readBytes', { path: 'bytes.bin' });
  assert.ok(read.ok && read.result.base64 === base64 && read.result.sha256 === hash, 'byte fidelity');

  const refused = await call('writeBytes', { path: 'bytes.bin', base64, sha256: hash });
  assert.equal(refused.ok, false, 'overwrite accepted without flag');
  const guarded = await call('writeBytes', { path: 'bytes.bin', base64, sha256: hash, overwrite: true, expectedCurrentSha256: '0'.repeat(64) });
  assert.equal(guarded.ok, false);
  assert.equal(fs.readFileSync(path.join(root, 'bytes.bin')).toString('base64'), base64);
}

async function checkTransfers(call, root) {
  const base64 = ALL_BYTES.toString('base64');
  const begin = await call('beginWrite', { path: 'nested/large.bin', size: 768, parents: true });
  assert.ok(begin.ok, JSON.stringify(begin));
  const transferId = begin.result.transferId;
  for (let sequence = 0; sequence < 3; sequence++) {
    const chunk = await call('writeChunk', { transferId, sequence, base64 });
    assert.ok(chunk.ok, JSON.stringify(chunk));
    if (sequence === 0) {
      const again = await call('writeChunk', { transferId, sequence: 0, base64 });
      assert.equal(again.result.bytesReceived, 256, 'duplicate chunk appended twice');
    }
  }
  const all = Buffer.concat([ALL_BYTES, ALL_BYTES, ALL_BYTES]);
  const commit = await call('commitWrite', { transferId, path: 'nested/large.bin', sha256: sha256(all) });
  assert.ok(commit.ok && commit.result.written, JSON.stringify(commit));

  const open = await call('openRead', { path: 'nested/large.bin' });
  assert.ok(open.ok, JSON.stringify(open));
  let offset = 0;
  let piece;
  while (offset < 768) {
    piece = await call('readChunk', { transferId: open.result.transferId, offset, count: 200 });
    assert.ok(piece.ok, JSON.stringify(piece));
    offset = piece.result.nextOffset;
  }
  assert.ok(piece.result.complete && piece.result.sha256 === sha256(all), 'download hash');

  const copy = await call('copyDirectory', { path: 'nested', to: 'copied', parents: true });
  assert.ok(copy.ok, JSON.stringify(copy));
  assert.equal(sha256(fs.readFileSync(path.join(root, 'copied', 'large.bin'))), sha256(all));
}

async function checkJobs(call) {
  const job = (command, fields = {}) => call('startJob', { command, waitMs: 3000, timeoutMs: 5000, cwd: '', ...fields });
  const output = await job('[Console]::Write(("x"*5000));[Console]::Error.Write(("e"*4000));exit 7');
  const result = output.result;
  assert.ok(output.ok && result.state === 'completed' && result.exitCode === 7, JSON.stringify(output));
  assert.ok(result.stdout.length === 1024 && result.stdoutTruncated && result.stderrTruncated, 'output limits');
  const native = await job('cmd.exe /d /c exit 7');
  assert.equal(native.result.exitCode, 7, 'native exit code');
  const failed = await job('throw "controlled"');
  assert.ok(failed.result.exitCode === 1 && /controlled/u.test(failed.result.stderr), 'PowerShell failure');
  const input = await job('if($null -eq [Console]::ReadLine()){Write-Output "STDIN_EOF"}else{throw "unexpected input"}');
  assert.match(input.result.stdout, /STDIN_EOF/u, 'child inherited input');

  const slow = await job('Start-Sleep -Seconds 30', { waitMs: 0, timeoutMs: 1000 });
  await new Promise(resolve => setTimeout(resolve, 1300));
  const poll = await call('pollJob', { jobId: slow.result.jobId, waitMs: 3000, stdoutOffset: 0, stderrOffset: 0 });
  assert.equal(poll.result.state, 'timed_out');
  const cancel = await job('Start-Sleep -Seconds 30', { waitMs: 0, timeoutMs: 10000 });
  const stopped = await call('cancelJob', { jobId: cancel.result.jobId });
  assert.equal(stopped.result.state, 'cancelled');
}

test('Windows Host helper preserves bytes, verifies chunked transfers, executes bounded jobs and rejects escapes', { skip: SKIP, timeout: 120000 }, async t => {
  const root = makeRoot(t, 'lswb runtime ');
  const { server, call } = await startHelper(t, root);
  await checkBytes(call, root);
  await checkTransfers(call, root);
  await checkJobs(call);
  const stop = await call('shutdown');
  assert.equal(stop.result.stopping, true);
  assert.equal(await server.exited, 0, server.state.stdout + server.state.stderr);
});
