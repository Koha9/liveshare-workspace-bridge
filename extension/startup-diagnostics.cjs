'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const { projectStartupRecord } = require('./cli.cjs');

const POLICY_BLOCK = 'execution_policy_related_startup_block';
const PEER_SNAPSHOT_NAME = /^[1-9]\d{0,9}\.json$/u;
const MAX_RETAINED_PEERS = 15;
const PEER_MAX_AGE_MS = 86400000;
const PEER_MAX_BYTES = 16384;
const EVENT_MERGE_WINDOW_MS = 30000;
const MAX_EVENT_COUNT = 1000;
const MAX_EVENTS = 8;
const STDERR_TAIL_CHARS = 8192;

function classifyStartupStderr(text) {
  const mentionsPolicy = /about_Execution_Policies/iu.test(text);
  const accessDenied = /UnauthorizedAccess|PSSecurityException/iu.test(text);
  if (mentionsPolicy && accessDenied) {
    return POLICY_BLOCK;
  }
  return 'helper_stderr_observed';
}

function listPeerSnapshots(directory) {
  const peers = fs.readdirSync(directory)
    .filter(name => PEER_SNAPSHOT_NAME.test(name))
    .map(name => ({ name, stat: fs.lstatSync(path.join(directory, name)) }))
    .filter(peer => peer.stat.isFile() && !peer.stat.isSymbolicLink());
  return peers.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
}

function isPrunablePeer(peer, index, ownName, now) {
  if (peer.name === ownName) {
    return false;
  }
  const stale = index >= MAX_RETAINED_PEERS || now() - peer.stat.mtimeMs > PEER_MAX_AGE_MS;
  return stale && peer.stat.size <= PEER_MAX_BYTES;
}

// Only files that still parse as startup records are removed; anything else is left alone.
function pruneOwnedPeer(directory, name) {
  const file = path.join(directory, name);
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (projectStartupRecord(value)) {
      fs.unlinkSync(file);
    }
  } catch {}
}

function prunePeerSnapshots(directory, ownName, now) {
  const peers = listPeerSnapshots(directory);
  for (const [index, peer] of peers.entries()) {
    if (isPrunablePeer(peer, index, ownName, now)) {
      pruneOwnedPeer(directory, peer.name);
    }
  }
}

function markHistorical(events) {
  for (const e of events) {
    e.historical = true;
  }
}

function requestedExecutableName(executable) {
  const name = String(executable).split(/[\\/]/u).at(-1).toLowerCase();
  return ['powershell.exe', 'pwsh.exe'].includes(name) ? name : 'other';
}

function eventLogMessage(code, stage, requested, current) {
  const policyHint = code === POLICY_BLOCK
    ? 'Review effective policy and script trust for this helper identity, not a separate sandbox probe. '
    : '';
  return 'Guest local helper: ' + code + ' (' + stage + '), requested executable ' + requested
    + ', attempt ' + current.attemptId + ', epoch ' + current.epoch + '. '
    + policyHint
    + 'Actual identity/policy scope may be unknown; no automatic shell or policy change.';
}

