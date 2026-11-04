'use strict';
const { fail } = require('./core.cjs');
const NAMESPACE = 'liveshareWorkspaceBridge';
const DEFINITIONS = {
  list: ['List directories', 'Allow the agent to list shared directories.'],
  read: ['Read text', 'Allow buffered text reads, batch reads and explicit provider verification.'],
  create: ['Create text files', 'Allow creation of new shared text files.'],
  write: ['Replace whole documents', 'Allow guarded full-document text replacement.'],
  edit: ['Edit text', 'Allow text replacements and multi-file text edits.'],
  save: ['Save documents', 'Allow target-document saves, including saves performed by editing operations.'],
  mkdir: ['Create directories', 'Allow shared directory creation, including missing parent directories.'],
  copy: ['Copy files', 'Allow byte-preserving file copies on the Host.'],
  copyDirectory: ['Copy directories', 'Allow directory copies on the Host.'],
  move: ['Move and rename paths', 'Allow moving or renaming shared files and directories.'],
  delete: ['Delete files and empty directories', 'Allow deletion of individual files and empty directories. Recursive deletion is not provided.'],
  stat: ['Read metadata', 'Allow provider metadata and explicitly requested Host metadata.'],
  diagnostics: ['Read diagnostics', 'Allow reading language diagnostics for shared documents.'],
  symbols: ['Read document symbols', 'Allow document outline queries.'],
  workspaceSymbols: ['Read workspace symbols', 'Allow language-aware workspace symbol queries.'],
  definition: ['Find definitions', 'Allow language-aware definition queries.'],
  references: ['Find references', 'Allow language-aware reference queries.'],
  renameSymbol: ['Rename symbols', 'Allow previewing and applying language-service symbol renames.'],
  format: ['Format documents', 'Allow language-service document formatting.'],
  search: ['Search content', 'Allow Host content search and explicitly selected editor snapshots.'],
  findFiles: ['Find paths', 'Allow Host path discovery and explicitly selected provider snapshots.'],
  applyPatch: ['Apply text patches', 'Allow checked Host Git text patches inside the bound workspace.'],
  readBytes: ['Read bytes', 'Allow byte-preserving Host reads and raw-byte hashes.'],
  writeBytes: ['Write bytes', 'Allow byte-preserving Host writes with explicit overwrite rules.'],
  largeTransfers: ['Upload large files', 'Allow chunked Host file uploads. Write Bytes permission also applies. Large downloads are not available because they have not been validated.'],
  hostExec: ['Run Host commands', 'Allow arbitrary commands in a bounded Host child process. Requires all other operation permissions because raw commands cannot enforce per-operation restrictions.']
};
// Operations that share the permission of a base operation.
const ALIASES = {
  readMany: 'read',
  providerRead: 'read',
  searchSnapshot: 'search',
  searchResults: 'search',
  findFilesSnapshot: 'findFiles',
  hostStat: 'stat',
  hostJobPoll: 'hostExec',
  hostJobCancel: 'hostExec',
  hostJobForget: 'hostExec',
  transferOpenRead: 'largeTransfers',
  transferBeginWrite: 'largeTransfers',
  transferRead: 'largeTransfers',
  transferWrite: 'largeTransfers',
  transferCommit: 'largeTransfers',
  transferAbort: 'largeTransfers',
};
const TRANSFER_OPERATIONS = Object.keys(ALIASES).filter(x => x.startsWith('transfer'));
const HOST_OPERATIONS = new Set([
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
  ...TRANSFER_OPERATIONS,
]);
// Document mutations that always save their targets.
const SAVING_OPERATIONS = ['create', 'write', 'edit', 'renameSymbol', 'format'];
const DOWNLOAD_OPERATIONS = ['transferOpenRead', 'transferRead'];
const RAW_COMMAND_OPERATIONS = ['hostExec', 'hostJobPoll', 'hostJobCancel', 'hostJobForget'];
// Permissions whose operations run on the Host and need host.enabled.
const HOST_BACKED_PERMISSIONS = ['copy', 'copyDirectory', 'search', 'findFiles', 'applyPatch', 'readBytes', 'writeBytes', 'largeTransfers', 'hostExec'];
// Renamed in 0.3.0. A legacy key is read for one version, only while its new
// key is not set explicitly. User settings are never rewritten.
const RENAMED_SETTINGS = {
  'host.enabled': 'terminal.enabled',
  'host.terminalName': 'terminal.name',
  'host.workspacePath': 'terminal.hostWorkspacePath',
  'host.commandTimeoutMs': 'terminal.commandTimeoutMs',
  'host.maxOutputCharacters': 'terminal.maxOutputCharacters',
};

