'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const { classifyStartupStderr } = require('./startup-diagnostics.cjs');
const { readSetting } = require('./permissions.cjs');

const MODES = ['ownerOnly', 'selectedUsers'];
// Removed in 0.3.0. An existing User value runs as the narrower ownerOnly;
// it is reported, never rewritten, and never passed to the native helper.
const REMOVED_MODE = 'allLocalUsers';
const REMOVED_MODE_NOTICE = "IPC Access Mode 'allLocalUsers' was removed in 0.3.0; the bridge now runs as ownerOnly. Agents connect through the MCP server under your own account. Use Configure IPC Access if you need selectedUsers.";
const CONFIGURE_ACTION = 'Configure IPC Access';
const ACCESS_KEYS = ['ipc.accessMode', 'ipc.selectedUserSids', 'ipc.allowCodexSandboxClients'];
const LEGACY_ACCOUNT_NAMES = ['codexsandboxoffline', 'codexsandboxonline'];
const ENUMERATION_TIMEOUT_MS = 10000;
const MAX_CATALOG_CHARACTERS = 1024 * 1024;
const MAX_STDERR_CHARACTERS = 8192;
const APPLY_ACTION = 'Apply Access Mode';

// Trust is a User setting. Do not accept workspace values or contributed defaults.
function userValue(config, key, fallback) {
  if (config.inspect) {
    const detail = config.inspect(key);
    return detail?.globalValue === undefined ? fallback : detail.globalValue;
  }
  const value = config.get(key, fallback);
  return value === undefined ? fallback : value;
}

function explicit(config, key) {
  if (config.inspect) return config.inspect(key)?.globalValue !== undefined;
  return config.get(key) !== undefined;
}

function isValidSidList(value) {
  if (!Array.isArray(value)) return false;
  if (value.length > 256) return false;
  return !value.some(x => typeof x !== 'string' || x.length > 184);
}

function selectedSids(config) {
  const value = userValue(config, 'ipc.selectedUserSids', []);
  if (!isValidSidList(value)) throw new Error('Selected users must be an array of at most 256 SID strings.');
  return [...new Set(value)];
}

function removedModeAccess() {
  return {
    mode: 'ownerOnly',
    selectedUserSids: [],
    legacyMigrationRequired: false,
    requestedMode: REMOVED_MODE,
    deprecatedModeIgnored: true,
  };
}

function readAccess(config) {
  const mode = userValue(config, 'ipc.accessMode', 'ownerOnly');
  if (mode === REMOVED_MODE) return removedModeAccess();
  if (!MODES.includes(mode)) throw new Error('Unknown IPC access mode; select ownerOnly or selectedUsers.');
  const legacy = !explicit(config, 'ipc.accessMode') && userValue(config, 'ipc.allowCodexSandboxClients', false) === true;
  return {
    mode,
    selectedUserSids: mode === 'selectedUsers' ? selectedSids(config) : [],
    legacyMigrationRequired: legacy,
  };
}

// Logs on every start that ignores the removed mode; prompts once per session.
// Never writes settings: the user decides whether to change the stored value.
async function noticeRemovedMode(vscode, access, session, log) {
  if (access.deprecatedModeIgnored !== true) return;
  log(`IPC Access Mode '${access.requestedMode}' is no longer supported; running as ownerOnly. User settings were not changed.`);
  if (session.removedModeNoticeShown) return;
  session.removedModeNoticeShown = true;
  const action = await vscode.window.showInformationMessage(REMOVED_MODE_NOTICE, CONFIGURE_ACTION);
  if (action === CONFIGURE_ACTION) await vscode.commands.executeCommand('liveshareWorkspaceBridge.configureAccess');
}

function enumerationArgs() {
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'pipe-host.ps1'), '-ListLocalUsers'];
}

function enumerationFailure(stderr) {
  const error = new Error('Cannot enumerate machine-local users; inspect local startup diagnostics.');
  error.code = classifyStartupStderr(stderr);
  error.stage = 'account_enumeration';
  return error;
}

function parseCatalog(stdout) {
  const accounts = JSON.parse(stdout);
  if (!Array.isArray(accounts)) throw new Error('Invalid local account catalog.');
  return accounts;
}

function listLocalUsers(powershell, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(powershell, enumerationArgs(), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let done = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    // Settles once; every rejection is tagged with the enumeration stage.
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) {
        error.stage = 'account_enumeration';
        reject(error);
      } else {
        resolve(result);
      }
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Local account enumeration timed out. No access setting was changed.'));
    }, ENUMERATION_TIMEOUT_MS);
    child.on('error', e => finish(e));
    child.stdout.on('data', x => {
      stdout += x;
      if (stdout.length > MAX_CATALOG_CHARACTERS) {
        child.kill();
        finish(new Error('Local account catalog exceeds its limit.'));
      }
    });
    child.stderr.on('data', x => {
      if (stderr.length < MAX_STDERR_CHARACTERS) stderr += x;
    });
    child.on('close', code => {
      if (code !== 0) {
        finish(enumerationFailure(stderr));
        return;
      }
      try {
        finish(null, parseCatalog(stdout));
      } catch (e) {
        finish(e);
      }
    });
  });
}

function legacyAccountSids(users) {
  const legacy = users.filter(x => LEGACY_ACCOUNT_NAMES.includes(x.Name.split('\\').at(-1).toLowerCase()));
  return legacy.map(x => x.Sid);
}

