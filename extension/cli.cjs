#!/usr/bin/env node
'use strict';
// Human diagnostic CLI and the local transport library used by the MCP server.
// Agents use the MCP server (mcp-server.cjs); keep the exports below stable.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const registry = path.join(os.homedir(), '.liveshare-local', 'instances');
const MAX_REQUEST = 2 * 1024 * 1024;
const MAX_RESPONSE = 4 * 1024 * 1024;
const STARTUP_CODES = [
  'execution_policy_related_startup_block',
  'shell_executable_not_found',
  'helper_start_failed',
  'helper_startup_failed',
  'ipc_access_setup_failed',
  'ipc_helper_exited',
  'helper_stderr_observed',
];
const STARTUP_STAGES = ['access_setup', 'account_enumeration', 'process_start', 'helper_startup', 'ipc_runtime', 'unknown'];
const POLICY_VALUES = ['Restricted', 'AllSigned', 'RemoteSigned', 'Unrestricted', 'Bypass', 'Undefined', 'Default', 'unknown'];
const POLICY_SCOPES = ['MachinePolicy', 'UserPolicy', 'Process', 'CurrentUser', 'LocalMachine'];
const REQUESTED_SHELLS = ['powershell.exe', 'pwsh.exe', 'other'];
const ACTUAL_SHELLS = ['powershell.exe', 'pwsh.exe'];
const ACCESS_DENIED_CODES = ['EPERM', 'EACCES'];
const STARTUP_RECORD_NAME = /^[1-9]\d{0,9}\.json$/u;
const MAX_STARTUP_RECORDS = 32;
const MAX_STARTUP_RECORD_BYTES = 16384;
const MAX_STARTUP_RECORD_AGE_MS = 86400000;
const MAX_STARTUP_CLOCK_SKEW_MS = 300000;
const DISCOVERY_BATCH_SIZE = 4;
// Only these failures prove the request never left this process.
const RETRYABLE_UNSENT_CODES = ['EBUSY', 'EPIPE', 'ENOENT', 'ECONNREFUSED'];

function oneOf(value, values, fallback = 'unknown') {
  return values.includes(value) ? value : fallback;
}
function safeVersion(value) {
  const valid = typeof value === 'string' && /^\d{1,4}(?:\.\d{1,8}){1,4}$/u.test(value);
  return valid ? value : 'unknown';
}
function safeTime(value) {
  const valid = typeof value === 'string' && Number.isFinite(Date.parse(value));
  return valid ? new Date(value).toISOString() : null;
}
function safeAttempt(value) {
  const valid = typeof value === 'string' && /^[a-f0-9-]{36}$/u.test(value);
  return valid ? value : null;
}
// Core semver with an optional prerelease suffix of dot-separated non-empty identifiers.
const EXTENSION_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function safeExtensionVersion(value) {
  if (typeof value !== 'string') {
    return 'unknown';
  }
  if (!EXTENSION_VERSION_PATTERN.test(value)) {
    return 'unknown';
  }
  return value;
}