function createStartupJournal({ directory, pid, version, log = () => {}, now = Date.now }) {
  let disposed = false;
  let writeWarning = false;
  const ownName = pid + '.json';
  const filename = path.join(directory, ownName);
  let record = {
    producer: 'lswb-startup-v1',
    schemaVersion: 1,
    pid,
    extensionVersion: version,
    observedAt: new Date(now()).toISOString(),
    current: { health: 'stopped', stage: 'unknown', attemptId: null, epoch: null },
    shell: {},
    events: [],
  };
  const snapshot = () => projectStartupRecord(record);

  function writeSnapshotAtomically(temporary, state) {
    fs.mkdirSync(directory, { recursive: true });
    if (fs.lstatSync(directory).isSymbolicLink()) {
      throw new Error('unsafe_directory');
    }
    prunePeerSnapshots(directory, ownName, now);
    state.handle = fs.openSync(temporary, 'wx');
    state.created = true;
    fs.writeFileSync(state.handle, JSON.stringify(snapshot()));
    fs.closeSync(state.handle);
    state.handle = null;
    fs.renameSync(temporary, filename);
  }

  function warnOnce() {
    if (writeWarning) {
      return;
    }
    writeWarning = true;
    log('Startup diagnostics could not be persisted under existing permissions; no access rights were changed.');
  }

  function persist() {
    if (disposed) {
      return;
    }
    record.observedAt = new Date(now()).toISOString();
    const temporary = filename + '.' + crypto.randomUUID() + '.tmp';
    const state = { handle: null, created: false };
    try {
      writeSnapshotAtomically(temporary, state);
    } catch {
      warnOnce();
    } finally {
      if (state.handle !== null) {
        try {
          fs.closeSync(state.handle);
        } catch {}
      }
      // After a successful rename the temporary name no longer exists; unlink then fails harmlessly.
      if (state.created) {
        try {
          fs.unlinkSync(temporary);
        } catch {}
      }
    }
  }

  function findRecentEvent(code, stage, requested) {
    return record.events.find(e => e.code === code
      && e.stage === stage
      && e.requestedExecutableName === requested
      && now() - Date.parse(e.lastSeen) < EVENT_MERGE_WINDOW_MS);
  }

  function refreshEvent(old, stamp, encodingReplacementObserved) {
    old.count = Math.min(MAX_EVENT_COUNT, old.count + 1);
    old.lastSeen = stamp;
    old.attemptId = record.current.attemptId;
    old.historical = false;
    old.encodingReplacementObserved ||= encodingReplacementObserved;
  }

  function addEvent(code, stage, requested, stamp, encodingReplacementObserved) {
    record.events.push({
      code,
      stage,
      requestedExecutableName: requested,
      confidence: code === POLICY_BLOCK ? 'high' : 'unknown',
      firstSeen: stamp,
      lastSeen: stamp,
      count: 1,
      historical: false,
      encodingReplacementObserved,
      attemptId: record.current.attemptId,
      firstAttemptId: record.current.attemptId,
    });
    record.events = record.events.slice(-MAX_EVENTS);
    const projectedRequested = snapshot().shell.requestedExecutableName;
    log(eventLogMessage(code, stage, projectedRequested, record.current));
  }

  function event(code, stage, encodingReplacementObserved = false) {
    if (disposed) {
      return;
    }
    const stamp = new Date(now()).toISOString();
    const requested = snapshot().shell.requestedExecutableName;
    const old = findRecentEvent(code, stage, requested);
    if (old) {
      refreshEvent(old, stamp, encodingReplacementObserved);
    } else {
      addEvent(code, stage, requested, stamp, encodingReplacementObserved);
    }
    persist();
  }

  function hasCurrentEvent(codes) {
    return record.events.some(e => !e.historical && codes.includes(e.code));
  }

  return {
    snapshot,
    begin(attemptId, epoch, executable) {
      if (disposed) {
        return;
      }
      markHistorical(record.events);
      const requested = requestedExecutableName(executable);
      record.current = { health: 'starting', stage: 'access_setup', attemptId, epoch };
      record.shell = { requestedExecutableName: requested, metadataSource: 'requested_only' };
      persist();
    },
    stage(stage) {
      if (disposed) {
        return;
      }
      record.current.stage = stage;
      persist();
    },
    stderr(text, encodingIssue) {
      const code = classifyStartupStderr(text);
      event(code, 'helper_startup', encodingIssue);
    },
    spawnError(code) {
      record.current.health = 'failed';
      const eventCode = code === 'ENOENT' ? 'shell_executable_not_found' : 'helper_start_failed';
      event(eventCode, 'process_start');
    },
    setupError(error) {
      record.current.health = 'failed';
      const enumerating = error?.stage === 'account_enumeration';
      record.current.stage = enumerating ? 'account_enumeration' : 'access_setup';
      const eventCode = error?.code === POLICY_BLOCK ? error.code : 'ipc_access_setup_failed';
      event(eventCode, record.current.stage);
    },
    exited() {
      if (disposed) {
        return;
      }
      const wasReady = record.current.health === 'ready';
      record.current.health = 'failed';
      record.current.stage = wasReady ? 'ipc_runtime' : 'helper_startup';
      const explained = hasCurrentEvent([POLICY_BLOCK])
        || hasCurrentEvent(['helper_start_failed', 'shell_executable_not_found']);
      if (!explained) {
        event(wasReady ? 'ipc_helper_exited' : 'helper_startup_failed', record.current.stage);
      } else {
        persist();
      }
    },
    ready(shell) {
      if (disposed) {
        return;
      }
      record.current.health = 'ready';
      record.current.stage = 'ipc_runtime';
      record.shell = { ...record.shell, ...shell, metadataSource: 'helper_ready' };
      markHistorical(record.events);
      persist();
      log('Guest local IPC ready: attempt ' + record.current.attemptId
        + ', epoch ' + record.current.epoch + '. Previous startup errors are historical.');
    },
    stop() {
      if (disposed) {
        return;
      }
      record.current.health = 'stopped';
      markHistorical(record.events);
      persist();
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      try {
        fs.unlinkSync(filename);
      } catch {}
    },
  };
}

function captureStartupStderr(journal) {
  const decoder = new StringDecoder('utf8');
  let tail = '';
  let reported = false;
  let ended = false;

  function decodeChunk(value) {
    return Buffer.isBuffer(value) ? decoder.write(value) : String(value);
  }

  return {
    write(value) {
      if (ended) {
        return;
      }
      tail = (tail + decodeChunk(value)).slice(-STDERR_TAIL_CHARS);
      if (!reported && classifyStartupStderr(tail) === POLICY_BLOCK) {
        reported = true;
        journal.stderr(tail, tail.includes('�'));
      }
    },
    end() {
      if (ended) {
        return;
      }
      ended = true;
      tail = (tail + decoder.end()).slice(-STDERR_TAIL_CHARS);
      if (tail && !reported) {
        journal.stderr(tail, tail.includes('�'));
      }
      tail = '';
    },
  };
}

module.exports = { classifyStartupStderr, createStartupJournal, captureStartupStderr };