function sameSids(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sidsChangedError() {
  return new Error('Selected SIDs changed during migration; no mode was overwritten.');
}

// Resolves the legacy accounts once and caches their SIDs, so a later rename
// or recreation is never re-resolved by name.
async function legacySidSnapshot(state, listUsers) {
  let sids = state.get('ipc.legacySidSnapshot');
  if (sids === undefined) {
    const users = await listUsers();
    sids = legacyAccountSids(users);
    await state.update('ipc.legacySidSnapshot', sids);
  }
  if (!Array.isArray(sids) || sids.some(x => typeof x !== 'string')) throw new Error('Invalid saved legacy SID snapshot; select users manually.');
  return sids;
}

async function prepareAccess(config, state, listUsers, target) {
  const read = readAccess(config);
  if (!read.legacyMigrationRequired) return read;
  // A partially edited new policy is ambiguous: never replace it with guessed trust.
  if (explicit(config, 'ipc.selectedUserSids') && !state.get('ipc.legacySidSnapshot')) {
    throw new Error('Legacy IPC trust and a new SID list coexist without a mode. Select the intended access mode manually.');
  }
  const sids = await legacySidSnapshot(state, listUsers);
  // Recheck after asynchronous reads so a manual mode change wins.
  if (!readAccess(config).legacyMigrationRequired) return readAccess(config);
  const existing = userValue(config, 'ipc.selectedUserSids', []);
  if (explicit(config, 'ipc.selectedUserSids') && !sameSids(existing, sids)) throw sidsChangedError();
  await config.update('ipc.selectedUserSids', sids, target);
  if (!readAccess(config).legacyMigrationRequired) return readAccess(config);
  if (!sameSids(userValue(config, 'ipc.selectedUserSids', []), sids)) throw sidsChangedError();
  await config.update('ipc.accessMode', 'selectedUsers', target);
  return { mode: 'selectedUsers', selectedUserSids: sids, legacyMigrationRequired: false, migratedLegacy: true };
}

function accountItem(user, chosen) {
  return {
    label: user.Name,
    description: user.Disabled ? 'Disabled local account' : 'Local account',
    detail: user.Sid,
    sid: user.Sid,
    picked: chosen.has(user.Sid),
  };
}

function unavailableItem(sid) {
  return {
    label: 'Unavailable selected account',
    description: 'Deleted, foreign or invalid SID; not granted',
    detail: sid,
    sid,
    picked: true,
  };
}

function pickerItems(users, selected) {
  const chosen = new Set(selected);
  const items = users.map(x => accountItem(x, chosen));
  for (const sid of selected) {
    if (!users.some(x => x.Sid === sid)) items.push(unavailableItem(sid));
  }
  return items;
}

function modeItems() {
  return [
    { label: 'Owner only (default)', description: 'Only the Windows user running this bridge', mode: 'ownerOnly' },
    { label: 'Selected machine-local accounts', description: 'Choose local users; stable SIDs survive account renames', mode: 'selectedUsers' },
  ];
}

// Returns the chosen SIDs, or undefined when the account picker is cancelled.
async function pickAccounts(vscode, config, listUsers) {
  const users = await listUsers();
  const picked = await vscode.window.showQuickPick(pickerItems(users, selectedSids(config)), {
    title: 'Select Local Accounts',
    canPickMany: true,
    placeHolder: 'Saved by SID. Deleted/recreated accounts are not substituted by name.',
  });
  if (picked === undefined) return undefined;
  return picked.map(x => x.sid);
}

function hostScopeNote(config) {
  if (readSetting(config, 'host.enabled', false) === true) {
    return 'Host terminal access is enabled; allowed processes may also run Host commands if other requirements are met.';
  }
  return 'Host terminal access remains independently controlled.';
}

async function confirmSelectedTrust(vscode, config) {
  const question = 'Trust the selected local accounts in this Windows session? Their processes can use bridge permissions outside Codex filesystem sandbox limits. ' + hostScopeNote(config);
  const confirmed = await vscode.window.showWarningMessage(question, { modal: true }, APPLY_ACTION);
  return confirmed === APPLY_ACTION;
}

async function configureAccess(vscode, listUsers) {
  const config = vscode.workspace.getConfiguration('liveshareWorkspaceBridge');
  const choice = await vscode.window.showQuickPick(modeItems(), {
    title: 'Live Share Workspace Bridge: IPC Access Mode',
    placeHolder: 'Trust applies to all processes of allowed accounts, not only Codex.',
  });
  if (!choice) return false;
  let sids;
  if (choice.mode === 'selectedUsers') {
    sids = await pickAccounts(vscode, config, listUsers);
    if (sids === undefined) return false;
  }
  if (choice.mode !== 'ownerOnly') {
    if (!(await confirmSelectedTrust(vscode, config))) return false;
  }
  if (sids !== undefined) await config.update('ipc.selectedUserSids', sids, vscode.ConfigurationTarget.Global);
  await config.update('ipc.accessMode', choice.mode, vscode.ConfigurationTarget.Global);
  return true;
}

module.exports = { MODES, ACCESS_KEYS, readAccess, prepareAccess, listLocalUsers, pickerItems, configureAccess, noticeRemovedMode };
