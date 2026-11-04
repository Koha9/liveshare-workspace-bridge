'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { removeTempDirectory, recordingChildProcess, waitForExit } = require('./temp-cleanup.cjs');

function longRunningChild(cwd) {
  return childProcess.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd, windowsHide: true });
}

test('refuses directories outside the temp root or without the expected prefix', async () => {
  await assert.rejects(removeTempDirectory(path.join(os.homedir(), 'lswb-x'), { prefix: 'lswb-' }));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'other-prefix-'));
  try {
    await assert.rejects(removeTempDirectory(other, { prefix: 'lswb-cleanup-' }));
    assert.equal(fs.existsSync(other), true);
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
  }
});

test('kills a child that is still running inside the directory, then removes it', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lswb-cleanup-'));
  const child = longRunningChild(directory);
  await new Promise(resolve => child.once('spawn', resolve));
  await removeTempDirectory(directory, { prefix: 'lswb-cleanup-', children: [child], timeoutMs: 200 });
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  assert.equal(fs.existsSync(directory), false);
});

test('recording child_process keeps real exports and records spawned children', async () => {
  const children = [];
  const recorded = recordingChildProcess(children);
  for (const key of Object.keys(childProcess)) assert.equal(typeof recorded[key], typeof childProcess[key], key);
  const child = recorded.spawn(process.execPath, ['-e', ''], { windowsHide: true });
  assert.deepEqual(children, [child]);
  assert.equal(await waitForExit(child, 5000), true);
});

test('retries while an unrecorded process briefly keeps the directory busy', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lswb-cleanup-'));
  const holder = childProcess.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { cwd: directory, windowsHide: true });
  await new Promise(resolve => holder.once('spawn', resolve));
  await removeTempDirectory(directory, { prefix: 'lswb-cleanup-' });
  assert.equal(fs.existsSync(directory), false);
});
