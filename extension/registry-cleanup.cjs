'use strict';
// Removes discovery records left behind when a VS Code window was reloaded or
// crashed before dispose could unregister it. Only the extension calls this;
// CLI and MCP discovery stay read-only.
const fs = require('node:fs');
const path = require('node:path');
const { ownerProcessState } = require('./cli.cjs');

const RECORD_NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/u;
const MAX_ENTRIES = 256;
const MAX_RECORD_BYTES = 64 * 1024;

// Returns the parsed record only when the file is a plain, small file whose
// name, id, pid and pipe name all agree. Anything else is left untouched.
function readOwnedRecord(disk, file, id) {
  const stat = disk.lstatSync(file);
  if (!stat.isFile() || stat.size > MAX_RECORD_BYTES) return null;
  let entry;
  try {
    entry = JSON.parse(disk.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  if (entry.id !== id) return null;
  if (!Number.isSafeInteger(entry.pid) || entry.pid <= 0) return null;
  if (entry.pipeName !== `liveshare-local-${entry.pid}-${id}`) return null;
  return entry;
}

function registryEntries(disk, registryPath, issues) {
  try {
    if (disk.lstatSync(registryPath).isSymbolicLink()) {
      issues.push({ record: null, code: 'unsafe_registry' });
      return [];
    }
    return disk.readdirSync(registryPath).slice(0, MAX_ENTRIES);
  } catch (error) {
    if (error.code !== 'ENOENT') issues.push({ record: null, code: error.code || 'registry_unavailable' });
    return [];
  }
}

function ownerExited(processState, entry, name, issues) {
  try {
    return processState(entry.pid) === 'exited';
  } catch {
    issues.push({ record: name, code: 'owner_check_failed' });
    return false;
  }
}

function removeRecord(disk, file, name, issues) {
  try {
    disk.unlinkSync(file);
    return true;
  } catch (error) {
    // Another window may have removed the same leftover first.
    if (error.code !== 'ENOENT') issues.push({ record: name, code: error.code || 'unlink_failed' });
    return false;
  }
}

function cleanupStaleRecords(options) {
  const disk = options.fsImpl || fs;
  const processState = options.processState || ownerProcessState;
  const ownPid = options.ownPid || process.pid;
  const result = { removed: [], kept: 0, issues: [] };
  for (const name of registryEntries(disk, options.registryPath, result.issues)) {
    const match = RECORD_NAME.exec(name);
    if (!match) continue;
    const file = path.join(options.registryPath, name);
    let entry;
    try {
      entry = readOwnedRecord(disk, file, match[1]);
    } catch (error) {
      result.issues.push({ record: name, code: error.code || 'record_unreadable' });
      continue;
    }
    if (!entry) continue;
    if (entry.pid === ownPid || !ownerExited(processState, entry, name, result.issues)) {
      result.kept++;
      continue;
    }
    if (removeRecord(disk, file, name, result.issues)) result.removed.push(entry.id);
  }
  return result;
}

module.exports = { cleanupStaleRecords };
