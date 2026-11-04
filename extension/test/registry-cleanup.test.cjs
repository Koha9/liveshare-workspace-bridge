'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { cleanupStaleRecords } = require('../registry-cleanup.cjs');

function temporaryRegistry(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lswb-registry-cleanup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registry = path.join(root, 'instances');
  fs.mkdirSync(registry);
  return { root, registry };
}

function record(pid, id = crypto.randomUUID()) {
  return { id, epoch: 1, version: '0.3.0-pre', pipeName: `liveshare-local-${pid}-${id}`, pid, roots: [] };
}

function write(directory, name, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  fs.writeFileSync(path.join(directory, name), text);
}

function exitedPid() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', ''], { windowsHide: true });
    child.on('error', reject);
    child.on('exit', () => resolve(child.pid));
  });
}

function runningChild(t) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true });
  t.after(() => child.kill());
  return child.pid;
}

test('removes only records whose owner process has exited', async t => {
  const { registry } = temporaryRegistry(t);
  const dead = record(await exitedPid());
  const own = record(process.pid);
  const live = record(runningChild(t));
  write(registry, `${dead.id}.json`, dead);
  write(registry, `${own.id}.json`, own);
  write(registry, `${live.id}.json`, live);
  const result = cleanupStaleRecords({ registryPath: registry });
  assert.deepEqual(result.removed, [dead.id]);
  assert.deepEqual(result.issues, []);
  assert.equal(fs.existsSync(path.join(registry, `${dead.id}.json`)), false);
  assert.equal(fs.existsSync(path.join(registry, `${own.id}.json`)), true);
  assert.equal(fs.existsSync(path.join(registry, `${live.id}.json`)), true);
});

test('keeps files that do not match the record format exactly', async t => {
  const { registry } = temporaryRegistry(t);
  const pid = await exitedPid();
  const named = record(pid);
  const mismatchedId = record(pid);
  const wrongPipe = { ...record(pid), pipeName: `liveshare-local-${pid + 1}-x` };
  const noPid = record(pid);
  delete noPid.pid;
  const names = {
    [`${named.id}.json.tmp`]: named,
    [`${crypto.randomUUID()}.json`]: mismatchedId,
    [`${wrongPipe.id}.json`]: wrongPipe,
    [`${noPid.id}.json`]: noPid,
    [`${crypto.randomUUID()}.json`]: 'not json',
    'notes.json': record(pid, 'notes'),
    'README.txt': 'keep',
  };
  for (const [name, value] of Object.entries(names)) write(registry, name, value);
  fs.mkdirSync(path.join(registry, `${crypto.randomUUID()}.json`));
  const before = fs.readdirSync(registry).sort();
  const result = cleanupStaleRecords({ registryPath: registry, processState: () => 'exited' });
  assert.deepEqual(result.removed, []);
  assert.deepEqual(fs.readdirSync(registry).sort(), before);
});

test('keeps records when the owner state is alive, unknown or throws', t => {
  const { registry } = temporaryRegistry(t);
  const entries = [record(1001), record(1002), record(1003)];
  for (const entry of entries) write(registry, `${entry.id}.json`, entry);
  const states = { 1001: () => 'alive', 1002: () => 'unknown', 1003: () => { throw new Error('probe'); } };
  const result = cleanupStaleRecords({ registryPath: registry, processState: pid => states[pid]() });
  assert.deepEqual(result.removed, []);
  assert.equal(fs.readdirSync(registry).length, 3);
  assert.deepEqual(result.issues.map(x => x.code), ['owner_check_failed']);
});

test('a failed delete is reported, not thrown', t => {
  const { registry } = temporaryRegistry(t);
  const entry = record(2001);
  write(registry, `${entry.id}.json`, entry);
  const busy = { ...fs, unlinkSync: () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } };
  const result = cleanupStaleRecords({ registryPath: registry, fsImpl: busy, processState: () => 'exited' });
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.issues, [{ record: `${entry.id}.json`, code: 'EBUSY' }]);
});

test('a record already removed by another window counts as done', t => {
  const { registry } = temporaryRegistry(t);
  const entry = record(2002);
  write(registry, `${entry.id}.json`, entry);
  const raced = { ...fs, unlinkSync: target => { fs.unlinkSync(target); throw Object.assign(new Error('gone'), { code: 'ENOENT' }); } };
  const result = cleanupStaleRecords({ registryPath: registry, fsImpl: raced, processState: () => 'exited' });
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.issues, []);
});

test('missing registry is a no-op', t => {
  const { root } = temporaryRegistry(t);
  const result = cleanupStaleRecords({ registryPath: path.join(root, 'absent'), processState: () => 'exited' });
  assert.deepEqual(result, { removed: [], kept: 0, issues: [] });
});

test('symbolic links are never followed or removed', t => {
  const { root, registry } = temporaryRegistry(t);
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  const entry = record(3001);
  write(outside, `${entry.id}.json`, entry);
  try {
    fs.symlinkSync(path.join(outside, `${entry.id}.json`), path.join(registry, `${entry.id}.json`), 'file');
  } catch (error) {
    t.skip(`file symlinks unavailable: ${error.code}`);
    return;
  }
  const result = cleanupStaleRecords({ registryPath: registry, processState: () => 'exited' });
  assert.deepEqual(result.removed, []);
  assert.equal(fs.lstatSync(path.join(registry, `${entry.id}.json`)).isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(outside, `${entry.id}.json`)), true);
});

test('a linked registry directory is refused as a whole', t => {
  const { root } = temporaryRegistry(t);
  const target = path.join(root, 'elsewhere');
  fs.mkdirSync(target);
  const entry = record(3002);
  write(target, `${entry.id}.json`, entry);
  const linked = path.join(root, 'linked');
  fs.symlinkSync(target, linked, 'junction');
  const result = cleanupStaleRecords({ registryPath: linked, processState: () => 'exited' });
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.issues, [{ record: null, code: 'unsafe_registry' }]);
  assert.equal(fs.existsSync(path.join(target, `${entry.id}.json`)), true);
});
