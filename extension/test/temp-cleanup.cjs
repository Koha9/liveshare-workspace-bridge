'use strict';
// Test-only removal of temporary directories. On Windows a child process that
// was just killed, or a scanner opening a new file, can keep a handle for a
// moment, so removal fails with EPERM/EBUSY after the assertions passed.
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXIT_TIMEOUT_MS = 5000;

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs) {
  return new Promise(resolve => {
    if (hasExited(child)) {
      resolve(true);
      return;
    }
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(hasExited(child));
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

// Waits for a child to exit; if it does not, kills it and waits once more.
async function settleChild(child, timeoutMs) {
  if (await waitForExit(child, timeoutMs)) return;
  child.kill();
  await waitForExit(child, timeoutMs);
}

// A node:child_process replacement for Module._load stubs that keeps every
// real export and records the children spawned through it.
function recordingChildProcess(children) {
  return {
    ...childProcess,
    spawn(...args) {
      const child = childProcess.spawn(...args);
      children.push(child);
      return child;
    },
  };
}

async function removeTempDirectory(directory, options) {
  assert.equal(path.dirname(directory), os.tmpdir());
  assert.ok(path.basename(directory).startsWith(options.prefix));
  const timeoutMs = options.timeoutMs || EXIT_TIMEOUT_MS;
  for (const child of options.children || []) await settleChild(child, timeoutMs);
  // fs.rmSync on Node 24 fails at once on EPERM despite maxRetries;
  // the promise version retries with linear backoff as documented.
  await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

module.exports = { removeTempDirectory, recordingChildProcess, waitForExit };