// get() returns the manifest default for an unset key, so explicit values are
// detected with inspect(). Test doubles without inspect() return undefined.
function isExplicit(config, key) {
  if (typeof config?.inspect !== 'function') {
    return config?.get(key) !== undefined;
  }
  const inspected = config.inspect(key);
  const values = [inspected?.globalValue, inspected?.workspaceValue, inspected?.workspaceFolderValue];
  return values.some(x => x !== undefined);
}

function hasUserValue(config, key) {
  if (typeof config?.inspect !== 'function') {
    return config?.get(key) !== undefined;
  }
  return config.inspect(key)?.globalValue !== undefined;
}

function checkedValue(raw, fallback) {
  if (raw === undefined) {
    return fallback;
  }
  if (typeof raw !== typeof fallback) {
    return typeof fallback === 'boolean' ? false : fallback;
  }
  return raw;
}

function usesLegacy(config, key) {
  const legacy = RENAMED_SETTINGS[key];
  return Boolean(legacy) && !isExplicit(config, key) && hasUserValue(config, legacy);
}

// Reads a bridge setting from a liveshareWorkspaceBridge configuration,
// falling back to a renamed key's legacy User value.
function readSetting(config, key, fallback) {
  if (!usesLegacy(config, key)) {
    return checkedValue(config?.get(key), fallback);
  }
  const legacy = RENAMED_SETTINGS[key];
  if (typeof config.inspect === 'function') {
    return checkedValue(config.inspect(legacy).globalValue, fallback);
  }
  return checkedValue(config.get(legacy), fallback);
}