function isStartupRecord(value) {
  if (!value || value.producer !== 'lswb-startup-v1' || value.schemaVersion !== 1) {
    return false;
  }
  if (!Number.isSafeInteger(value.pid) || value.pid < 1) {
    return false;
  }
  return Boolean(safeTime(value.observedAt));
}
function eventCount(count) {
  if (!Number.isSafeInteger(count)) {
    return 1;
  }
  return Math.min(1000, Math.max(1, count));
}
function projectStartupEvent(e) {
  return {
    code: oneOf(e.code, STARTUP_CODES, 'helper_stderr_observed'),
    stage: oneOf(e.stage, STARTUP_STAGES),
    requestedExecutableName: oneOf(e.requestedExecutableName, REQUESTED_SHELLS),
    confidence: oneOf(e.confidence, ['high', 'low', 'unknown']),
    firstSeen: safeTime(e.firstSeen),
    lastSeen: safeTime(e.lastSeen),
    attemptId: safeAttempt(e.attemptId),
    firstAttemptId: safeAttempt(e.firstAttemptId),
    count: eventCount(e.count),
    historical: e.historical === true,
    encodingReplacementObserved: e.encodingReplacementObserved === true,
  };
}
function startupComponent(stage) {
  if (stage === 'account_enumeration') {
    return 'guest_local_account_enumeration_helper';
  }
  if (stage === 'access_setup') {
    return 'guest_local_bridge_access_setup';
  }
  return 'guest_local_ipc_helper';
}
function projectStartupCurrent(current) {
  const validEpoch = Number.isSafeInteger(current.epoch) && current.epoch >= 0;
  return {
    health: oneOf(current.health, ['starting', 'failed', 'ready', 'stopped']),
    stage: oneOf(current.stage, STARTUP_STAGES),
    attemptId: safeAttempt(current.attemptId),
    epoch: validEpoch ? current.epoch : null,
  };
}
function projectPolicyScopes(scopes) {
  const entries = POLICY_SCOPES.map(scope => [scope, oneOf(scopes?.[scope], POLICY_VALUES)]);
  return Object.fromEntries(entries);
}
function projectStartupShell(shell) {
  return {
    requestedExecutableName: oneOf(shell.requestedExecutableName, REQUESTED_SHELLS),
    actualExecutableName: oneOf(shell.actualExecutableName, ACTUAL_SHELLS),
    version: safeVersion(shell.version),
    edition: oneOf(shell.edition, ['Desktop', 'Core']),
    effectiveExecutionPolicy: oneOf(shell.effectiveExecutionPolicy, POLICY_VALUES),
    policyScopes: projectPolicyScopes(shell.policyScopes),
    metadataSource: oneOf(shell.metadataSource, ['requested_only', 'helper_ready']),
    actualIdentity: 'unknown',
    externalProbeIdentity: 'unknown',
    identityComparison: 'unknown',
  };
}
// Copy only allow-listed, normalized fields from an untrusted startup record.
function projectStartupRecord(value) {
  if (!isStartupRecord(value)) {
    return null;
  }
  const current = value.current || {};
  const shell = value.shell || {};
  const rawEvents = Array.isArray(value.events) ? value.events : [];
  const events = rawEvents.slice(-8).map(projectStartupEvent);
  return {
    producer: 'lswb-startup-v1',
    schemaVersion: 1,
    pid: value.pid,
    extensionVersion: safeExtensionVersion(value.extensionVersion),
    observedAt: safeTime(value.observedAt),
    origin: { component: startupComponent(current.stage), side: 'guest', location: 'local' },
    current: projectStartupCurrent(current),
    shell: projectStartupShell(shell),
    events,
  };
}
function directoryFailureStatus(code) {
  if (code === 'ENOENT') {
    return 'missing';
  }
  return ACCESS_DENIED_CODES.includes(code) ? 'denied' : 'unavailable';
}
function isRecentStartupRecord(record, now) {
  const age = now - Date.parse(record.observedAt);
  // Written as a negated rejection so a NaN age is kept, as before.
  const tooOld = age > MAX_STARTUP_RECORD_AGE_MS;
  const fromFuture = age < -MAX_STARTUP_CLOCK_SKEW_MS;
  return !(tooOld || fromFuture);
}
// Returns { record }, { issue } or {} (a valid but expired record).
function readStartupRecordFile(disk, directory, name, options) {
  try {
    const file = path.join(directory, name);
    const stat = disk.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_STARTUP_RECORD_BYTES) {
      return { issue: { code: 'invalid_startup_record' } };
    }
    const record = projectStartupRecord(JSON.parse(disk.readFileSync(file, 'utf8')));
    if (!record || String(record.pid) + '.json' !== name) {
      return { issue: { code: 'invalid_startup_record' } };
    }
    if (!isRecentStartupRecord(record, options.now ?? Date.now())) {
      return {};
    }
    return { record };
  } catch (e) {
    const code = ACCESS_DENIED_CODES.includes(e.code) ? 'startup_record_denied' : 'invalid_startup_record';
    return { issue: { code } };
  }
}
function readStartupDiagnostics(options = {}) {
  const disk = options.fsImpl || fs;
  const directory = options.directory || path.join(path.dirname(registry), 'startup-diagnostics');
  const records = [];
  const issues = [];
  let names;
  try {
    if (disk.lstatSync(directory).isSymbolicLink()) {
      return { status: 'unsafe_directory', records, issues };
    }
    names = disk.readdirSync(directory).filter(x => STARTUP_RECORD_NAME.test(x));
  } catch (e) {
    return { status: directoryFailureStatus(e.code), records, issues };
  }
  const limited = names.length > MAX_STARTUP_RECORDS;
  for (const name of names.slice(0, MAX_STARTUP_RECORDS)) {
    const outcome = readStartupRecordFile(disk, directory, name, options);
    if (outcome.issue) {
      issues.push(outcome.issue);
    }
    if (outcome.record) {
      records.push(outcome.record);
    }
  }
  return { status: 'read', records, issues, truncated: limited };
}
function transportError(message, sent) {
  const code = sent ? 'transport_outcome_unknown' : 'transport_unavailable';
  return Object.assign(new Error(message), { code, requestSent: sent });
}
function requestOnce(instance, body, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_REQUEST) {
      reject(Object.assign(new Error('Request exceeds 2 MiB.'), { code: 'request_limit' }));
      return;
    }
    const socket = net.createConnection(`\\\\.\\pipe\\${instance.pipeName}`);
    let buffer = '';
    let bytes = 0;
    let sent = false;
    let done = false;
    const finish = (err, result) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    };
    const onTimeout = () => {
      finish(transportError('IPC timeout. If requestSent=true, inspect state before retrying a mutation.', sent));
    };
    const timer = setTimeout(onTimeout, timeoutMs);
    socket.setEncoding('utf8');
    socket.once('connect', () => {
      sent = true;
      socket.write(serialized + '\n');
    });
    socket.on('data', data => {
      bytes += Buffer.byteLength(data, 'utf8');
      if (bytes > MAX_RESPONSE) {
        finish(transportError('IPC response exceeds 4 MiB; operation outcome may be unknown.', sent));
        return;
      }
      buffer += data;
      const end = buffer.indexOf('\n');
      if (end >= 0) {
        try {
          finish(null, JSON.parse(buffer.slice(0, end)));
        } catch {
          finish(transportError('Invalid IPC reply; operation outcome may be unknown.', sent));
        }
      }
    });
    socket.once('error', err => {
      finish(Object.assign(transportError(err.message, sent), { transportCode: err.code }));
    });
    socket.once('close', () => {
      if (!done) {
        finish(transportError('IPC closed without a reply.', sent));
      }
    });
  });
}
function canRetryUnsent(err, deadline) {
  if (err.requestSent !== false) {
    return false;
  }
  if (!RETRYABLE_UNSENT_CODES.includes(err.transportCode)) {
    return false;
  }
  return Date.now() < deadline;
}
async function request(instance, body, timeoutMs = 60000) {
  const deadline = Date.now() + Math.min(1500, timeoutMs);
  for (;;) {
    try {
      return await requestOnce(instance, body, timeoutMs);
    } catch (err) {
      // Retry only before connecting/sending. Never repeat a request with an uncertain outcome.
      if (!canRetryUnsent(err, deadline)) {
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, 75));
    }
  }
}
function registryFailure(location, err) {
  const status = directoryFailureStatus(err.code);
  const issues = err.code === 'ENOENT' ? [] : [{ stage: 'registry', code: err.code || 'registry_unavailable' }];
  return { registry: { path: location, status }, records: [], issues };
}
function isInstanceRecord(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return false;
  }
  if (!/^[0-9a-f-]+$/u.test(entry.id)) {
    return false;
  }
  return /^liveshare-local-\d+-[0-9a-f-]+$/u.test(entry.pipeName);
}
function inspectRecords(options = {}) {
  const location = options.registryPath || registry;
  const disk = options.fsImpl || fs;
  let names;
  try {
    names = disk.readdirSync(location);
  } catch (err) {
    return registryFailure(location, err);
  }
  const result = [];
  const issues = [];
  for (const name of names.filter(x => /^[0-9a-f-]+\.json$/u.test(x))) {
    try {
      const entry = JSON.parse(disk.readFileSync(path.join(location, name), 'utf8'));
      if (!isInstanceRecord(entry)) {
        throw Object.assign(new Error('Invalid instance record.'), { code: 'invalid_record' });
      }
      result.push(entry);
    } catch (err) {
      issues.push({ stage: 'record', record: name, code: err.code || 'invalid_record' });
    }
  }
  return { registry: { path: location, status: 'ready' }, records: result, issues };
}
function records() {
  const inspected = inspectRecords();
  if (['denied', 'unavailable'].includes(inspected.registry.status)) {
    const message = 'Cannot read the bridge instance registry. Run diagnose for details.';
    throw Object.assign(new Error(message), { code: 'discovery_access_failed', details: inspected });
  }
  return inspected.records;
}
// 'exited' only when the OS reports no such process. EPERM means a process
// exists under another account; anything else is not proof of exit.
function ownerProcessState(pid, kill = process.kill) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return 'unknown';
  try {
    kill(pid, 0);
    return 'alive';
  } catch (error) {
    if (error.code === 'ESRCH') return 'exited';
    if (error.code === 'EPERM') return 'alive';
    return 'unknown';
  }
}
// A missing pipe whose owning VS Code process has exited is a leftover record,
// not a failed window. It stays visible in probes for diagnosis.
function ownerExitedProbe(entry, err, processState) {
  if (err.transportCode !== 'ENOENT') return false;
  return processState(entry.pid) === 'exited';
}
async function probeEntry(entry, probe, options) {
  try {
    const response = await probe(entry, { op: 'info', instance: entry.id }, options.timeoutMs || 2000);
    return { entry, response };
  } catch (error) {
    return { entry, error };
  }
}
function failedProbeStatus(err) {
  if (ACCESS_DENIED_CODES.includes(err.transportCode || err.code)) {
    return 'denied';
  }
  return err.transportCode === 'ENOENT' ? 'stale' : 'unreachable';
}
function failedProbe(entry, err) {
  const probe = { id: entry.id, status: failedProbeStatus(err), code: err.code || 'probe_failed' };
  if (err.transportCode) {
    probe.transportCode = err.transportCode;
  }
  if (err.requestSent !== undefined) {
    probe.requestSent = err.requestSent;
  }
  return probe;
}
function isValidInfoResponse(entry, response) {
  if (!response.ok) {
    return false;
  }
  return response.result?.id === entry.id && Array.isArray(response.result?.roots);
}
// Records one probe outcome into found/probes, in registry order.
function recordProbeOutcome(outcome, found, probes, processState) {
  const { entry, response, error } = outcome;
  try {
    if (error) {
      throw error;
    }
    if (!isValidInfoResponse(entry, response)) {
      const code = response.error?.code || 'instance_identity_mismatch';
      probes.push({ id: entry.id, status: 'invalid_response', code });
      return;
    }
    found.push({ ...entry, epoch: response.result.epoch, roots: response.result.roots, info: response.result });
    probes.push({ id: entry.id, status: 'connected', rootCount: response.result.roots.length });
  } catch (err) {
    probes.push(failedProbe(entry, err));
    if (ownerExitedProbe(entry, err, processState)) {
      probes.at(-1).ownerProcess = 'exited';
    }
  }
}
function discoveryStatus(inspected, found, probes, staleRecordCount) {
  const deniedIssue = inspected.issues.some(x => ACCESS_DENIED_CODES.includes(x.code));
  const deniedProbe = probes.some(x => x.status === 'denied');
  const denied = inspected.registry.status === 'denied' || deniedIssue || deniedProbe;
  const hasRoots = found.some(x => x.roots.length);
  const liveRecordCount = inspected.records.length - staleRecordCount;
  const failedProbes = probes.filter(x => x.status !== 'connected' && x.ownerProcess !== 'exited');
  const failures = inspected.issues.length + failedProbes.length;
  if (hasRoots) {
    return failures ? 'partial' : 'ready';
  }
  if (denied) {
    return 'access_denied';
  }
  if (found.length) {
    return 'no_shared_workspace';
  }
  if (liveRecordCount) {
    return 'unavailable';
  }
  if (inspected.issues.length || inspected.registry.status === 'unavailable') {
    return 'invalid_registry';
  }
  return 'no_records';
}
function discoveryStartupDiagnostics(options, inspected) {
  if (options.fsImpl && !options.startupDirectory) {
    return { status: 'not_checked', records: [], issues: [] };
  }
  const defaultDirectory = path.join(path.dirname(inspected.registry.path), 'startup-diagnostics');
  return readStartupDiagnostics({
    directory: options.startupDirectory || defaultDirectory,
    fsImpl: options.startupFsImpl,
    now: options.now,
  });
}
// A connected window or a ready current state makes earlier startup events history.
function correlateStartupRecord(record, found) {
  const live = found.find(x => x.pid === record.pid);
  const historical = e => !!live || record.current.health === 'ready' || e.historical;
  return {
    ...record,
    probeCorrelation: live ? 'ipc_connected' : 'not_verified',
    currentFailureConfirmed: false,
    events: record.events.map(e => ({ ...e, historical: historical(e) })),
  };
}
async function discover(options = {}) {
  const processState = options.processState || ownerProcessState;
  const inspected = inspectRecords(options);
  const found = [];
  const probes = [];
  const probe = options.probe || request;
  // Probe independent windows in bounded batches; a stale record must not add
  // its full timeout serially for every window. Preserve registry result order.
  for (let offset = 0; offset < inspected.records.length; offset += DISCOVERY_BATCH_SIZE) {
    const entries = inspected.records.slice(offset, offset + DISCOVERY_BATCH_SIZE);
    const batch = await Promise.all(entries.map(entry => probeEntry(entry, probe, options)));
    for (const outcome of batch) {
      recordProbeOutcome(outcome, found, probes, processState);
    }
  }
  const staleRecordCount = probes.filter(x => x.ownerProcess === 'exited').length;
  const status = discoveryStatus(inspected, found, probes, staleRecordCount);
  const startupDiagnostics = discoveryStartupDiagnostics(options, inspected);
  startupDiagnostics.records = startupDiagnostics.records.map(record => correlateStartupRecord(record, found));
  return {
    readOnly: true,
    registry: inspected.registry,
    recordCount: inspected.records.length,
    staleRecordCount,
    status,
    instances: found,
    probes,
    issues: inspected.issues,
    startupDiagnostics,
  };
}
function diagnosticReport(report) {
  const summarize = ({ id, epoch, version, pid, roots, ipc }) => ({ id, epoch, version, pid, roots, ipc });
  return { ...report, instances: report.instances.map(summarize) };
}
const DISCOVERY_FAILED_MESSAGE = 'Bridge discovery failed; this is not a verified empty workspace list. Run diagnose. '
  + 'For EPERM/EACCES ask the user to review Configure IPC Access and the selected local account SIDs; '
  + 'never change permissions automatically.';
