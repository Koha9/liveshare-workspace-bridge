'use strict';

// MCP tool table for Live Share Workspace Bridge.
// Guest-side tools map one-to-one onto workspace.cjs operations and reuse the
// canonical cli.cjs transport. Permissions stay in the extension.
// No request is ever retried or replayed here.

const os = require('node:os');
const { discover, request } = require('./cli.cjs');
const { version: SERVER_VERSION } = require('./package.json');

const REQUEST_TIMEOUT_MS = 60000;

const REDISCOVER_HINT = 'Call lswb_list_workspaces again and retry with the new workspace list.';
const MUTATION_HINT = 'If this was a mutation, inspect the target before retrying; it may already have been applied.';
const UNKNOWN_OUTCOME_HINT = 'The request may have been applied; inspect the target before retrying.';

// Extension error codes meaning the remembered instance/epoch binding is stale.
const BINDING_CODES = new Set([
  'workspace_changed',
  'workspace_mismatch',
  'instance_mismatch',
  'epoch_mismatch',
]);

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function toolResult(structured, isError) {
  const result = {
    content: [{ type: 'text', text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
  if (isError) {
    result.isError = true;
  }
  return result;
}

function toolError(code, message, details) {
  const structured = { code, message };
  if (details !== undefined) {
    structured.details = details;
  }
  return toolResult(structured, true);
}

// ---------------------------------------------------------------------------
// Discovery and workspace bindings
// ---------------------------------------------------------------------------

// Discovery directory for bridge instance records. Returning undefined lets
// cli.cjs fall back to its own default (~/.liveshare-local/instances).
function registryDir() {
  const value = process.env.LSWB_REGISTRY_DIR;
  return value ? value : undefined;
}

// Map<rootUri, { instance, epoch, pipeName, pid }>
const bindings = new Map();

function refreshBindings(instances) {
  bindings.clear();
  for (const instance of instances) {
    for (const root of instance.roots) {
      if (bindings.has(root.uri)) {
        // Keep registry order: the first instance exposing a root wins.
        continue;
      }
      bindings.set(root.uri, {
        instance: instance.id,
        epoch: instance.epoch,
        pipeName: instance.pipeName,
        pid: instance.pid,
      });
    }
  }
}

function getBinding(root) {
  return bindings.get(root);
}

function bindingRoots() {
  return [...bindings.keys()];
}

function clearBindings() {
  bindings.clear();
}

async function discoverReport() {
  return discover({ registryPath: registryDir() });
}

async function resolveBinding(root) {
  const known = bindings.get(root);
  if (known) {
    return known;
  }
  try {
    const report = await discoverReport();
    refreshBindings(report.instances);
  } catch {
    // A failed lazy discovery is reported as an unknown workspace below.
  }
  return bindings.get(root);
}

// Discovery statuses that mean "discovery itself failed", mirroring cli.instances().
const DISCOVERY_FAILURES = {
  access_denied: {
    code: 'discovery_access_denied',
    message: 'Bridge discovery was denied. Check IPC Access Mode in the bridge settings; never change permissions automatically.',
  },
  unavailable: {
    code: 'discovery_unavailable',
    message: 'Bridge records exist but no instance answered with a valid identity. Restart the bridge connection and retry.',
  },
  invalid_registry: {
    code: 'discovery_invalid_registry',
    message: 'The bridge instance registry could not be read or contains invalid records.',
  },
};

function mapRoot(root) {
  return { name: root.name, uri: root.uri };
}

function mapWorkspace(instance) {
  return {
    instance: instance.id,
    epoch: instance.epoch,
    version: instance.version,
    pid: instance.pid,
    roots: instance.roots.map(mapRoot),
  };
}

async function listWorkspaces() {
  let report;
  try {
    report = await discoverReport();
  } catch (error) {
    return toolError('discovery_failed', error.message || 'Bridge discovery failed.');
  }
  const failure = DISCOVERY_FAILURES[report.status];
  if (failure) {
    const details = { status: report.status, probes: report.probes, issues: report.issues };
    return toolError(failure.code, failure.message, details);
  }
  refreshBindings(report.instances);
  return toolResult({
    status: report.status,
    workspaces: report.instances.map(mapWorkspace),
    probes: report.probes,
    issues: report.issues,
  }, false);
}

// ---------------------------------------------------------------------------
// Guest requests and error mapping
// ---------------------------------------------------------------------------

function withoutWorkspace(args) {
  const fields = { ...args };
  delete fields.workspace;
  return fields;
}

function buildBody(op, binding, args) {
  return {
    op,
    instance: binding.instance,
    epoch: binding.epoch,
    workspace: args.workspace,
    ...withoutWorkspace(args),
  };
}

function bindingMessage(error) {
  const parts = [error.message || 'The workspace binding is no longer valid.', REDISCOVER_HINT];
  if (error.code === 'workspace_changed') {
    parts.push(MUTATION_HINT);
  }
  return parts.join(' ');
}

function mapExtensionError(root, error) {
  const failure = error && typeof error === 'object' ? error : {};
  const code = typeof failure.code === 'string' ? failure.code : 'extension_error';
  let message = typeof failure.message === 'string' ? failure.message : 'The bridge rejected the request.';
  if (BINDING_CODES.has(code)) {
    bindings.delete(root);
    message = bindingMessage({ code, message });
  }
  return toolError(code, message, failure.details);
}

function transportCode(error) {
  if (typeof error.code === 'string') {
    return error.code;
  }
  return error.requestSent ? 'transport_outcome_unknown' : 'transport_unavailable';
}

function mapTransportError(error) {
  const code = transportCode(error);
  let message = error.message || 'Bridge transport failed.';
  if (code === 'transport_outcome_unknown') {
    message = `${message} ${UNKNOWN_OUTCOME_HINT}`;
  }
  const details = { requestSent: error.requestSent };
  if (error.transportCode) {
    details.transportCode = error.transportCode;
  }
  return toolError(code, message, details);
}

function workspaceNotFound(root) {
  return toolError(
    'workspace_not_found',
    `No bridge instance currently shares ${root}. Call lswb_list_workspaces and use one of the returned root uris.`,
  );
}

async function callGuest(op, args) {
  const binding = await resolveBinding(args.workspace);
  if (!binding) {
    return workspaceNotFound(args.workspace);
  }
  const target = { id: binding.instance, pipeName: binding.pipeName };
  let response;
  try {
    response = await request(target, buildBody(op, binding, args), REQUEST_TIMEOUT_MS);
  } catch (error) {
    return mapTransportError(error);
  }
  if (!response || response.ok !== true) {
    return mapExtensionError(args.workspace, response && response.error);
  }
  return toolResult(response.result, false);
}

async function callStatus(args) {
  const outcome = await callGuest('info', args);
  if (outcome.isError) {
    return outcome;
  }
  const structured = {
    ...outcome.structuredContent,
    mcp: {
      account: os.userInfo().username,
      pid: process.pid,
      serverVersion: SERVER_VERSION,
    },
  };
  return toolResult(structured, false);
}

// ---------------------------------------------------------------------------
// Minimal JSON Schema validation
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const TYPE_CHECKS = {
  object: isPlainObject,
  array: Array.isArray,
  string: value => typeof value === 'string',
  integer: Number.isInteger,
  boolean: value => typeof value === 'boolean',
};

function label(path) {
  return path || 'arguments';
}

function checkObject(schema, value, path) {
  for (const key of schema.required || []) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      return `${path ? path + '.' : ''}${key} is required.`;
    }
  }
  const properties = schema.properties || {};
  for (const [key, item] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (!Object.prototype.hasOwnProperty.call(properties, key)) {
      if (schema.additionalProperties === false) {
        return `${childPath} is not an allowed argument.`;
      }
      continue;
    }
    const problem = validateAgainstSchema(properties[key], item, childPath);
    if (problem) {
      return problem;
    }
  }
  return null;
}

function checkArray(schema, value, path) {
  if (!schema.items) {
    return null;
  }
  for (let index = 0; index < value.length; index += 1) {
    const problem = validateAgainstSchema(schema.items, value[index], `${label(path)}[${index}]`);
    if (problem) {
      return problem;
    }
  }
  return null;
}

// Returns a specific error string, or null when value matches the schema.
// Deep semantics (versions, ranges, limits) are left to the extension.
function validateAgainstSchema(schema, value, path = '') {
  const check = TYPE_CHECKS[schema.type];
  if (check && !check(value)) {
    return `${label(path)} must be ${schema.type === 'integer' ? 'an' : 'a'} ${schema.type}.`;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return `${label(path)} must be one of ${schema.enum.join(', ')}.`;
  }
  if (schema.type === 'object') {
    return checkObject(schema, value, path);
  }
  if (schema.type === 'array') {
    return checkArray(schema, value, path);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Schema fragments and description text
// ---------------------------------------------------------------------------

const WORKSPACE_PROPERTY = {
  type: 'string',
  description: 'Exact root uri from lswb_list_workspaces (a vsls: URI).',
};

function text(description) {
  return { type: 'string', description };
}

function int(description) {
  return { type: 'integer', description };
}

function bool(description) {
  return { type: 'boolean', description };
}

const PATH = text('Workspace-relative path with forward slashes, no leading slash, no dot segments.');
const OPTIONAL_ROOT_PATH = text('Workspace-relative path; omit to target the workspace root.');
const EXPECTED_VERSION = int('Document version returned by lswb_read_file; stale versions are rejected.');
const EXPECTED_HASH = text('SHA-256 text hash returned by lswb_read_file with withHash:true.');
const ALLOW_DIRTY = bool('Allow editing a document with unsaved edits; those edits are saved too.');
const LINE = int('1-based line number.');
const CHARACTER = int('0-based UTF-16 character offset within the line. Default 0.');

const GUARDS = {
  expectedVersion: EXPECTED_VERSION,
  expectedHash: EXPECTED_HASH,
  allowDirty: ALLOW_DIRTY,
};

const VERSION_GUIDANCE = 'Read the file first and pass its version as expectedVersion; '
  + 'the extension rejects stale versions and dirty buffers unless allowDirty is set.';
const SAVE_SEMANTICS = 'The result separates applied (the edit reached the editor) from saved '
  + '(per-document saves in files[]: saved, dirty, version, error); saved:false leaves the applied text unsaved in the editor.';
const LANGUAGE_NOTE = 'Depends on the language service provider for this file type; results may be empty when none is available.';

function describe(...sentences) {
  return sentences.join(' ');
}

const POSITION = {
  type: 'object',
  properties: {
    line: int('0-based line.'),
    character: int('0-based UTF-16 character.'),
  },
  required: ['line', 'character'],
  additionalProperties: false,
};

const CHANGE_ITEM = {
  type: 'object',
  description: 'One of: { oldText, newText, all? }, { startLine, endLine, newText, expectedText? } or { range, newText, expectedText? }.',
  properties: {
    newText: text('Replacement text.'),
    oldText: text('Exact text to replace; must be unique unless all:true.'),
    all: bool('Replace every occurrence of oldText.'),
    startLine: int('1-based first line of a line-range replacement.'),
    endLine: int('1-based last line (inclusive) of a line-range replacement.'),
    expectedText: text('Current text of the selected range; guards position edits.'),
    range: {
      type: 'object',
      description: '0-based start/end positions.',
      properties: { start: POSITION, end: POSITION },
      required: ['start', 'end'],
      additionalProperties: false,
    },
  },
  required: ['newText'],
  additionalProperties: false,
};

const EDIT_FILE_ITEM = {
  type: 'object',
  properties: {
    path: PATH,
    changes: { type: 'array', items: CHANGE_ITEM, description: 'Non-overlapping changes; positions refer to the original text.' },
    ...GUARDS,
  },
  required: ['path', 'changes'],
  additionalProperties: false,
};

const READ_FILE_ITEM = {
  type: 'object',
  properties: {
    path: PATH,
    startLine: int('1-based first line. Default 1.'),
    endLine: int('1-based last line (inclusive). Default last line.'),
    withHash: bool('Include the SHA-256 text hash.'),
  },
  required: ['path'],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Tool table
// ---------------------------------------------------------------------------

function guestSchema(properties, required) {
  return {
    type: 'object',
    properties: { workspace: WORKSPACE_PROPERTY, ...properties },
    required: ['workspace', ...required],
    additionalProperties: false,
  };
}

function guestTool({ name, op, description, properties = {}, required = [], handler }) {
  const inputSchema = guestSchema(properties, required);
  return {
    name,
    description,
    inputSchema,
    validate: args => validateAgainstSchema(inputSchema, args),
    handler: handler || (args => callGuest(op, args)),
  };
}

function rejectAnyArguments(args) {
  if (Object.keys(args).length > 0) {
    return 'lswb_list_workspaces takes no arguments.';
  }
  return null;
}

const LIST_WORKSPACES_TOOL = {
  name: 'lswb_list_workspaces',
  description: [
    'List the Live Share Guest workspaces reachable through the local Live Share Workspace Bridge.',
    'WHEN TO USE: Call first to find the Live Share Guest workspaces this bridge can reach; '
      + 'use the returned root uri as the workspace argument of other lswb_ tools.',
    'Read-only. Each workspace carries instance, epoch, version, pid and roots ({ name, uri }); '
      + 'keep instance and epoch together with the root uri. status is ready, partial, '
      + 'no_shared_workspace or no_records; discovery failures are returned as errors.',
  ].join(' '),
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  validate: rejectAnyArguments,
  handler: listWorkspaces,
};

const FILE_TOOLS = [
  guestTool({
    name: 'lswb_status',
    op: 'info',
    description: describe(
      'Report bridge status for a workspace: instance identity, epoch, roots, permissions, dirty documents and MCP server identity.',
      'WHEN TO USE: Check which operations are permitted or which documents are dirty before editing.',
      'Read-only. mcp.account is the OS account running this MCP server.',
    ),
    handler: callStatus,
  }),
  guestTool({
    name: 'lswb_list_dir',
    op: 'list',
    description: describe(
      'List the entries of a shared directory (name and file type).',
      'WHEN TO USE: Explore the workspace layout. Omit path to list the root. Read-only.',
    ),
    properties: { path: OPTIONAL_ROOT_PATH },
  }),
  guestTool({
    name: 'lswb_read_file',
    op: 'read',
    description: describe(
      'Read a text document from its editor buffer, optionally a 1-based inclusive line range.',
      'WHEN TO USE: Before any edit, to obtain text and version (use withHash for a text hash). Read-only; 1 MiB text limit.',
    ),
    properties: {
      path: PATH,
      startLine: READ_FILE_ITEM.properties.startLine,
      endLine: READ_FILE_ITEM.properties.endLine,
      withHash: READ_FILE_ITEM.properties.withHash,
    },
    required: ['path'],
  }),
  guestTool({
    name: 'lswb_read_many',
    op: 'readMany',
    description: describe(
      'Read up to 50 text documents in one request.',
      'WHEN TO USE: Gather several files at once. Each files[] entry returns { ok, result } or { ok:false, path, error }. Read-only.',
    ),
    properties: { files: { type: 'array', items: READ_FILE_ITEM } },
    required: ['files'],
  }),
  guestTool({
    name: 'lswb_create_file',
    op: 'create',
    description: describe(
      'Create a new text file and save it; fails if the file exists.',
      'WHEN TO USE: Add a new file. Missing parent directories are created unless parents:false.',
      SAVE_SEMANTICS,
    ),
    properties: {
      path: PATH,
      text: text('Full file text.'),
      eol: { type: 'string', enum: ['LF', 'CRLF'], description: 'Line ending; default inferred from text.' },
      parents: bool('Create missing parent directories. Default true.'),
    },
    required: ['path', 'text'],
  }),
  guestTool({
    name: 'lswb_write_file',
    op: 'write',
    description: describe(
      'Replace the whole text of an existing document and save it (full-document replacement).',
      'WHEN TO USE: Rewrite a file entirely; prefer lswb_edit_file for local changes.',
      VERSION_GUIDANCE,
      'expectedVersion or expectedHash is required (one of the two).',
      SAVE_SEMANTICS,
    ),
    properties: { path: PATH, text: text('New full document text.'), ...GUARDS },
    required: ['path', 'text'],
  }),
  guestTool({
    name: 'lswb_edit_file',
    op: 'edit',
    description: describe(
      'Apply text replacements to one or more documents (up to 100) as one workspace edit, then save each target.',
      'WHEN TO USE: Targeted changes. oldText must match exactly one place, otherwise set all:true or narrow it;',
      'line or range edits need expectedVersion, expectedHash or expectedText.',
      VERSION_GUIDANCE,
      'Guards are per file: pass expectedVersion (from lswb_read_file) inside each files[] item.',
      SAVE_SEMANTICS,
    ),
    properties: { files: { type: 'array', items: EDIT_FILE_ITEM } },
    required: ['files'],
  }),
  guestTool({
    name: 'lswb_save_file',
    op: 'save',
    description: describe(
      'Save one document that has unsaved editor changes.',
      'WHEN TO USE: Retry a save that returned saved:false.',
      VERSION_GUIDANCE,
      'expectedVersion is required and must equal the current version.',
    ),
    properties: { path: PATH, expectedVersion: EXPECTED_VERSION },
    required: ['path', 'expectedVersion'],
  }),
  guestTool({
    name: 'lswb_mkdir',
    op: 'mkdir',
    description: describe(
      'Create a directory, including missing parents.',
      'WHEN TO USE: Prepare a directory before creating files in it.',
    ),
    properties: { path: PATH },
    required: ['path'],
  }),
  guestTool({
    name: 'lswb_stat',
    op: 'stat',
    description: describe(
      'Return provider metadata for a path: type, size, mtime, ctime.',
      'WHEN TO USE: Check whether a path exists or is a file or directory. Omit path for the root. Read-only.',
    ),
    properties: { path: OPTIONAL_ROOT_PATH },
  }),
  guestTool({
    name: 'lswb_move',
    op: 'move',
    description: describe(
      'Move or rename a file or directory within the workspace.',
      'WHEN TO USE: Rename paths. Rejected when source or destination has unsaved documents.',
      'overwrite:true replaces an existing destination and needs write permission.',
    ),
    properties: {
      path: PATH,
      to: text('Workspace-relative destination path.'),
      parents: bool('Create missing destination parent directories. Default true.'),
      overwrite: bool('Replace an existing destination. Default false.'),
    },
    required: ['path', 'to'],
  }),
  guestTool({
    name: 'lswb_delete',
    op: 'delete',
    description: describe(
      'Delete a single file or an empty directory (no trash).',
      'WHEN TO USE: Remove files. Recursive deletion is not supported; delete contents first.',
      'Rejected when the target has unsaved documents.',
    ),
    properties: { path: PATH },
    required: ['path'],
  }),
];

const LANGUAGE_TOOLS = [
  guestTool({
    name: 'lswb_diagnostics',
    op: 'diagnostics',
    description: describe(
      'Return language diagnostics (errors, warnings) for a document, or for the whole root when path is omitted.',
      'WHEN TO USE: Verify an edit compiles or lints cleanly. Ranges are 0-based.',
      LANGUAGE_NOTE,
    ),
    properties: { path: OPTIONAL_ROOT_PATH },
  }),
  guestTool({
    name: 'lswb_document_symbols',
    op: 'symbols',
    description: describe(
      'Return the symbol outline of a document.',
      'WHEN TO USE: Navigate a large file by class or function. Ranges are 0-based.',
      LANGUAGE_NOTE,
    ),
    properties: { path: PATH },
    required: ['path'],
  }),
  guestTool({
    name: 'lswb_workspace_symbols',
    op: 'workspaceSymbols',
    description: describe(
      'Search symbols across the workspace by name.',
      'WHEN TO USE: Locate a type or function without knowing its file.',
      LANGUAGE_NOTE,
    ),
    properties: { query: text('Symbol name query.') },
    required: ['query'],
  }),
  guestTool({
    name: 'lswb_definition',
    op: 'definition',
    description: describe(
      'Find the definition locations of the symbol at a position.',
      'WHEN TO USE: Jump to a definition. line is 1-based; character is 0-based UTF-16, default 0. Returned ranges are 0-based.',
      LANGUAGE_NOTE,
    ),
    properties: { path: PATH, line: LINE, character: CHARACTER },
    required: ['path', 'line'],
  }),
  guestTool({
    name: 'lswb_references',
    op: 'references',
    description: describe(
      'Find reference locations of the symbol at a position.',
      'WHEN TO USE: Find usages before changing a symbol. line is 1-based; character is 0-based UTF-16, default 0. Returned ranges are 0-based.',
      LANGUAGE_NOTE,
    ),
    properties: { path: PATH, line: LINE, character: CHARACTER },
    required: ['path', 'line'],
  }),
  guestTool({
    name: 'lswb_rename_symbol',
    op: 'renameSymbol',
    description: describe(
      'Rename the symbol at a position through the language service, then save each changed document.',
      'WHEN TO USE: Safe cross-file renames; use preview:true first to inspect the edits.',
      'line is 1-based, default 1; character is 0-based UTF-16, default 0.',
      VERSION_GUIDANCE,
      LANGUAGE_NOTE,
      SAVE_SEMANTICS,
    ),
    properties: {
      path: PATH,
      line: int('1-based line number. Default 1.'),
      character: CHARACTER,
      newName: text('New symbol name, 1..256 characters.'),
      preview: bool('Return the planned edits without applying them.'),
      ...GUARDS,
    },
    required: ['path', 'newName'],
  }),
  guestTool({
    name: 'lswb_format',
    op: 'format',
    description: describe(
      'Format a document with its language formatter, then save it.',
      'WHEN TO USE: Normalize formatting after edits.',
      VERSION_GUIDANCE,
      LANGUAGE_NOTE,
      SAVE_SEMANTICS,
    ),
    properties: {
      path: PATH,
      tabSize: int('Tab size 1..16. Default 2.'),
      insertSpaces: bool('Indent with spaces. Default true.'),
      ...GUARDS,
    },
    required: ['path'],
  }),
];

const TOOLS = [LIST_WORKSPACES_TOOL, ...FILE_TOOLS, ...LANGUAGE_TOOLS];

module.exports = {
  TOOLS,
  registryDir,
  validateAgainstSchema,
  refreshBindings,
  getBinding,
  bindingRoots,
  clearBindings,
  BINDING_CODES,
  REQUEST_TIMEOUT_MS,
};
