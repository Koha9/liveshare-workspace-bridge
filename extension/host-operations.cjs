'use strict';
// Maps the public Host operations onto narrow Host helper actions. Each
// handler validates its arguments, guards affected editor documents and binds
// jobs and transfers to the workspace binding. The order of checks, guards
// and action fields is part of the behavior and is kept deliberately.
const crypto = require('node:crypto');
const { fail, integer } = require('./core.cjs');
const { patchPaths } = require('./patch.cjs');

const OPERATIONS = [
  'hostStatus',
  'hostBind',
  'hostStat',
  'copy',
  'copyDirectory',
  'search',
  'findFiles',
  'applyPatch',
  'readBytes',
  'writeBytes',
  'hostExec',
  'hostJobPoll',
  'hostJobCancel',
  'hostJobForget',
  'transferOpenRead',
  'transferBeginWrite',
  'transferRead',
  'transferWrite',
  'transferCommit',
  'transferAbort',
];
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const CONTROL_CHARACTER = /[\x00-\x1f]/u;
const SHA256_HEX = /^[a-f0-9]{64}$/iu;
const MAX_INT32 = 2147483647;
const JOB_ACTIONS = { hostJobPoll: 'pollJob', hostJobCancel: 'cancelJob', hostJobForget: 'forgetJob' };
const SAVED_FILES_WARNING = 'Host results cover saved disk files. Dirty buffers are not saved or merged into these results.';

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function base64Bytes(value, limit) {
  const maxLength = Math.ceil(limit / 3) * 4 + 4;
  if (typeof value !== 'string' || value.length > maxLength || !CANONICAL_BASE64.test(value)) {
    fail('invalid_base64', 'Use canonical base64 within the configured chunk size.');
  }
  const data = Buffer.from(value, 'base64');
  if (data.length > limit) {
    fail('chunk_limit', 'Chunk exceeds configured limit.');
  }
  return data;
}

function isInvalidPattern(pattern) {
  return typeof pattern !== 'string' || pattern.length > 4096 || CONTROL_CHARACTER.test(pattern);
}

function patterns(value, name) {
  if (value === undefined || value === '') {
    return [];
  }
  const result = Array.isArray(value) ? value : [value];
  if (result.length > 100 || result.some(isInvalidPattern)) {
    fail('invalid_argument', `${name} must be a glob or array of at most 100 globs.`);
  }
  return result;
}

function textPathsOf(refreshers) {
  return refreshers.flatMap(f => f.paths);
}

function finishAll(refreshers, textStates) {
  for (const finish of refreshers) {
    finish(textStates);
  }
}