async function instances() {
  const report = await discover();
  if (['access_denied', 'unavailable', 'invalid_registry'].includes(report.status)) {
    const code = report.status === 'access_denied' ? 'discovery_access_denied' : 'discovery_unavailable';
    throw Object.assign(new Error(DISCOVERY_FAILED_MESSAGE), { code, details: diagnosticReport(report) });
  }
  return report.instances;
}
function exitCodeFailed(r, op) {
  if (r?.state !== 'completed' || r?.exitCode === undefined) {
    return false;
  }
  // Search tools use exit code 1 for a valid no-match result.
  if (['search', 'findFiles'].includes(op)) {
    return ![0, 1].includes(r.exitCode);
  }
  return r.exitCode !== 0;
}
function unsuccessful(response, op) {
  if (!response.ok) return true;
  const r = response.result;
  if (op === 'hostJobCancel') return !['cancelled', 'completed'].includes(r?.state);
  // A checkOnly dry run reports applied:false without failing.
  if (r?.applied === false && !(r?.checked && r?.checkOnly)) {
    return true;
  }
  if (r?.saved === false) {
    return true;
  }
  if (r?.dirty === true && r?.applied === true) {
    return true;
  }
  if (r?.files?.some(x => x.ok === false || x.saved === false)) {
    return true;
  }
  if (['timed_out', 'cancelled'].includes(r?.state)) {
    return true;
  }
  return exitCodeFailed(r, op);
}
function pinnedEpoch(body, options, instance) {
  const optionEpoch = options.epoch === undefined ? instance.epoch : Number(options.epoch);
  return body.epoch ?? optionEpoch;
}
async function selected(body, options) {
  const chosen = options.instance || body.instance;
  if (chosen && body.op !== 'info' && body.epoch === undefined && options.epoch === undefined) {
    throw new Error('Pin --epoch from instances along with --instance to avoid following a changed workspace.');
  }
  const candidates = chosen
    ? records().filter(x => x.id === chosen)
    : (await instances()).filter(x => x.roots.length);
  if (candidates.length !== 1) {
    throw new Error(`Expected one instance, found ${candidates.length}. Run instances and explicitly select the intended window.`);
  }
  const instance = candidates[0];
  const base = {
    instance: instance.id,
    epoch: pinnedEpoch(body, options, instance),
    workspace: body.workspace ?? options.workspace,
  };
  if (body.op !== 'info' && !base.workspace) {
    throw new Error('Set workspace to an exact root URI returned by instances.');
  }
  return { instance, base };
}
// Chunked upload over an already-bound call(body): begin, write x n, commit.
// Any failure triggers a best-effort transferAbort; commit is never retried.
// Used by the MCP adapter (lswb_upload_file).
function sourceChanged(initial, current, total) {
  return current.size !== initial.size || current.mtimeMs !== initial.mtimeMs || total !== initial.size;
}
async function writeChunks(call, transferId, handle, chunkBytes, onProgress) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(chunkBytes);
  let total = 0;
  let sequence = 0;
  for (;;) {
    const count = fs.readSync(handle, buffer, 0, buffer.length, null);
    if (!count) break;
    const chunk = buffer.subarray(0, count);
    hash.update(chunk);
    await call({ op: 'transferWrite', transferId, sequence, base64: chunk.toString('base64') });
    sequence += 1;
    total += count;
    onProgress(total);
  }
  return { total, sha256: hash.digest('hex') };
}
async function uploadTransfer(call, options) {
  const report = options.progress || (() => {});
  let transferId;
  let handle;
  try {
    handle = fs.openSync(options.input, 'r');
    const initial = fs.fstatSync(handle);
    if (!initial.isFile()) throw new Error('Upload input must be a file.');
    const begin = await call({
      op: 'transferBeginWrite',
      path: options.path,
      size: initial.size,
      overwrite: options.overwrite === true,
      expectedCurrentSha256: options.expectedCurrentSha256,
    });
    transferId = begin.transferId;
    const onProgress = bytes => report(bytes, initial.size);
    const { total, sha256 } = await writeChunks(call, transferId, handle, begin.chunkBytes, onProgress);
    if (sourceChanged(initial, fs.fstatSync(handle), total)) throw new Error('Local upload source changed during transfer.');
    const result = await call({ op: 'transferCommit', transferId, sha256 });
    transferId = null;
    if (result.sha256 !== sha256 || !result.written) throw new Error('Host upload acknowledgement failed integrity validation; inspect the target.');
    return { ...result, path: options.path, bytes: total };
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
    if (transferId) {
      try {
        await call({ op: 'transferAbort', transferId });
      } catch {}
    }
  }
}
const HELP_TEXT = [
  'Diagnostic CLI for Live Share Workspace Bridge.',
  'Agents should use the MCP server; see docs/MCP.md.',
  '',
  'instances                 List connected bridge windows and their shared roots.',
  'diagnose                  Read-only discovery diagnostics.',
  '[--instance ID --epoch N --workspace URI] [--request FILE]',
  '                          Send one raw JSON request (stdin when --request is omitted).',
  'Pin instance/epoch/workspace on raw requests.',
  '',
].join('\n');
const VALUE_OPTIONS = ['--instance', '--workspace', '--request', '--epoch'];

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}
async function runDiagnose() {
  const report = await discover();
  const ready = report.instances.some(x => x.roots.length);
  printJson({ ok: ready, result: diagnosticReport(report) });
  if (!ready) {
    process.exitCode = 1;
  }
}
function readRequestBody(options) {
  const source = options.request || 0;
  const raw = fs.readFileSync(source, 'utf8').replace(/^\uFEFF/u, '');
  if (Buffer.byteLength(raw, 'utf8') > MAX_REQUEST) {
    throw new Error('Request exceeds 2 MiB.');
  }
  const body = JSON.parse(raw);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Request must be an object.');
  }
  return body;
}
async function sendRawRequest(options) {
  const body = readRequestBody(options);
  const { instance, base } = await selected(body, options);
  const response = await request(instance, { ...body, ...base });
  printJson(response);
  if (unsuccessful(response, body.op)) {
    process.exitCode = 1;
  }
}
async function main() {
  const args = process.argv.slice(2);
  const options = {};
  if (args.length === 1 && args[0] === 'diagnose') {
    await runDiagnose();
    return;
  }
  while (args.length) {
    const key = args.shift();
    if (key === 'instances') {
      printJson(await instances());
      return;
    }
    if (key === '--help') {
      process.stdout.write(HELP_TEXT);
      return;
    }
    if (!VALUE_OPTIONS.includes(key) || !args.length) {
      throw new Error(`Unknown or incomplete option: ${key}`);
    }
    options[key.slice(2)] = args.shift();
  }
  await sendRawRequest(options);
}
function errorReply(err) {
  const error = { code: err.code || 'client_error', message: err.message };
  if (err.details !== undefined) {
    error.details = err.details;
  }
  if (err.transportCode) {
    error.transportCode = err.transportCode;
  }
  if (err.requestSent !== undefined) {
    error.requestSent = err.requestSent;
  }
  return { ok: false, error };
}
if (require.main === module) {
  main().catch(err => {
    process.stdout.write(JSON.stringify(errorReply(err), null, 2) + '\n');
    process.exitCode = 1;
  });
}
module.exports = {
  request,
  instances,
  records,
  inspectRecords,
  discover,
  ownerProcessState,
  diagnosticReport,
  unsuccessful,
  uploadTransfer,
  projectStartupRecord,
  readStartupDiagnostics,
};