function createPermissions(vscode) {
  function configuration() {
    return vscode.workspace.getConfiguration?.(NAMESPACE);
  }
  function value(key, fallback) {
    return readSetting(configuration(), key, fallback);
  }
  // Legacy keys currently read in place of their new names, for a one-line notice.
  function legacySettingsInUse() {
    const config = configuration();
    return Object.keys(RENAMED_SETTINGS)
      .filter(key => usesLegacy(config, key))
      .map(key => RENAMED_SETTINGS[key]);
  }
  function enabled(key) {
    return value('permissions.' + key, true);
  }
  function agentDenial() {
    if (value('agent.enabled', true)) {
      return null;
    }
    return {
      code: 'agent_access_disabled',
      message: 'Agent access is disabled in Live Share Workspace Bridge settings.',
    };
  }
  function permissionDenial(key) {
    if (!DEFINITIONS[key] || enabled(key)) {
      return null;
    }
    return {
      code: 'operation_disabled',
      message: `Permission disabled: ${key}.`,
      permission: key,
    };
  }
  function saveDenial(op) {
    if (!SAVING_OPERATIONS.includes(op) || enabled('save')) {
      return null;
    }
    return {
      code: 'operation_disabled',
      message: 'This operation saves documents; Save Documents permission is disabled.',
      permission: 'save',
    };
  }
  function hostDenial(op) {
    if (!HOST_OPERATIONS.has(op) || value('host.enabled', false)) {
      return null;
    }
    return {
      code: 'host_access_disabled',
      message: 'Host access is disabled. Enable Allow Host Access (liveshareWorkspaceBridge.host.enabled) manually in settings.',
    };
  }
  function downloadDenial(op) {
    if (!DOWNLOAD_OPERATIONS.includes(op)) {
      return null;
    }
    return {
      code: 'feature_unavailable',
      message: 'Large downloads are not available: they have not been validated. Use bounded readBytes for a small file; do not emulate a large download by repeatedly calling it.',
    };
  }
  // Raw commands cannot honor per-operation limits, so any disabled permission blocks them.
  function rawCommandDenial(op) {
    if (!RAW_COMMAND_OPERATIONS.includes(op)) {
      return null;
    }
    const disabled = Object.keys(DEFINITIONS).filter(x => x !== 'hostExec' && !enabled(x));
    if (!disabled.length) {
      return null;
    }
    return {
      code: 'raw_commands_restricted',
      message: 'Raw Host commands are unavailable while individual operation permissions are restricted.',
      disabledPermissions: disabled,
    };
  }
  // The first denial wins; the order of these checks is part of the API.
  function reason(op) {
    return agentDenial()
      || permissionDenial(ALIASES[op] || op)
      || saveDenial(op)
      || hostDenial(op)
      || downloadDenial(op)
      || rawCommandDenial(op)
      || null;
  }
  function assert(op) {
    const denied = reason(op);
    if (denied) {
      fail(denied.code, denied.message, denied);
    }
  }
  function effectiveAccess(op) {
    const denied = reason(op);
    return { allowed: !denied, reason: denied };
  }
  function snapshot(operations) {
    const configured = Object.keys(DEFINITIONS).map(x => [x, enabled(x)]);
    const checked = operations.filter(x => !['info', 'hostStatus'].includes(x));
    return {
      agentEnabled: value('agent.enabled', true),
      hostEnabled: value('host.enabled', false),
      configured: Object.fromEntries(configured),
      effective: Object.fromEntries(checked.map(x => [x, effectiveAccess(x)])),
    };
  }
  return { assert, reason, enabled, value, snapshot, legacySettingsInUse };
}
function hostAccessProperties() {
  return {
    [`${NAMESPACE}.host.enabled`]: {
      type: 'boolean',
      default: false,
      scope: 'machine',
      order: 2,
      markdownDescription: '**Allow Host Access** — Enable Host-dependent operations. Binding starts a foreground Host helper once through the shared Host terminal and creates and removes an owned temporary handshake file; requests then use a Live Share forwarded port. Turning this off blocks new Host work without rolling back dispatched work. Child commands retain their configured timeout.',
    },
    [`${NAMESPACE}.host.terminalName`]: {
      type: 'string',
      default: '',
      scope: 'machine',
      order: 3,
      description: 'Exact name of the shared read/write PowerShell terminal used once to start the Host helper. Leave empty only when there is exactly one eligible Live Share shared terminal. Ordinary Guest terminals are never selected.',
    },
    [`${NAMESPACE}.host.workspacePath`]: {
      type: 'string',
      default: '',
      scope: 'machine',
      order: 4,
      description: 'Optional Host workspace path for the selected shared root. Otherwise the shared PowerShell current directory is verified using a random handshake file. No Host path is guessed.',
    },
    [`${NAMESPACE}.host.commandTimeoutMs`]: {
      type: 'integer',
      default: 120000,
      minimum: 1000,
      maximum: 3600000,
      scope: 'machine',
      order: 5,
      description: 'Maximum time for a Host child command. Only the bridge-owned process tree is terminated on timeout.',
    },
    [`${NAMESPACE}.host.maxOutputCharacters`]: {
      type: 'integer',
      default: 65536,
      minimum: 1024,
      maximum: 262144,
      scope: 'machine',
      order: 6,
      description: 'Maximum retained characters per Host stdout/stderr stream. Excess output is drained and explicitly marked truncated.',
    },
  };
}

// The renamed terminal.* keys stay visible only as deprecated entries.
function legacyHostProperties(current) {
  const properties = {};
  let order = 90;
  for (const [key, legacy] of Object.entries(RENAMED_SETTINGS)) {
    const { markdownDescription, description, ...schema } = current[`${NAMESPACE}.${key}`];
    properties[`${NAMESPACE}.${legacy}`] = {
      ...schema,
      order: order++,
      deprecationMessage: `Renamed to liveshareWorkspaceBridge.${key}. Still read for one version while ${key} is not set; the bridge does not change your settings.`,
    };
  }
  properties[`${NAMESPACE}.host.transport`] = {
    type: 'string',
    enum: ['sharedTerminal', 'portForward'],
    default: 'portForward',
    scope: 'machine',
    order: order++,
    deprecationMessage: 'Removed: the Host channel always uses portForward. This value is ignored.',
  };
  return properties;
}

function transferProperties() {
  return {
    [`${NAMESPACE}.transfer.chunkBytes`]: {
      type: 'integer',
      default: 32768,
      minimum: 1024,
      maximum: 65536,
      scope: 'machine',
      order: 7,
      description: 'Maximum raw bytes in one transfer chunk.',
    },
    [`${NAMESPACE}.transfer.idleTimeoutMs`]: {
      type: 'integer',
      default: 120000,
      minimum: 10000,
      maximum: 900000,
      scope: 'machine',
      order: 8,
      description: 'Idle lifetime of a Host transfer handle. Expired handles and owned upload staging files are released automatically.',
    },
  };
}

