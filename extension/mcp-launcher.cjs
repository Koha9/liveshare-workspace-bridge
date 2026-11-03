#!/usr/bin/env node
'use strict';

// Stable MCP launcher for Live Share Workspace Bridge.
// The extension copies this file to ~/.liveshare-local/mcp-server.cjs so agent
// MCP configurations never point into a versioned extension directory.
// It must stay self-contained: it runs outside the extension directory.
// stdout is the MCP protocol channel; this file never writes to it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const NOT_FOUND_MESSAGE =
  'No running Live Share Workspace Bridge instance was found. ' +
  'Open VS Code with the extension enabled, then retry.';

function registryDir() {
  if (process.env.LSWB_REGISTRY_DIR) {
    return process.env.LSWB_REGISTRY_DIR;
  }
  return path.join(os.homedir(), '.liveshare-local', 'instances');
}

function mtimeMs(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? stat.mtimeMs : null;
  } catch {
    return null;
  }
}

function readRecord(file) {
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { record, recordMtimeMs: mtimeMs(file) || 0 };
  } catch {
    return null;
  }
}

function readRecords(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const jsonNames = names.filter(name => name.endsWith('.json'));
  const entries = jsonNames.map(name => readRecord(path.join(dir, name)));
  return entries.filter(Boolean);
}

function isValidRecord(record) {
  if (!record || typeof record !== 'object') {
    return false;
  }
  const hasPath = typeof record.extensionPath === 'string';
  const hasPid = Number.isInteger(record.pid) && record.pid > 0;
  return hasPath && hasPid;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function toCandidate(entry) {
  if (!isValidRecord(entry.record) || !isAlive(entry.record.pid)) {
    return null;
  }
  const target = path.join(entry.record.extensionPath, 'mcp-server.cjs');
  const targetMtimeMs = mtimeMs(target);
  if (targetMtimeMs === null) {
    return null;
  }
  return { target, targetMtimeMs, recordMtimeMs: entry.recordMtimeMs };
}

// Newest mcp-server.cjs wins. build.py stamps every VSIX entry with a fixed
// 1980-01-01 timestamp, so different installed versions can share one mtime;
// ties fall back to the discovery record rewritten most recently on publish.
function compareCandidates(a, b) {
  if (b.targetMtimeMs !== a.targetMtimeMs) {
    return b.targetMtimeMs - a.targetMtimeMs;
  }
  return b.recordMtimeMs - a.recordMtimeMs;
}

function findTarget(dir) {
  const candidates = readRecords(dir).map(toCandidate).filter(Boolean);
  candidates.sort(compareCandidates);
  return candidates.length > 0 ? candidates[0].target : null;
}

function forwardSignals(child) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      try {
        child.kill(signal);
      } catch {
        // The child may already have exited.
      }
    });
  }
}

function run() {
  const target = findTarget(registryDir());
  if (!target) {
    process.stderr.write(NOT_FOUND_MESSAGE + '\n');
    process.exitCode = 1;
    return;
  }
  const args = [target, ...process.argv.slice(2)];
  const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true });
  forwardSignals(child);
  child.on('error', error => {
    process.stderr.write(`Failed to start the bridge MCP server: ${error.message}\n`);
    process.exit(1);
  });
  child.on('exit', code => {
    process.exit(typeof code === 'number' ? code : 1);
  });
}

if (require.main === module) {
  run();
}

module.exports = { findTarget, isAlive, isValidRecord, registryDir };
