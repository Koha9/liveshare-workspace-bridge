'use strict';

// MCP tool table for Live Share Workspace Bridge.
// Guest-side tools map one-to-one onto workspace.cjs operations, Host-side tools
// onto host-operations.cjs, and both reuse the canonical cli.cjs transport.
// Permissions stay in the extension.
// No request is ever retried or replayed here.

const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { discover, request, uploadTransfer } = require('./cli.cjs');
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

function matchesType(type, value) {
  const check = TYPE_CHECKS[type];
  return !check || check(value);
}

function article(type) {
  return type === 'integer' ? 'an' : 'a';
}

// A schema type is either one name or a list of alternatives, e.g. ['string', 'array'].
function typeProblem(schema, value, path) {
  if (schema.type === undefined) {
    return null;
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.some(type => matchesType(type, value))) {
    return null;
  }
  if (types.length === 1) {
    return `${label(path)} must be ${article(types[0])} ${types[0]}.`;
  }
  return `${label(path)} must be a ${types.join(' or ')}.`;
}

function hasType(schema, type) {
  return Array.isArray(schema.type) ? schema.type.includes(type) : schema.type === type;
}

// Returns a specific error string, or null when value matches the schema.
// Deep semantics (versions, ranges, limits) are left to the extension.
function validateAgainstSchema(schema, value, path = '') {
  const problem = typeProblem(schema, value, path);
  if (problem) {
    return problem;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return `${label(path)} must be one of ${schema.enum.join(', ')}.`;
  }
  if (hasType(schema, 'object') && isPlainObject(value)) {
    return checkObject(schema, value, path);
  }
  if (hasType(schema, 'array') && Array.isArray(value)) {
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

// ---------------------------------------------------------------------------
// Local files (paths on the machine running this MCP server)
// ---------------------------------------------------------------------------

const MAX_PATCH_BYTES = 1024 * 1024;
const UTF8_BOM_BYTES = 3;
const REUPLOAD_HINT = "Inspect the target's hash with lswb_host_stat before deciding whether to re-upload.";

function localFileUnavailable(message, details) {
  return toolError('local_file_unavailable', message, details);
}

// Resolves localPath to a regular file: { path, size } or { error: toolResult }.
function resolveLocalFile(localPath) {
  let real;
  let stat;
  try {
    real = fs.realpathSync(localPath);
    stat = fs.statSync(real);
  } catch (error) {
    return { error: localFileUnavailable('localPath cannot be read on the machine running this MCP server.', { errno: error.code }) };
  }
  if (!stat.isFile()) {
    return { error: localFileUnavailable('localPath must resolve to a regular file.') };
  }
  return { path: real, size: stat.size };
}

function validateLocalPathTool(inputSchema) {
  return args => {
    const problem = validateAgainstSchema(inputSchema, args);
    if (problem) {
      return problem;
    }
    if (!nodePath.isAbsolute(args.localPath)) {
      return 'localPath must be an absolute path on the machine running this MCP server.';
    }
    return null;
  };
}

function patchTooLarge() {
  return toolError('invalid_patch', 'Supply a text patch of at most 1 MiB.');
}

function readPatchText(file) {
  if (file.size > MAX_PATCH_BYTES + UTF8_BOM_BYTES) {
    return { error: patchTooLarge() };
  }
  let patch;
  try {
    patch = fs.readFileSync(file.path, 'utf8');
  } catch (error) {
    return { error: localFileUnavailable('localPath cannot be read on the machine running this MCP server.', { errno: error.code }) };
  }
  patch = patch.replace(/^﻿/u, '');
  if (Buffer.byteLength(patch, 'utf8') > MAX_PATCH_BYTES) {
    return { error: patchTooLarge() };
  }
  return { patch };
}

async function applyPatchFile(args) {
  const file = resolveLocalFile(args.localPath);
  if (file.error) {
    return file.error;
  }
  const read = readPatchText(file);
  if (read.error) {
    return read.error;
  }
  const fields = { workspace: args.workspace, patch: read.patch };
  if (args.checkOnly !== undefined) {
    fields.checkOnly = args.checkOnly;
  }
  return callGuest('applyPatch', fields);
}

// ---------------------------------------------------------------------------
// Chunked upload (cli.uploadTransfer over the remembered binding)
// ---------------------------------------------------------------------------

function extensionFailure(error) {
  const failure = new Error((error && error.message) || 'The bridge rejected the request.');
  failure.extensionError = error;
  return failure;
}

// Builds call(body) for uploadTransfer and records the first failing transfer step.
// transferAbort is cleanup only, so its own outcome never replaces the real failure.
function boundCall(binding, root, tracker) {
  const target = { id: binding.instance, pipeName: binding.pipeName };
  return async body => {
    if (body.op !== 'transferAbort') {
      tracker.lastOp = body.op;
    }
    let response;
    try {
      response = await request(target, buildBody(body.op, binding, { workspace: root, ...body }), REQUEST_TIMEOUT_MS);
    } catch (error) {
      error.transport = true;
      throw error;
    }
    if (!response || response.ok !== true) {
      throw extensionFailure(response && response.error);
    }
    if (body.op === 'transferCommit') {
      tracker.committed = true;
    }
    return response.result;
  };
}

function commitOutcomeUnknown(error) {
  const details = { requestSent: error.requestSent, stage: 'transferCommit' };
  if (error.transportCode) {
    details.transportCode = error.transportCode;
  }
  const message = `${error.message || 'Bridge transport failed.'} ${REUPLOAD_HINT}`;
  return toolError('transport_outcome_unknown', message, details);
}

function mapUploadError(root, error, tracker) {
  if (error.extensionError !== undefined) {
    return mapExtensionError(root, error.extensionError);
  }
  if (error.transport) {
    if (tracker.lastOp === 'transferCommit' && transportCode(error) === 'transport_outcome_unknown') {
      return commitOutcomeUnknown(error);
    }
    return mapTransportError(error);
  }
  if (tracker.committed) {
    return toolError('upload_integrity_failed', `${error.message} ${REUPLOAD_HINT}`);
  }
  if (tracker.lastOp === null) {
    return localFileUnavailable(error.message || 'localPath cannot be read.', { errno: error.code });
  }
  return toolError('local_file_changed', `${error.message || 'Local upload source changed.'} The upload was aborted; nothing was committed.`);
}

async function uploadFile(args) {
  const file = resolveLocalFile(args.localPath);
  if (file.error) {
    return file.error;
  }
  const binding = await resolveBinding(args.workspace);
  if (!binding) {
    return workspaceNotFound(args.workspace);
  }
  const tracker = { lastOp: null, committed: false };
  const options = {
    input: file.path,
    path: args.path,
    overwrite: args.overwrite === true,
    expectedCurrentSha256: args.expectedCurrentSha256,
  };
  try {
    const result = await uploadTransfer(boundCall(binding, args.workspace, tracker), options);
    return toolResult(result, false);
  } catch (error) {
    return mapUploadError(args.workspace, error, tracker);
  }
}

// ---------------------------------------------------------------------------
// Host tool table
// ---------------------------------------------------------------------------

const HOST_NOTE = 'Uses the Host channel: the Host must share a read/write PowerShell terminal '
  + 'and terminal.enabled must be on in the bridge settings; check with lswb_host_status.';
const HOST_PATH = text('Workspace-relative path with forward slashes, resolved on the Host.');
const LOCAL_PATH = text('Absolute path on the machine running this MCP server, not a workspace path.');
const LOCAL_PATH_NOTE = 'localPath is a path on the machine running this MCP server, not a workspace path; '
  + 'it must be absolute (relative paths are rejected as invalid params, -32602) and resolve to a regular file, '
  + 'otherwise the result is local_file_unavailable.';
const MUTATION_NOTE = 'On transport_outcome_unknown the mutation may have happened; inspect before retrying. Nothing is replayed automatically.';
const GLOBS = {
  type: ['string', 'array'],
  items: { type: 'string' },
  description: 'A glob or an array of at most 100 globs.',
};
const JOB_ID = text('jobId returned by lswb_host_exec.');
const PARENTS = bool('Create missing parent directories (needs mkdir permission). Default true when mkdir is permitted.');
const SAVED_ONLY = 'Results cover saved Host disk files only; dirty editor buffers are neither saved nor merged. '
  + 'Check complete, truncated and unsavedDocuments before relying on the result.';

const HOST_OPERATION_TOOLS = [
  guestTool({
    name: 'lswb_host_status',
    op: 'hostStatus',
    description: describe(
      'Report whether the Host channel is available and bound for a workspace, plus eligible shared terminal candidates',
      'and the portForward handshake (state idle, starting, waitingForward, bound, failed or cancelled, with hostPort, guestPort, message and code).',
      'WHEN TO USE: Before any other Host tool, after a host_channel_uncertain error, and in portForward mode',
      'repeatedly after lswb_host_bind until bound:true (or the handshake shows failed/cancelled). It answers immediately, even mid-handshake.',
      'Read-only. The Host channel needs the Host to share a read/write PowerShell terminal and terminal.enabled turned on.',
    ),
  }),
  guestTool({
    name: 'lswb_host_bind',
    op: 'hostBind',
    description: describe(
      'Bind the Host channel to the shared Host terminal for this workspace (a random handshake file verifies the Host root).',
      'WHEN TO USE: When lswb_host_status reports bound:false, or to recover after host_channel_uncertain.',
      'In portForward mode this is step one of two: it returns bound:false with handshake.state waitingForward, hostPort and next',
      'once the Host helper listens. Ask the Host to run "Live Share: Share Server" for hostPort, then poll lswb_host_status until bound.',
      'Calling it again during the handshake only reports the same state. Other Host tools return host_handshake_pending meanwhile;',
      'do not retry them to wait. After failed/cancelled, ask the Host to press Ctrl+C on any old helper before binding again.',
      'acknowledgeRecovery:true may only be used after the user has inspected the Host terminal and confirmed it is idle;',
      'no earlier command is ever replayed automatically.',
      HOST_NOTE,
    ),
    properties: {
      hostWorkspacePath: text('Optional Host workspace path for the shared root; otherwise the terminal current directory is verified.'),
      acknowledgeRecovery: bool('Rebind after an uncertain Host outcome. Only after the user inspected the Host.'),
    },
  }),
  guestTool({
    name: 'lswb_search',
    op: 'search',
    description: describe(
      'Search the text of saved files on the Host (ripgrep-style), with include/exclude globs.',
      'WHEN TO USE: Complete content search across the workspace.',
      SAVED_ONLY,
      HOST_NOTE,
    ),
    properties: {
      query: text('Search text or regular expression, 1..10000 characters.'),
      include: GLOBS,
      exclude: GLOBS,
      regex: bool('Treat query as a regular expression. Default false.'),
      caseSensitive: bool('Case-sensitive match. Default false.'),
      wholeWord: bool('Match whole words only. Default false.'),
      useExcludes: bool('Apply the default excludes. Default true.'),
      limit: int('Maximum results, 1..10000. Default 500.'),
    },
    required: ['query'],
  }),
  guestTool({
    name: 'lswb_find_files',
    op: 'findFiles',
    description: describe(
      'Find saved Host file paths matching glob patterns.',
      'WHEN TO USE: Locate files by name or extension across the workspace.',
      SAVED_ONLY,
      HOST_NOTE,
    ),
    properties: {
      pattern: GLOBS,
      exclude: GLOBS,
      useExcludes: bool('Apply the default excludes. Default true.'),
      limit: int('Maximum results, 1..10000. Default 500.'),
    },
  }),
  guestTool({
    name: 'lswb_host_stat',
    op: 'hostStat',
    description: describe(
      'Return Host disk metadata for a path, optionally the raw-byte SHA-256 (withHash) and editor text states (withTextHash).',
      'WHEN TO USE: Verify a Host file after a copy, upload or uncertain mutation. Read-only.',
      HOST_NOTE,
    ),
    properties: {
      path: HOST_PATH,
      withHash: bool('Include the SHA-256 of the raw Host bytes (needs readBytes permission).'),
      withTextHash: bool('Also inspect open editor text state for this path (needs read permission).'),
    },
    required: ['path'],
  }),
  guestTool({
    name: 'lswb_copy',
    op: 'copy',
    description: describe(
      'Copy a single file byte-for-byte on the Host.',
      'WHEN TO USE: Duplicate a file, including binary files. Rejected when source or destination has unsaved documents.',
      'overwrite:true replaces an existing destination and needs write permission.',
      MUTATION_NOTE,
      HOST_NOTE,
    ),
    properties: {
      path: HOST_PATH,
      to: text('Workspace-relative destination path.'),
      overwrite: bool('Replace an existing destination. Default false.'),
      parents: PARENTS,
    },
    required: ['path', 'to'],
  }),
  guestTool({
    name: 'lswb_copy_dir',
    op: 'copyDirectory',
    description: describe(
      'Copy a directory tree on the Host. The destination must not exist; merging or replacing is not supported.',
      'WHEN TO USE: Duplicate a directory.',
      MUTATION_NOTE,
      HOST_NOTE,
    ),
    properties: {
      path: HOST_PATH,
      to: text('Workspace-relative destination path; must not exist.'),
      parents: PARENTS,
    },
    required: ['path', 'to'],
  }),
  guestTool({
    name: 'lswb_read_bytes',
    op: 'readBytes',
    description: describe(
      'Read a saved Host file as base64 with its size and SHA-256.',
      'WHEN TO USE: Read small binary files. Limited to transfer.chunkBytes (default 32 KiB);',
      'larger files cannot be read because large downloads are not implemented. Read-only.',
      HOST_NOTE,
    ),
    properties: { path: HOST_PATH },
    required: ['path'],
  }),
  guestTool({
    name: 'lswb_write_bytes',
    op: 'writeBytes',
    description: describe(
      'Write base64 bytes to a Host file in one request (at most transfer.chunkBytes).',
      'WHEN TO USE: Write small binary files; use lswb_upload_file for larger local files.',
      'overwrite:true needs write permission; expectedCurrentSha256 guards the current content.',
      MUTATION_NOTE,
      HOST_NOTE,
    ),
    properties: {
      path: HOST_PATH,
      base64: text('Canonical base64 of the full file content.'),
      overwrite: bool('Replace an existing file. Default false.'),
      expectedCurrentSha256: text('SHA-256 the existing file must have (from lswb_host_stat withHash).'),
      parents: PARENTS,
    },
    required: ['path', 'base64'],
  }),
  guestTool({
    name: 'lswb_host_exec',
    op: 'hostExec',
    description: describe(
      'Start a command in a bounded Host PowerShell child process.',
      'WHEN TO USE: Build, test or run tools on the Host. Needs every other operation permission.',
      'The result state may be running: poll with lswb_host_job_poll until it ends. state completed does not mean exit code 0; check exitCode.',
      'When the command is known to change files, pass them as affectedPaths so editor state is refreshed;',
      'otherwise fileChanges is not_tracked.',
      MUTATION_NOTE,
      HOST_NOTE,
    ),
    properties: {
      command: text('PowerShell command, 1..8000 characters.'),
      cwd: text('Workspace-relative working directory. Default the workspace root.'),
      timeoutMs: int('Child timeout 1000..3600000 ms. Default terminal.commandTimeoutMs.'),
      waitMs: int('How long to wait for completion before returning running, 0..5000 ms. Default 1000.'),
      affectedPaths: { type: 'array', items: { type: 'string' }, description: 'Up to 100 workspace-relative paths the command changes.' },
    },
    required: ['command'],
  }),
  guestTool({
    name: 'lswb_host_job_poll',
    op: 'hostJobPoll',
    description: describe(
      'Poll a Host job started by lswb_host_exec for state, exit code and output.',
      'WHEN TO USE: While a job is running. Pass the returned stdout/stderr offsets to fetch only new output.',
      HOST_NOTE,
    ),
    properties: {
      jobId: JOB_ID,
      waitMs: int('Wait up to 0..5000 ms for completion. Default 0.'),
      stdoutOffset: int('Character offset of stdout already read. Default 0.'),
      stderrOffset: int('Character offset of stderr already read. Default 0.'),
    },
    required: ['jobId'],
  }),
  guestTool({
    name: 'lswb_host_job_cancel',
    op: 'hostJobCancel',
    description: describe(
      'Cancel a running Host job; only the bridge-owned process tree is terminated.',
      'WHEN TO USE: Stop a job that hangs or is no longer needed.',
      HOST_NOTE,
    ),
    properties: { jobId: JOB_ID },
    required: ['jobId'],
  }),
  guestTool({
    name: 'lswb_host_job_forget',
    op: 'hostJobForget',
    description: describe(
      'Release a finished Host job and its retained output.',
      'WHEN TO USE: After reading the final result. Jobs with affectedPaths must be polled to completion first.',
      HOST_NOTE,
    ),
    properties: { jobId: JOB_ID },
    required: ['jobId'],
  }),
  guestTool({
    name: 'lswb_apply_patch',
    op: 'applyPatch',
    description: describe(
      'Apply a Git unified-diff text patch (a/ and b/ prefixes, 1..100 files, at most 1 MiB) on the Host.',
      'WHEN TO USE: Multi-file changes; run with checkOnly:true first. Binary, symlink and submodule patches are rejected.',
      'Needs edit, create, delete and move permissions; target files must not have unsaved documents.',
      MUTATION_NOTE,
      HOST_NOTE,
    ),
    properties: {
      patch: text('Unified diff text.'),
      checkOnly: bool('Only check that the patch applies. Default false.'),
    },
    required: ['patch'],
  }),
];

function localPathTool({ name, description, properties, required, handler }) {
  const tool = guestTool({ name, description, properties, required, handler });
  tool.validate = validateLocalPathTool(tool.inputSchema);
  return tool;
}

const LOCAL_FILE_TOOLS = [
  localPathTool({
    name: 'lswb_apply_patch_file',
    description: describe(
      'Apply a Git unified-diff patch read from a local file (UTF-8, BOM removed, at most 1 MiB) on the Host.',
      'WHEN TO USE: Patches too large or awkward to pass inline; same rules as lswb_apply_patch.',
      LOCAL_PATH_NOTE,
      MUTATION_NOTE,
      HOST_NOTE,
    ),
    properties: {
      localPath: LOCAL_PATH,
      checkOnly: bool('Only check that the patch applies. Default false.'),
    },
    required: ['localPath'],
    handler: applyPatchFile,
  }),
  localPathTool({
    name: 'lswb_upload_file',
    description: describe(
      'Upload a local file to a Host workspace path in transfer.chunkBytes chunks, verified by SHA-256.',
      'WHEN TO USE: Copy any local file (binary or large) into the workspace.',
      LOCAL_PATH_NOTE,
      'Any failed step is followed by a best-effort abort; the commit is never retried.',
      'The result contains bytes, sha256 and written.',
      'If the commit outcome is unknown (transport_outcome_unknown), inspect the target hash with lswb_host_stat before re-uploading.',
      HOST_NOTE,
    ),
    properties: {
      localPath: LOCAL_PATH,
      path: text('Workspace-relative destination path on the Host.'),
      overwrite: bool('Replace an existing file (needs write permission). Default false.'),
      expectedCurrentSha256: text('SHA-256 the existing file must have (from lswb_host_stat withHash).'),
    },
    required: ['localPath', 'path'],
    handler: uploadFile,
  }),
];

const HOST_TOOLS = [...HOST_OPERATION_TOOLS, ...LOCAL_FILE_TOOLS];

const TOOLS = [LIST_WORKSPACES_TOOL, ...FILE_TOOLS, ...LANGUAGE_TOOLS, ...HOST_TOOLS];

module.exports = {
  TOOLS,
  HOST_TOOLS,
  registryDir,
  validateAgainstSchema,
  refreshBindings,
  getBinding,
  bindingRoots,
  clearBindings,
  BINDING_CODES,
  REQUEST_TIMEOUT_MS,
};
