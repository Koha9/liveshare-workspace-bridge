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
  copy: ['Copy files', 'Allow byte-preserving file copies through the shared Host terminal.'],
  copyDirectory: ['Copy directories', 'Allow directory copies through the shared Host terminal.'],
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
  largeTransfers: ['Upload large files', 'Allow chunked Host file uploads. Write Bytes permission also applies. Large downloads are unavailable in v0.2 because sustained shared-terminal output did not pass live validation.'],
  hostExec: ['Run Host commands', 'Allow arbitrary commands in a bounded Host child process. Requires all other operation permissions because raw commands cannot enforce per-operation restrictions.']
};
const ALIASES = {
  readMany: 'read', providerRead: 'read', searchSnapshot: 'search', searchResults: 'search', findFilesSnapshot: 'findFiles',
  hostStat: 'stat', hostJobPoll: 'hostExec', hostJobCancel: 'hostExec', hostJobForget: 'hostExec',
  transferOpenRead: 'largeTransfers', transferBeginWrite: 'largeTransfers', transferRead: 'largeTransfers', transferWrite: 'largeTransfers', transferCommit: 'largeTransfers', transferAbort: 'largeTransfers'
};
const HOST_OPERATIONS = new Set(['hostBind', 'hostStat', 'copy', 'copyDirectory', 'search', 'findFiles', 'applyPatch', 'readBytes', 'writeBytes', 'hostExec', 'hostJobPoll', 'hostJobCancel', 'hostJobForget', ...Object.keys(ALIASES).filter(x => x.startsWith('transfer'))]);
function createPermissions(vscode) {
  function value(key, fallback) {
    const config = vscode.workspace.getConfiguration?.(NAMESPACE);
    const v = config?.get(key);
    if (v === undefined) return fallback;
    if (typeof v !== typeof fallback) return typeof fallback === 'boolean' ? false : fallback;
    return v;
  }
  function enabled(key) { return value('permissions.' + key, true); }
  function reason(op) {
    if (!value('agent.enabled', true)) return { code: 'agent_access_disabled', message: 'Agent access is disabled in Live Share Workspace Bridge settings.' };
    const key = ALIASES[op] || op;
    if (DEFINITIONS[key] && !enabled(key)) return { code: 'operation_disabled', message: `Permission disabled: ${key}.`, permission: key };
    if (['create', 'write', 'edit', 'renameSymbol', 'format'].includes(op) && !enabled('save')) return { code: 'operation_disabled', message: 'This operation saves documents; Save Documents permission is disabled.', permission: 'save' };
    if (HOST_OPERATIONS.has(op) && !value('terminal.enabled', false)) return { code: 'terminal_access_disabled', message: 'Shared Host terminal access is disabled. Enable Allow Shared Host Terminal Access manually in settings.' };
    if (['transferOpenRead','transferRead'].includes(op)) return { code: 'feature_unavailable', message: 'Large downloads are unavailable in v0.2: sustained output can stall the shared Host terminal. Use bounded readBytes for a small file; do not emulate a large download by repeatedly calling it.' };
    if (['hostExec', 'hostJobPoll', 'hostJobCancel', 'hostJobForget'].includes(op)) {
      const disabled = Object.keys(DEFINITIONS).filter(x => x !== 'hostExec' && !enabled(x));
      if (disabled.length) return { code: 'raw_commands_restricted', message: 'Raw Host commands are unavailable while individual operation permissions are restricted.', disabledPermissions: disabled };
    }
    return null;
  }
  function assert(op) { const denied = reason(op); if (denied) fail(denied.code, denied.message, denied); }
  function snapshot(operations) {
    return {
      agentEnabled: value('agent.enabled', true), terminalEnabled: value('terminal.enabled', false),
      configured: Object.fromEntries(Object.keys(DEFINITIONS).map(x => [x, enabled(x)])),
      effective: Object.fromEntries(operations.filter(x => !['info', 'hostStatus'].includes(x)).map(x => [x, { allowed: !reason(x), reason: reason(x) }]))
    };
  }
  return { assert, reason, enabled, value, snapshot };
}
function configurationProperties() {
  const properties = {
    [`${NAMESPACE}.ipc.accessMode`]: {type:'string',enum:['ownerOnly','allLocalUsers','selectedUsers'],enumDescriptions:['Only the Windows user running VS Code (release default).','All current machine-local SAM user accounts, in the same Windows session. No remote or domain users.','Only the owner and selected machine-local user SIDs, in the same Windows session.'],default:'ownerOnly',scope:'machine',order:9,markdownDescription:'**IPC Access Mode** — Trust applies to every process under allowed accounts, not only Codex. Calls use bridge permissions outside Codex filesystem sandbox limits. Host access is independent; when enabled it may allow Host commands. Changes restart the bridge; rediscover afterward. Use Configure IPC Access to choose users.'},
    [`${NAMESPACE}.ipc.selectedUserSids`]: {type:'array',items:{type:'string',pattern:'^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$'},uniqueItems:true,maxItems:256,default:[],scope:'machine',order:10,markdownDescription:'**Selected Local Account SIDs** — Used only by selectedUsers. Configure IPC Access displays names but saves stable SIDs. Renames keep access; deleted/recreated accounts are not substituted. Invalid, foreign and unavailable SIDs are never granted.'},
    [`${NAMESPACE}.ipc.allowCodexSandboxClients`]: {type:'boolean',default:false,scope:'machine',order:11,deprecationMessage:'Use IPC Access Mode. A previously enabled legacy setting migrates once to selectedUsers and pinned local account SIDs, never to allLocalUsers.',markdownDescription:'Legacy v0.2.1 compatibility only. Ignored when IPC Access Mode is explicitly configured. Migration pins the two existing sandbox accounts by SID; it does not create accounts or broaden trust.'},
    [`${NAMESPACE}.agent.enabled`]: { type: 'boolean', default: true, scope: 'machine', order: 1, markdownDescription: '**Allow Agent Access** — Master switch for all shared-workspace operations. Disabling it takes effect on subsequent requests.' },
    [`${NAMESPACE}.terminal.enabled`]: { type: 'boolean', default: false, scope: 'machine', order: 2, markdownDescription: '**Allow Shared Host Terminal Access** — Enable Host-dependent operations. Connection binding creates and removes owned temporary handshake files. Turning this off blocks new Host work without rolling back dispatched work. Child commands retain their configured timeout.' },
    [`${NAMESPACE}.terminal.name`]: { type: 'string', default: '', scope: 'machine', order: 3, description: 'Exact name of the shared read/write PowerShell terminal. Leave empty only when there is exactly one eligible Live Share shared terminal. Ordinary Guest terminals are never selected.' },
    [`${NAMESPACE}.terminal.hostWorkspacePath`]: { type: 'string', default: '', scope: 'machine', order: 4, description: 'Optional Host workspace path for the selected shared root. Otherwise the shared PowerShell current directory is verified using a random handshake file. No Host path is guessed.' },
    [`${NAMESPACE}.terminal.commandTimeoutMs`]: { type: 'integer', default: 120000, minimum: 1000, maximum: 3600000, scope: 'machine', order: 5, description: 'Maximum time for a Host child command. Only the bridge-owned process tree is terminated on timeout.' },
    [`${NAMESPACE}.terminal.maxOutputCharacters`]: { type: 'integer', default: 65536, minimum: 1024, maximum: 262144, scope: 'machine', order: 6, description: 'Maximum retained characters per Host stdout/stderr stream. Excess output is drained and explicitly marked truncated.' },
    [`${NAMESPACE}.transfer.chunkBytes`]: { type: 'integer', default: 32768, minimum: 1024, maximum: 65536, scope: 'machine', order: 7, description: 'Maximum raw bytes in one transfer chunk.' },
    [`${NAMESPACE}.transfer.idleTimeoutMs`]: { type: 'integer', default: 120000, minimum: 10000, maximum: 900000, scope: 'machine', order: 8, description: 'Idle lifetime of a Host transfer handle. Expired handles and owned upload staging files are released automatically.' }
  };
  let order = 20;
  for (const [key, [label, description]] of Object.entries(DEFINITIONS)) {
    const linked=['copy','copyDirectory','search','findFiles','applyPatch','readBytes','writeBytes','largeTransfers','hostExec'].includes(key) ? ' Host-backed operations also require #liveshareWorkspaceBridge.terminal.enabled#. Their effective access is off while terminal access is off; this configured preference is retained.' : '';
    properties[`${NAMESPACE}.permissions.${key}`] = { type: 'boolean', default: true, scope: 'machine', order: order++, markdownDescription: `**${label}** — ${description}${linked}` };
  }
  return properties;
}
module.exports = { NAMESPACE, DEFINITIONS, ALIASES, HOST_OPERATIONS, createPermissions, configurationProperties };