function createHostOperations({ vscode, host, permissions, resolve, rejectDirty, noteExternalChange }) {
  // Per-request helpers shared by the handlers below.
  function requestContext(r, uri) {
    return {
      r,
      uri,
      request: action => host.request(uri, r.op, action),
      limit: permissions.value('transfer.chunkBytes', 32768),
      path: () => resolve(r, r.path).uri,
      parentOption: () => {
        if (r.parents === true) {
          permissions.assert('mkdir');
        }
        return r.parents !== false && permissions.enabled('mkdir');
      },
    };
  }

  async function hostStat({ r, uri, request, path }) {
    const target = path();
    if (r.withHash) {
      permissions.assert('readBytes');
    }
    if (r.withTextHash) {
      permissions.assert('read');
    }
    const refreshed = r.withTextHash ? noteExternalChange(target, uri) : null;
    const action = { action: 'stat', path: r.path, withHash: r.withHash === true, inspectTextPaths: refreshed?.paths };
    const result = await request(action);
    if (refreshed) {
      refreshed(result.textStates);
    }
    return result;
  }

  function searchArguments(r) {
    const include = patterns(r.op === 'findFiles' ? r.pattern : r.include, 'include');
    const exclude = patterns(r.exclude, 'exclude');
    const useExcludes = r.useExcludes !== false;
    const limit = integer(r.limit ?? 500, 'limit', 1, 10000);
    const args = { action: r.op, include, exclude, useExcludes, limit };
    if (r.op === 'search') {
      if (typeof r.query !== 'string' || !r.query || r.query.length > 10000) {
        fail('invalid_query', 'query must contain 1..10000 characters.');
      }
      Object.assign(args, { query: r.query, regex: r.regex === true, caseSensitive: r.caseSensitive === true, wholeWord: r.wholeWord === true });
    }
    return args;
  }

  function unsavedDocumentsIn(uri) {
    const dirty = vscode.workspace.textDocuments.filter(d => d.uri.scheme === uri.scheme && d.uri.authority === uri.authority && d.isDirty);
    return dirty.map(d => d.uri.toString());
  }

  async function searchOrFind({ r, uri, request }) {
    const result = await request(searchArguments(r));
    return { ...result, unsavedDocuments: unsavedDocumentsIn(uri), warning: SAVED_FILES_WARNING };
  }

  async function copyPath({ r, uri, request, path, parentOption }) {
    if (r.op === 'copyDirectory' && r.overwrite === true) {
      fail('not_supported', 'Directory copies require a new destination; merge/recursive replacement is not provided.');
    }
    const source = path();
    const destination = resolve(r, r.to).uri;
    if (source.toString() === destination.toString()) {
      fail('invalid_destination', 'Source and destination must differ.');
    }
    rejectDirty(source);
    rejectDirty(destination);
    if (r.overwrite) {
      permissions.assert('write');
    }
    const refreshed = noteExternalChange(destination, uri);
    const action = {
      action: r.op === 'copy' ? 'copyFile' : 'copyDirectory',
      path: r.path,
      to: r.to,
      overwrite: r.overwrite === true,
      parents: parentOption(),
      inspectTextPaths: refreshed.paths,
    };
    const result = await request(action);
    refreshed(result.textStates);
    return { ...result, from: source.toString(), to: destination.toString() };
  }

  async function readBytes({ r, request, path, limit }) {
    const source = path();
    const result = await request({ action: 'readBytes', path: r.path });
    const data = base64Bytes(result.base64, limit);
    if (data.length !== result.bytes || sha256Hex(data) !== result.sha256) {
      fail('host_transfer_integrity', 'Host byte read failed integrity validation.');
    }
    return { ...result, uri: source.toString(), scope: 'saved_host_file' };
  }

  async function writeBytes({ r, uri, request, path, limit, parentOption }) {
    const target = path();
    rejectDirty(target);
    const data = base64Bytes(r.base64, limit);
    if (r.overwrite) {
      permissions.assert('write');
    }
    const refreshed = noteExternalChange(target, uri);
    const action = {
      action: 'writeBytes',
      path: r.path,
      base64: r.base64,
      size: data.length,
      sha256: sha256Hex(data),
      overwrite: r.overwrite === true,
      expectedCurrentSha256: r.expectedCurrentSha256,
      parents: parentOption(),
      inspectTextPaths: refreshed.paths,
    };
    const result = await request(action);
    refreshed(result.textStates);
    return { ...result, uri: target.toString() };
  }

  async function applyPatch({ r, uri, request }) {
    for (const permission of ['edit', 'create', 'delete', 'move']) {
      permissions.assert(permission);
    }
    const paths = patchPaths(r.patch);
    for (const filename of paths) {
      rejectDirty(resolve(r, filename).uri);
    }
    const checkOnly = r.checkOnly === true;
    const refreshed = checkOnly ? [] : paths.map(filename => noteExternalChange(resolve(r, filename).uri, uri));
    const action = { action: 'applyPatch', patch: r.patch, paths, checkOnly, inspectTextPaths: textPathsOf(refreshed) };
    const result = await request(action);
    finishAll(refreshed, result.textStates);
    return result;
  }

  // Each declared path is resolved, dirty-checked and tracked in turn.
  function trackAffectedPaths(r, uri, affected) {
    return affected.map(filename => {
      const target = resolve(r, filename).uri;
      rejectDirty(target);
      return noteExternalChange(target, uri);
    });
  }

  async function hostExec({ r, uri, request }) {
    if (typeof r.command !== 'string' || !r.command || r.command.length > 8000) {
      fail('invalid_argument', 'command must contain 1..8000 characters.');
    }
    resolve(r, r.cwd ?? '', true);
    const waitMs = integer(r.waitMs ?? 1000, 'waitMs', 0, 5000);
    const timeoutMs = integer(r.timeoutMs ?? permissions.value('host.commandTimeoutMs', 120000), 'timeoutMs', 1000, 3600000);
    const affected = r.affectedPaths ?? [];
    if (!Array.isArray(affected) || affected.length > 100) {
      fail('invalid_argument', 'affectedPaths must contain at most 100 relative paths.');
    }
    const refreshed = trackAffectedPaths(r, uri, affected);
    const action = { action: 'startJob', command: r.command, cwd: r.cwd ?? '', timeoutMs, waitMs, inspectTextPaths: textPathsOf(refreshed) };
    const result = await request(action);
    const completed = result.state !== 'running';
    if (completed) {
      finishAll(refreshed, result.textStates);
    }
    host.jobs.set(result.jobId, { key: host.key(uri), refreshed, completed });
    return { ...result, fileChanges: affected.length ? 'declared_paths' : 'not_tracked' };
  }

  async function hostJob({ r, uri, request }) {
    const entry = host.resource(host.jobs, r.jobId, uri);
    if (r.op === 'hostJobForget' && entry.refreshed?.length && !entry.completed) {
      fail('job_result_required', 'Poll the final job result before forgetting a command with affectedPaths.');
    }
    const action = {
      action: JOB_ACTIONS[r.op],
      jobId: r.jobId,
      waitMs: integer(r.waitMs ?? 0, 'waitMs', 0, 5000),
      stdoutOffset: integer(r.stdoutOffset ?? 0, 'stdoutOffset', 0, MAX_INT32),
      stderrOffset: integer(r.stderrOffset ?? 0, 'stderrOffset', 0, MAX_INT32),
      inspectTextPaths: entry.completed ? [] : entry.refreshed?.flatMap(f => f.paths),
    };
    const result = await request(action);
    if (result.state && result.state !== 'running' && !entry.completed) {
      finishAll(entry.refreshed || [], result.textStates);
      entry.completed = true;
    }
    if (r.op === 'hostJobForget') {
      host.jobs.delete(r.jobId);
    }
    return result;
  }

  async function transferOpenRead({ r, uri, request, path }) {
    permissions.assert('readBytes');
    const source = path();
    const result = await request({ action: 'openRead', path: r.path });
    host.transfers.set(result.transferId, { key: host.key(uri), type: 'read', path: r.path, uri: source });
    return result;
  }

  async function transferBeginWrite({ r, uri, request, path, parentOption }) {
    permissions.assert('writeBytes');
    const target = path();
    rejectDirty(target);
    if (r.overwrite) {
      permissions.assert('write');
    }
    if (!Number.isSafeInteger(r.size) || r.size < 0) {
      fail('invalid_argument', 'size must be a nonnegative safe integer.');
    }
    const action = {
      action: 'beginWrite',
      path: r.path,
      size: r.size,
      overwrite: r.overwrite === true,
      expectedCurrentSha256: r.expectedCurrentSha256,
      parents: parentOption(),
    };
    const result = await request(action);
    host.transfers.set(result.transferId, { key: host.key(uri), type: 'write', path: r.path, uri: target, overwrite: r.overwrite === true });
    return result;
  }

  function transferReadChunk({ r, request, limit }, entry) {
    if (entry.type !== 'read') {
      fail('transfer_type', 'This is not a download.');
    }
    if (!Number.isSafeInteger(r.offset) || r.offset < 0) {
      fail('invalid_argument', 'offset must be a nonnegative safe integer.');
    }
    return request({ action: 'readChunk', transferId: r.transferId, offset: r.offset, count: integer(r.count ?? limit, 'count', 1, limit) });
  }

  async function transferCommit({ r, uri, request }, entry) {
    if (entry.overwrite) {
      permissions.assert('write');
    }
    if (!SHA256_HEX.test(r.sha256)) {
      fail('invalid_argument', 'sha256 must contain 64 hexadecimal characters.');
    }
    const refreshed = noteExternalChange(entry.uri, uri);
    const action = {
      action: 'commitWrite',
      transferId: r.transferId,
      path: entry.path,
      sha256: r.sha256,
      overwrite: entry.overwrite,
      inspectTextPaths: refreshed.paths,
    };
    const result = await request(action);
    host.transfers.delete(r.transferId);
    refreshed(result.textStates);
    return result;
  }

  // Chunk-level transfer operations on an existing handle.
  async function transferHandle(context) {
    const { r, uri, request, limit } = context;
    const entry = host.resource(host.transfers, r.transferId, uri);
    permissions.assert(entry.type === 'read' ? 'readBytes' : 'writeBytes');
    if (r.op === 'transferAbort') {
      const result = await request({ action: 'abortTransfer', transferId: r.transferId });
      host.transfers.delete(r.transferId);
      return result;
    }
    if (r.op === 'transferRead') {
      return transferReadChunk(context, entry);
    }
    if (entry.type !== 'write') {
      fail('transfer_type', 'This is not an upload.');
    }
    rejectDirty(entry.uri);
    if (r.op === 'transferWrite') {
      base64Bytes(r.base64, limit);
      return request({ action: 'writeChunk', transferId: r.transferId, sequence: integer(r.sequence, 'sequence', 0, MAX_INT32), base64: r.base64 });
    }
    if (r.op === 'transferCommit') {
      return transferCommit(context, entry);
    }
    fail('unknown_operation', 'Unknown Host operation.');
  }

  const HANDLERS = new Map([
    ['hostStat', hostStat],
    ['search', searchOrFind],
    ['findFiles', searchOrFind],
    ['copy', copyPath],
    ['copyDirectory', copyPath],
    ['readBytes', readBytes],
    ['writeBytes', writeBytes],
    ['applyPatch', applyPatch],
    ['hostExec', hostExec],
    ['hostJobPoll', hostJob],
    ['hostJobCancel', hostJob],
    ['hostJobForget', hostJob],
    ['transferOpenRead', transferOpenRead],
    ['transferBeginWrite', transferBeginWrite],
  ]);

  function handlerFor(op) {
    if (HANDLERS.has(op)) {
      return HANDLERS.get(op);
    }
    if (op.startsWith('transfer')) {
      return transferHandle;
    }
    return null;
  }

  async function dispatch(r) {
    const { root } = resolve(r, '', true);
    const uri = root.uri;
    if (r.op === 'hostStatus') {
      return host.status(uri);
    }
    permissions.assert(r.op);
    if (r.op === 'hostBind') {
      return host.bind(uri, r);
    }
    const context = requestContext(r, uri);
    const handler = handlerFor(r.op);
    if (!handler) {
      fail('unknown_operation', 'Unknown Host operation.');
    }
    return handler(context);
  }

  return { dispatch };
}

module.exports = { OPERATIONS, createHostOperations, base64Bytes, patterns };
