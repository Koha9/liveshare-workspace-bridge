'use strict';

// Host-side MCP tools (host-operations.cjs) and the local-file upload/patch tools
// against a scripted fake bridge. Never touches ~/.liveshare-local.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tools = require('../mcp-tools.cjs');
const {
  ROOT,
  WINDOWS_ONLY,
  makeTempRegistry,
  startScriptedBridge,
  operationRequests,
  startServer,
} = require('./mcp-fixtures.cjs');

const CHUNK_BYTES = 32768;
const UPLOAD_BYTES = 100 * 1024;
const REUPLOAD_HINT = "Inspect the target's hash with lswb_host_stat before deciding whether to re-upload.";
const PATCH = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n';

// ---------------------------------------------------------------------------
// Local fixtures
// ---------------------------------------------------------------------------

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lswb-mcp-host-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeTempFile(t, name, content) {
  const filename = path.join(makeTempDir(t), name);
  fs.writeFileSync(filename, content);
  return filename;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function opsOf(bridge) {
  return operationRequests(bridge).map(body => body.op);
}

function countOp(bridge, op) {
  return opsOf(bridge).filter(name => name === op).length;
}

function settle() {
  // Give any accidental retry time to arrive before counting requests.
  return new Promise(resolve => setTimeout(resolve, 300));
}

// Scripted Host transfer endpoint; commit behaviour is selectable.
function transferScript({ commit = 'ok' } = {}) {
  const state = { chunks: [], writes: [] };
  state.reply = body => {
    if (body.op === 'transferBeginWrite') {
      return { ok: true, result: { transferId: 'tx-1', chunkBytes: CHUNK_BYTES, size: body.size } };
    }
    if (body.op === 'transferWrite') {
      state.writes.push({ sequence: body.sequence, base64Length: body.base64.length });
      state.chunks.push(Buffer.from(body.base64, 'base64'));
      return { ok: true, result: { received: body.sequence } };
    }
    if (body.op === 'transferCommit') {
      return commitReply(state, body, commit);
    }
    if (body.op === 'transferAbort') {
      return { ok: true, result: { aborted: true } };
    }
    return { ok: false, error: { code: 'unexpected', message: body.op } };
  };
  return state;
}

function commitReply(state, body, mode) {
  if (mode === 'drop') {
    return 'drop';
  }
  if (mode === 'reject') {
    const details = { mutationMayHaveOccurred: false, requestSent: true };
    return { ok: false, error: { code: 'host_transfer_integrity', message: 'Staged bytes did not match.', details } };
  }
  const received = sha256(Buffer.concat(state.chunks));
  state.commitMatched = received === body.sha256;
  return { ok: true, result: { written: true, sha256: received, size: Buffer.concat(state.chunks).length } };
}

// ---------------------------------------------------------------------------
// Per-tool round trips
// ---------------------------------------------------------------------------

const HOST_CASES = [
  { tool: 'lswb_host_status', op: 'hostStatus', fields: {} },
  { tool: 'lswb_host_bind', op: 'hostBind', fields: {} },
  { tool: 'lswb_host_bind', op: 'hostBind', fields: { hostWorkspacePath: 'C:\\work\\proj', acknowledgeRecovery: true } },
  {
    tool: 'lswb_search',
    op: 'search',
    fields: { query: 'TODO', include: ['src/**', 'lib/**'], exclude: 'dist/**', regex: true, caseSensitive: false, wholeWord: true, useExcludes: false, limit: 20 },
    result: { matches: [], complete: false, truncated: true, unsavedDocuments: ['vsls:/a.txt'], warning: 'saved only' },
  },
  { tool: 'lswb_search', op: 'search', fields: { query: 'x', include: '*.js' } },
  { tool: 'lswb_find_files', op: 'findFiles', fields: { pattern: '**/*.cs', exclude: ['bin/**'], useExcludes: true, limit: 5 } },
  { tool: 'lswb_find_files', op: 'findFiles', fields: { pattern: ['a/*', 'b/*'] } },
  { tool: 'lswb_host_stat', op: 'hostStat', fields: { path: 'a.bin', withHash: true, withTextHash: false } },
  { tool: 'lswb_copy', op: 'copy', fields: { path: 'a.bin', to: 'b.bin', overwrite: true, parents: false } },
  { tool: 'lswb_copy_dir', op: 'copyDirectory', fields: { path: 'src', to: 'src2', parents: true } },
  { tool: 'lswb_read_bytes', op: 'readBytes', fields: { path: 'a.bin' } },
  {
    tool: 'lswb_write_bytes',
    op: 'writeBytes',
    fields: { path: 'a.bin', base64: 'AAEC', overwrite: true, expectedCurrentSha256: 'ab'.repeat(32), parents: false },
    result: { written: true, mutationMayHaveOccurred: true, textStates: [] },
  },
  {
    tool: 'lswb_host_exec',
    op: 'hostExec',
    fields: { command: 'dotnet build', cwd: 'src', timeoutMs: 60000, waitMs: 500, affectedPaths: ['src/a.cs'] },
    result: { jobId: 'job-1', state: 'running', fileChanges: 'declared_paths' },
  },
  { tool: 'lswb_host_job_poll', op: 'hostJobPoll', fields: { jobId: 'job-1', waitMs: 100, stdoutOffset: 10, stderrOffset: 2 } },
  { tool: 'lswb_host_job_cancel', op: 'hostJobCancel', fields: { jobId: 'job-1' } },
  { tool: 'lswb_host_job_forget', op: 'hostJobForget', fields: { jobId: 'job-1' } },
  { tool: 'lswb_apply_patch', op: 'applyPatch', fields: { patch: PATCH, checkOnly: true } },
];

function presetResult(entry, index) {
  if (entry.result) {
    return entry.result;
  }
  return { echo: entry.op, index, nested: { kept: [1, 2, 3] } };
}

test('every Host tool sends exactly its fields and returns the result unchanged', WINDOWS_ONLY, async t => {
  const registryDir = makeTempRegistry(t);
  let current = null;
  const bridge = await startScriptedBridge(t, registryDir, {
    reply: () => ({ ok: true, result: current }),
  });
  const session = startServer(t, registryDir);

  for (const [index, entry] of HOST_CASES.entries()) {
    current = presetResult(entry, index);
    const before = operationRequests(bridge).length;
    const response = await session.callTool(entry.tool, { workspace: ROOT, ...entry.fields });
    const label = `${entry.tool} #${index}`;
    assert.equal(response.error, undefined, label);
    assert.notEqual(response.result.isError, true, label);
    assert.deepEqual(response.result.structuredContent, current, label);
    const sent = operationRequests(bridge).slice(before);
    assert.equal(sent.length, 1, label);
    const expected = { op: entry.op, instance: bridge.id, epoch: bridge.epoch, workspace: ROOT, ...entry.fields };
    assert.deepEqual(sent[0], expected, label);
  }
  const covered = new Set([...HOST_CASES.map(entry => entry.tool), 'lswb_apply_patch_file', 'lswb_upload_file']);
  const hostTools = tools.HOST_TOOLS.map(tool => tool.name);
  assert.deepEqual(hostTools.filter(name => !covered.has(name)), []);
});

test('Host extension errors pass details such as mutationMayHaveOccurred through unchanged', WINDOWS_ONLY, async t => {
  const registryDir = makeTempRegistry(t);
  const error = {
    code: 'host_channel_uncertain',
    message: 'Host command outcome is unknown.',
    details: { mutationMayHaveOccurred: true, requestSent: true },
  };
  await startScriptedBridge(t, registryDir, {
    reply: () => ({ ok: false, error }),
  });
  const session = startServer(t, registryDir);

  const response = await session.callTool('lswb_copy', { workspace: ROOT, path: 'a', to: 'b' });
  assert.equal(response.result.isError, true);
  assert.deepEqual(response.result.structuredContent, error);
});

// ---------------------------------------------------------------------------
// lswb_upload_file
// ---------------------------------------------------------------------------

async function startUpload(t, commit) {
  const registryDir = makeTempRegistry(t);
  const script = transferScript({ commit });
  const bridge = await startScriptedBridge(t, registryDir, { reply: script.reply });
  const session = startServer(t, registryDir);
  const data = crypto.randomBytes(UPLOAD_BYTES);
  const localPath = writeTempFile(t, 'payload.bin', data);
  return { bridge, session, script, data, localPath };
}

test('lswb_upload_file streams chunkBytes-sized chunks and commits the file hash', WINDOWS_ONLY, async t => {
  const { bridge, session, script, data, localPath } = await startUpload(t, 'ok');

  const response = await session.callTool('lswb_upload_file', { workspace: ROOT, localPath, path: 'bin/payload.bin', overwrite: true });
  assert.notEqual(response.result.isError, true, JSON.stringify(response.result));
  const result = response.result.structuredContent;
  assert.equal(result.bytes, UPLOAD_BYTES);
  assert.equal(result.sha256, sha256(data));
  assert.equal(result.written, true);
  assert.equal(result.path, 'bin/payload.bin');

  assert.deepEqual(script.writes, [
    { sequence: 0, base64Length: 43692 },
    { sequence: 1, base64Length: 43692 },
    { sequence: 2, base64Length: 43692 },
    { sequence: 3, base64Length: 5464 },
  ]);
  assert.equal(script.commitMatched, true);

  const sent = operationRequests(bridge);
  assert.deepEqual(sent[0], {
    op: 'transferBeginWrite',
    instance: bridge.id,
    epoch: bridge.epoch,
    workspace: ROOT,
    path: 'bin/payload.bin',
    size: UPLOAD_BYTES,
    overwrite: true,
  });
  const commit = sent.find(body => body.op === 'transferCommit');
  assert.deepEqual(commit, { op: 'transferCommit', instance: bridge.id, epoch: bridge.epoch, workspace: ROOT, transferId: 'tx-1', sha256: sha256(data) });
  assert.deepEqual(opsOf(bridge), ['transferBeginWrite', 'transferWrite', 'transferWrite', 'transferWrite', 'transferWrite', 'transferCommit']);
});

test('a rejected commit is followed by transferAbort and never a second commit', WINDOWS_ONLY, async t => {
  const { bridge, session, localPath } = await startUpload(t, 'reject');

  const response = await session.callTool('lswb_upload_file', { workspace: ROOT, localPath, path: 'payload.bin' });
  assert.equal(response.result.isError, true);
  const structured = response.result.structuredContent;
  assert.equal(structured.code, 'host_transfer_integrity');
  assert.deepEqual(structured.details, { mutationMayHaveOccurred: false, requestSent: true });

  await settle();
  assert.equal(countOp(bridge, 'transferCommit'), 1);
  const ops = opsOf(bridge);
  assert.equal(ops[ops.length - 1], 'transferAbort');
  const abort = operationRequests(bridge).find(body => body.op === 'transferAbort');
  assert.deepEqual(abort, { op: 'transferAbort', instance: bridge.id, epoch: bridge.epoch, workspace: ROOT, transferId: 'tx-1' });
});

test('a dropped commit is transport_outcome_unknown with a hash hint and is not retried', WINDOWS_ONLY, async t => {
  const { bridge, session, localPath } = await startUpload(t, 'drop');

  const response = await session.callTool('lswb_upload_file', { workspace: ROOT, localPath, path: 'payload.bin' });
  assert.equal(response.result.isError, true);
  const structured = response.result.structuredContent;
  assert.equal(structured.code, 'transport_outcome_unknown');
  assert.ok(structured.message.includes(REUPLOAD_HINT), structured.message);
  assert.equal(structured.details.requestSent, true);
  assert.equal(structured.details.stage, 'transferCommit');

  await settle();
  assert.equal(countOp(bridge, 'transferCommit'), 1);
  assert.equal(countOp(bridge, 'transferBeginWrite'), 1);
  // Cleanup abort is best effort only.
  assert.ok(countOp(bridge, 'transferAbort') <= 1);
});

test('lswb_upload_file reports local_file_unavailable without contacting the bridge', WINDOWS_ONLY, async t => {
  const registryDir = makeTempRegistry(t);
  const bridge = await startScriptedBridge(t, registryDir, { reply: () => ({ ok: true, result: {} }) });
  const session = startServer(t, registryDir);
  const dir = makeTempDir(t);

  for (const localPath of [path.join(dir, 'missing.bin'), dir]) {
    const response = await session.callTool('lswb_upload_file', { workspace: ROOT, localPath, path: 'x.bin' });
    assert.equal(response.result.isError, true, localPath);
    assert.equal(response.result.structuredContent.code, 'local_file_unavailable', localPath);
  }
  assert.deepEqual(operationRequests(bridge), []);
});

// ---------------------------------------------------------------------------
// lswb_apply_patch_file
// ---------------------------------------------------------------------------

test('lswb_apply_patch_file sends the file text without its BOM', WINDOWS_ONLY, async t => {
  const registryDir = makeTempRegistry(t);
  const result = { applied: true, checked: true, checkOnly: true, files: ['a.txt'] };
  const bridge = await startScriptedBridge(t, registryDir, { reply: () => ({ ok: true, result }) });
  const session = startServer(t, registryDir);
  const localPath = writeTempFile(t, 'change.patch', '\uFEFF' + PATCH);

  const response = await session.callTool('lswb_apply_patch_file', { workspace: ROOT, localPath, checkOnly: true });
  assert.notEqual(response.result.isError, true);
  assert.deepEqual(response.result.structuredContent, result);
  assert.deepEqual(operationRequests(bridge), [
    { op: 'applyPatch', instance: bridge.id, epoch: bridge.epoch, workspace: ROOT, patch: PATCH, checkOnly: true },
  ]);
});

test('lswb_apply_patch_file rejects missing, oversized and relative local paths', WINDOWS_ONLY, async t => {
  const registryDir = makeTempRegistry(t);
  const bridge = await startScriptedBridge(t, registryDir, { reply: () => ({ ok: true, result: {} }) });
  const session = startServer(t, registryDir);

  const missing = path.join(makeTempDir(t), 'missing.patch');
  const absent = await session.callTool('lswb_apply_patch_file', { workspace: ROOT, localPath: missing });
  assert.equal(absent.result.isError, true);
  assert.equal(absent.result.structuredContent.code, 'local_file_unavailable');

  const large = writeTempFile(t, 'large.patch', 'x'.repeat(1024 * 1024 + 1));
  const oversized = await session.callTool('lswb_apply_patch_file', { workspace: ROOT, localPath: large });
  assert.equal(oversized.result.isError, true);
  assert.equal(oversized.result.structuredContent.code, 'invalid_patch');

  // Relative paths are invalid params (-32602), decided before any file access.
  const relative = [
    ['lswb_apply_patch_file', { workspace: ROOT, localPath: 'change.patch' }],
    ['lswb_upload_file', { workspace: ROOT, localPath: 'payload.bin', path: 'x.bin' }],
  ];
  for (const [name, args] of relative) {
    const response = await session.callTool(name, args);
    assert.equal(response.error && response.error.code, -32602, name);
    assert.ok(response.error.message.includes('absolute'), response.error.message);
  }
  assert.deepEqual(operationRequests(bridge), []);
});

// ---------------------------------------------------------------------------
// tools/list and argument validation
// ---------------------------------------------------------------------------

test('tools/list describes every Host tool with a closed, workspace-bound schema', async t => {
  const session = startServer(t, makeTempRegistry(t));
  const response = await session.request('tools/list', {});
  const listed = response.result.tools;
  const byName = Object.fromEntries(listed.map(tool => [tool.name, tool]));

  for (const { name } of tools.HOST_TOOLS) {
    const tool = byName[name];
    assert.ok(tool, name);
    assert.ok(tool.description.length > 0, name);
    assert.equal(tool.inputSchema.additionalProperties, false, name);
    assert.ok(tool.inputSchema.required.includes('workspace'), name);
  }
  assert.ok(byName.lswb_host_exec.description.includes('affectedPaths'));
  assert.ok(byName.lswb_host_bind.description.includes('acknowledgeRecovery:true'));
  assert.ok(byName.lswb_search.description.includes('unsavedDocuments'));
  assert.ok(byName.lswb_copy_dir.description.includes('must not exist'));
  for (const name of ['lswb_upload_file', 'lswb_apply_patch_file']) {
    assert.ok(byName[name].description.includes('localPath is a path on the machine running this MCP server, not a workspace path'), name);
  }
  assert.deepEqual(listed.filter(tool => /download/iu.test(tool.name)).map(tool => tool.name), []);
  assert.deepEqual(byName.lswb_upload_file.inputSchema.required, ['workspace', 'localPath', 'path']);
});

test('invalid Host tool arguments are rejected with -32602 before any request', async t => {
  const session = startServer(t, makeTempRegistry(t));
  const invalid = [
    ['lswb_search', { workspace: ROOT }],
    ['lswb_search', { workspace: ROOT, query: 'x', include: 3 }],
    ['lswb_search', { workspace: ROOT, query: 'x', include: ['a', 1] }],
    ['lswb_find_files', { workspace: ROOT, include: '*.js' }],
    ['lswb_host_exec', { workspace: ROOT, command: 'x', affectedPaths: 'a.txt' }],
    ['lswb_host_job_poll', { workspace: ROOT }],
    ['lswb_copy_dir', { workspace: ROOT, path: 'a', to: 'b', overwrite: true }],
    ['lswb_host_stat', { workspace: ROOT }],
    ['lswb_upload_file', { workspace: ROOT, localPath: 'C:\\x.bin' }],
  ];
  for (const [name, args] of invalid) {
    const response = await session.callTool(name, args);
    assert.equal(response.error && response.error.code, -32602, `${name} ${JSON.stringify(args)}`);
  }
});

test('glob arguments accept a string or an array of strings', () => {
  const search = tools.TOOLS.find(tool => tool.name === 'lswb_search');
  assert.equal(search.validate({ workspace: ROOT, query: 'x', include: '*.js' }), null);
  assert.equal(search.validate({ workspace: ROOT, query: 'x', include: ['*.js'] }), null);
  assert.equal(search.validate({ workspace: ROOT, query: 'x', include: 1 }), 'include must be a string or array.');
  assert.equal(search.validate({ workspace: ROOT, query: 'x', exclude: ['a', 2] }), 'exclude[1] must be a string.');
});