function portForwardProperties() {
  return {
    [`${NAMESPACE}.host.guestPort`]: {
      type: 'integer',
      default: 0,
      minimum: 0,
      maximum: 65535,
      scope: 'machine',
      order: 13,
      description: 'Local port to connect to in portForward mode. 0 uses the same port as the Host helper. Set it only when Live Share forwarded the Host port to a different local port; it is read on every handshake attempt.',
    },
    [`${NAMESPACE}.host.idleTimeoutMinutes`]: {
      type: 'integer',
      default: 30,
      minimum: 1,
      maximum: 1440,
      scope: 'machine',
      order: 14,
      description: 'In portForward mode, the Host helper exits after this many minutes without a request. Applies to the next helper started.',
    },
    [`${NAMESPACE}.host.handshakeTimeoutMinutes`]: {
      type: 'integer',
      default: 5,
      minimum: 1,
      maximum: 60,
      scope: 'machine',
      order: 15,
      description: 'In portForward mode, how long the bridge waits for the Host to share the helper port before the bind fails.',
    },
  };
}

function configurationProperties() {
  const properties = {
    [`${NAMESPACE}.ipc.accessMode`]: {
      type: 'string',
      enum: ['ownerOnly', 'selectedUsers'],
      enumDescriptions: [
        'Only the Windows user running VS Code (release default).',
        'Only the owner and selected machine-local user SIDs, in the same Windows session.',
      ],
      default: 'ownerOnly',
      scope: 'machine',
      order: 9,
      markdownDescription: '**IPC Access Mode** — Trust applies to every process under allowed accounts, not only the agent. Calls use bridge permissions, outside any agent filesystem sandbox. Host access is independent; when enabled it may allow Host commands. Changes restart the bridge; rediscover afterward. Use Configure IPC Access to choose users. The former allLocalUsers value was removed in 0.3.0; a stored value runs as ownerOnly and is not rewritten.',
    },
    [`${NAMESPACE}.ipc.selectedUserSids`]: {
      type: 'array',
      items: { type: 'string', pattern: '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$' },
      uniqueItems: true,
      maxItems: 256,
      default: [],
      scope: 'machine',
      order: 10,
      markdownDescription: '**Selected Local Account SIDs** — Used only by selectedUsers. Configure IPC Access displays names but saves stable SIDs. Renames keep access; deleted/recreated accounts are not substituted. Invalid, foreign and unavailable SIDs are never granted.',
    },
    [`${NAMESPACE}.ipc.allowCodexSandboxClients`]: {
      type: 'boolean',
      default: false,
      scope: 'machine',
      order: 11,
      deprecationMessage: 'Use IPC Access Mode. A previously enabled legacy setting migrates once to selectedUsers and pinned local account SIDs.',
      markdownDescription: 'Legacy v0.2.1 compatibility only. Ignored when IPC Access Mode is explicitly configured. Migration pins the two existing sandbox accounts by SID; it does not create accounts or broaden trust.',
    },
    [`${NAMESPACE}.agent.enabled`]: {
      type: 'boolean',
      default: true,
      scope: 'machine',
      order: 1,
      markdownDescription: '**Allow Agent Access** — Master switch for all shared-workspace operations. Disabling it takes effect on subsequent requests.',
    },
    ...hostAccessProperties(),
    ...transferProperties(),
    ...portForwardProperties(),
  };
  Object.assign(properties, legacyHostProperties(properties));
  Object.assign(properties, permissionProperties());
  return properties;
}

function hostLinkNote(key) {
  if (!HOST_BACKED_PERMISSIONS.includes(key)) {
    return '';
  }
  return ' Host-backed operations also require #liveshareWorkspaceBridge.host.enabled#. Their effective access is off while Host access is off; this configured preference is retained.';
}

// One boolean switch per operation, ordered after the general settings.
function permissionProperties() {
  const properties = {};
  let order = 20;
  for (const [key, [label, description]] of Object.entries(DEFINITIONS)) {
    properties[`${NAMESPACE}.permissions.${key}`] = {
      type: 'boolean',
      default: true,
      scope: 'machine',
      order: order++,
      markdownDescription: `**${label}** — ${description}${hostLinkNote(key)}`,
    };
  }
  return properties;
}
module.exports = {
  NAMESPACE,
  RENAMED_SETTINGS,
  readSetting,
  DEFINITIONS,
  ALIASES,
  HOST_OPERATIONS,
  createPermissions,
  configurationProperties,
};
