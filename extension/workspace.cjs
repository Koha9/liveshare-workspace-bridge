'use strict';
const { fail, integer, textHash, relativePath, normalizeEol, chooseEol, precheck, planChanges } = require('./core.cjs');
const { createPermissions, NAMESPACE, RENAMED_SETTINGS } = require('./permissions.cjs');
const { createHostChannel } = require('./host-channel.cjs');
const { createHostOperations, OPERATIONS: HOST_OPERATIONS } = require('./host-operations.cjs');

// Settings whose change invalidates the Host binding. The portForward tuning
// keys (host.guestPort and the helper timeouts) are read when used instead,
// so editing guestPort during a handshake must not drop it.
const HOST_BINDING_SECTIONS = [
  ...Object.keys(RENAMED_SETTINGS).map(key => `${NAMESPACE}.${key}`),
  `${NAMESPACE}.terminal`,
  `${NAMESPACE}.transfer`,
  `${NAMESPACE}.agent.enabled`,
];

function affectsHostBinding(event) {
  return HOST_BINDING_SECTIONS.some(section => event?.affectsConfiguration?.(section) === true);
}

const GUEST_OPERATIONS = [
  'info', 'list', 'read', 'readMany', 'create', 'write', 'edit', 'save', 'mkdir', 'stat', 'move', 'delete',
  'diagnostics', 'symbols', 'definition', 'references', 'renameSymbol', 'format', 'workspaceSymbols',
  'findFilesSnapshot', 'searchSnapshot', 'searchResults', 'providerRead',
];
const OPERATIONS = [...new Set([...GUEST_OPERATIONS, ...HOST_OPERATIONS])];

// Operations whose path may be omitted or empty to target the workspace root.
const ROOT_TARGET_OPERATIONS = ['list', 'stat', 'findFilesSnapshot', 'searchSnapshot', 'searchResults', 'diagnostics'];

const READ_LIMIT_BYTES = 1024 * 1024;
const MAX_POSITION = 10000000;
const SEARCH_WARNING = 'Current Search View snapshot; no completion signal. User changes to the Search View are not tracked.';
const FIND_FILES_WARNING = 'Live Share may omit new files; an empty result does not prove absence.';

// ---------------------------------------------------------------------------
// URI helpers (vsls: URIs only; never Node filesystem paths)
// ---------------------------------------------------------------------------

function withoutTrailingSlash(value) {
  return value.replace(/\/$/u, '');
}

function sameAuthority(a, b) {
  return a.scheme === b.scheme && a.authority === b.authority;
}

function isBelowPath(candidatePath, basePath) {
  return candidatePath.startsWith(withoutTrailingSlash(basePath) + '/');
}

// True when candidate is base itself or lies below it.
function isAtOrBelow(candidate, base) {
  if (!sameAuthority(candidate, base)) {
    return false;
  }
  return candidate.path === base.path || isBelowPath(candidate.path, base.path);
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function createWorkspaceApi(vscode, identity, services = {}) {
  let searchId = 0;
  let lastSearch = null;
  const permissions = services.permissions || createPermissions(vscode);
  const host = services.host || createHostChannel(vscode, identity, permissions);
  const externallyChanged = new Map();

  // -------------------------------------------------------------------------
  // Roots, path resolution and serialization
  // -------------------------------------------------------------------------

  function roots() {
    return (vscode.workspace.workspaceFolders || []).filter(folder => folder.uri.scheme === 'vsls');
  }

  function rootInfo() {
    return roots().map(folder => ({ name: folder.name, uri: folder.uri.toString() }));
  }

  function selectedRoot(r) {
    return roots().find(folder => folder.uri.toString() === r.workspace);
  }

  function resolve(r, value = r.path, allowRoot = false) {
    const root = selectedRoot(r);
    if (!root) {
      fail('workspace_mismatch', 'workspace must exactly match a current Live Share root URI.');
    }
    const clean = relativePath(value, allowRoot);
    if (!clean && !allowRoot) {
      fail('invalid_path', 'This operation cannot target the workspace root.');
    }
    const uri = vscode.Uri.joinPath(root.uri, clean);
    if (!isAtOrBelow(uri, root.uri)) {
      fail('outside_workspace', 'Path is outside the selected workspace.');
    }
    return { uri, root, clean };
  }

  function eolName(doc) {
    return doc.eol === vscode.EndOfLine.CRLF ? 'CRLF' : 'LF';
  }

  function eolText(doc) {
    return doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  }

  function meta(doc, hash = false) {
    const result = {
      uri: doc.uri.toString(),
      version: doc.version,
      dirty: doc.isDirty,
      lineCount: doc.lineCount,
      eol: eolName(doc),
    };
    if (hash) {
      result.hash = textHash(doc.getText());
    }
    return result;
  }

  function serialize(value) {
    if (value instanceof vscode.Uri) {
      return value.toString();
    }
    if (value instanceof vscode.Position) {
      return { line: value.line, character: value.character };
    }
    if (value instanceof vscode.Range) {
      return { start: serialize(value.start), end: serialize(value.end) };
    }
    if (Array.isArray(value)) {
      return value.map(serialize);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
    }
    return value;
  }

  function rejectDirty(uri) {
    const dirty = vscode.workspace.textDocuments.some(doc => doc.isDirty && isAtOrBelow(doc.uri, uri));
    if (dirty) {
      fail('dirty_document', 'The source or destination has unsaved documents.');
    }
  }

  // -------------------------------------------------------------------------
  // External (Host) change tracking
  // -------------------------------------------------------------------------

  function normalizedTextHash(text) {
    return textHash(text.replace(/^﻿/u, '').replace(/\r\n|\r/gu, '\n'));
  }

  // Plain path-prefix lookup, as before: the first root whose path prefixes uri.
  function rootContaining(uri) {
    return roots().find(folder => uri.path.startsWith(folder.uri.path)).uri;
  }

  function noteExternalChange(uri, selectedRootUri) {
    const observed = [];
    const expectedEpoch = identity.epoch();
    const root = selectedRootUri || rootContaining(uri);
    for (const doc of vscode.workspace.textDocuments) {
      if (isAtOrBelow(doc.uri, uri)) {
        const relative = doc.uri.path.slice(withoutTrailingSlash(root.path).length + 1);
        externallyChanged.set(doc.uri.toString(), { expectedHash: null });
        observed.push({ doc, relative });
      }
    }
    const finish = textStates => {
      if (identity.epoch() !== expectedEpoch) {
        return;
      }
      for (const item of observed) {
        settleExternalChange(item, textStates?.[item.relative] || null);
      }
    };
    finish.paths = observed.map(item => item.relative);
    return finish;
  }

  function settleExternalChange(item, expectedHash) {
    const key = item.doc.uri.toString();
    if (expectedHash && normalizedTextHash(item.doc.getText()) === expectedHash) {
      externallyChanged.delete(key);
    } else {
      externallyChanged.set(key, { expectedHash });
    }
  }

  // Waits up to 1200 ms for the Guest model to reach the expected Host text.
  function waitForHostText(doc, matches) {
    return new Promise(resolve => {
      const listener = vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document === doc && matches()) {
          clearTimeout(timer);
          listener.dispose();
          resolve();
        }
      });
      const timer = setTimeout(() => {
        listener.dispose();
        resolve();
      }, 1200);
    });
  }

  async function reconcileExternalChange(doc, previous) {
    const matches = () => previous.expectedHash && normalizedTextHash(doc.getText()) === previous.expectedHash;
    if (matches()) {
      return;
    }
    if (doc.isDirty) {
      fail('external_change_dirty_document', 'Host changed a file while its Guest buffer became dirty. Preserve the buffer and resolve the conflict.');
    }
    if (vscode.workspace.onDidChangeTextDocument) {
      await waitForHostText(doc, matches);
    }
    if (!matches()) {
      fail('editor_refresh_pending', 'Host changed this file but the Guest document has not reloaded yet. '
        + 'Preserve the buffer; use an explicit Host byte read or reopen the document before another text edit.');
    }
    if (doc.isDirty) {
      fail('external_change_dirty_document', 'Guest buffer changed while waiting for the Host update. Preserve it and resolve the conflict.');
    }
  }

  // -------------------------------------------------------------------------
  // Opening documents
  // -------------------------------------------------------------------------

  function isFileNotFound(error) {
    if (!error) {
      return false;
    }
    if (error.code === 'FileNotFound' || error.code === 'EntryNotFound') {
      return true;
    }
    return typeof error.name === 'string' && /^(?:EntryNotFound|FileNotFound)\b/u.test(error.name);
  }

  // VS Code rejects openTextDocument for a missing file with a plain Error, so
  // only after a failed read open is the provider asked whether the file exists.
  async function missingFile(uri, openError) {
    if (isFileNotFound(openError)) {
      return true;
    }
    try {
      await vscode.workspace.fs.stat(uri);
      return false;
    } catch (statError) {
      return isFileNotFound(statError);
    }
  }

  async function openDocument(uri, classifyMissing) {
    try {
      return await vscode.workspace.openTextDocument(uri);
    } catch (error) {
      if (classifyMissing && await missingFile(uri, error)) {
        fail('not_found', 'The file does not exist in the selected workspace.');
      }
      throw error;
    }
  }

  async function document(uri, classifyMissing = false) {
    const doc = await openDocument(uri, classifyMissing);
    const previous = externallyChanged.get(uri.toString());
    if (previous !== undefined) {
      await reconcileExternalChange(doc, previous);
      externallyChanged.delete(uri.toString());
    }
    return doc;
  }

  const hostOperations = createHostOperations({ vscode, host, permissions, resolve, rejectDirty, noteExternalChange });

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  async function read(r) {
    const { uri } = resolve(r);
    const doc = await document(uri, true);
    const start = integer(r.startLine ?? 1, 'startLine', 1, doc.lineCount);
    const end = integer(r.endLine ?? doc.lineCount, 'endLine', start, doc.lineCount);
    const range = new vscode.Range(start - 1, 0, end - 1, doc.lineAt(end - 1).text.length);
    const text = doc.getText(range);
    if (Buffer.byteLength(text, 'utf8') > READ_LIMIT_BYTES) {
      fail('response_limit', 'Read a smaller line range (1 MiB text limit).');
    }
    return { ...meta(doc, r.withHash === true), startLine: start, endLine: end, text };
  }

  async function readEntry(r, file) {
    try {
      return { ok: true, result: await read({ ...r, ...file, workspace: r.workspace }) };
    } catch (err) {
      return { ok: false, path: file.path, error: { code: err.code || 'vscode_error', message: err.message } };
    }
  }

  async function readMany(r) {
    if (!Array.isArray(r.files) || !r.files.length || r.files.length > 50) {
      fail('invalid_argument', 'files must contain 1..50 read requests.');
    }
    const results = [];
    for (const file of r.files) {
      results.push(await readEntry(r, file));
    }
    return { files: results };
  }

  // -------------------------------------------------------------------------
  // Saving and text edits
  // -------------------------------------------------------------------------

  async function parents(uri) {
    const parent = vscode.Uri.joinPath(uri, '..');
    const root = roots().find(folder => isAtOrBelow(parent, folder.uri));
    if (!root) {
      fail('outside_workspace', 'Parent is outside the workspace.');
    }
    if (parent.path !== root.uri.path) {
      permissions.assert('mkdir');
      await vscode.workspace.fs.createDirectory(parent);
    }
  }

  // Saves one target document; a failed save is reported per document, never thrown.
  async function saveResult(doc, extra = {}) {
    try {
      permissions.assert('save');
      const saved = await doc.save();
      const failure = saved
        ? {}
        : { error: { code: 'save_failed', message: 'Document.save() returned false; applied text remains in the editor.' } };
      return { ...extra, saved, ...meta(doc), ...failure };
    } catch (err) {
      return { ...extra, saved: false, ...meta(doc), error: { code: err.code || 'save_failed', message: err.message } };
    }
  }

  function allSaved(results) {
    return results.every(result => result.saved && !result.dirty);
  }

  function assertEpoch(r, message) {
    if (r.epoch !== undefined && r.epoch !== identity.epoch()) {
      fail('workspace_changed', message);
    }
  }

  function planFileEdits(doc, file, rewrite) {
    const original = doc.getText();
    const eol = eolText(doc);
    if (rewrite) {
      if (typeof file.text !== 'string') {
        fail('invalid_argument', 'text must be a string.');
      }
      return [{ start: 0, end: original.length, text: normalizeEol(file.text, eol) }];
    }
    const guarded = file.expectedVersion !== undefined || file.expectedHash !== undefined;
    return planChanges(original, file.changes, eol, guarded);
  }

  async function planEditTargets(r, files, rewrite) {
    const seen = new Set();
    const plans = [];
    for (const file of files) {
      if (!file || typeof file !== 'object') {
        fail('invalid_argument', 'Each file must be an object.');
      }
      const { uri } = resolve(r, file.path);
      if (seen.has(uri.toString())) {
        fail('duplicate_file', 'Merge changes for the same file into one entry.');
      }
      seen.add(uri.toString());
      const doc = await document(uri);
      precheck(doc, file, rewrite);
      const edits = planFileEdits(doc, file, rewrite);
      plans.push({ doc, uri, edits, version: doc.version });
    }
    return plans;
  }

  function buildTextEdit(plans) {
    const wsEdit = new vscode.WorkspaceEdit();
    for (const plan of plans) {
      if (plan.doc.version !== plan.version) {
        fail('content_changed', 'A document changed during batch preflight.');
      }
      for (const edit of plan.edits) {
        const range = new vscode.Range(plan.doc.positionAt(edit.start), plan.doc.positionAt(edit.end));
        wsEdit.replace(plan.uri, range, edit.text);
      }
    }
    return wsEdit;
  }

  async function editFiles(r, rewrite = false) {
    const files = rewrite ? [r] : r.files;
    if (!Array.isArray(files) || !files.length || files.length > 100) {
      fail('invalid_argument', 'files must contain 1..100 documents.');
    }
    const plans = await planEditTargets(r, files, rewrite);
    permissions.assert(rewrite ? 'write' : 'edit');
    assertEpoch(r, 'Workspace changed during edit preflight.');
    const wsEdit = buildTextEdit(plans);
    const applied = await vscode.workspace.applyEdit(wsEdit);
    if (!applied) {
      return {
        applied: false,
        saved: false,
        files: plans.map(plan => ({ ...meta(plan.doc), saved: false })),
        error: { code: 'apply_failed', message: 'workspace.applyEdit() returned false.' },
      };
    }
    const results = [];
    for (const plan of plans) {
      results.push(await saveResult(plan.doc, { changes: plan.edits.length }));
    }
    return { applied: true, saved: allSaved(results), files: results };
  }

  // -------------------------------------------------------------------------
  // Language edits (rename, format)
  // -------------------------------------------------------------------------

  async function renameEntries(r, uri, position) {
    if (typeof r.newName !== 'string' || !r.newName || r.newName.length > 256) {
      fail('invalid_argument', 'newName must contain 1..256 characters.');
    }
    const rename = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', uri, position, r.newName);
    if (!rename) {
      fail('provider_unavailable', 'The language provider returned no symbol rename.');
    }
    return rename.entries();
  }

  async function formatEntries(r, uri) {
    const options = { tabSize: integer(r.tabSize ?? 2, 'tabSize', 1, 16), insertSpaces: r.insertSpaces !== false };
    const edits = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', uri, options);
    if (!edits) {
      fail('provider_unavailable', 'No document formatting provider returned edits.');
    }
    return [[uri, edits]];
  }

  // Language edits may only change files strictly below the selected root.
  function assertLanguageTarget(r, target) {
    const root = selectedRoot(r);
    if (!sameAuthority(target, root.uri) || !isBelowPath(target.path, root.uri.path)) {
      fail('outside_workspace', 'Language edits cannot change files outside the selected root.');
    }
  }

  async function planLanguageTarget(r, target, changes, edit) {
    assertLanguageTarget(r, target);
    const doc = await document(target);
    precheck(doc, { allowDirty: r.allowDirty });
    const version = doc.version;
    const eol = eolText(doc);
    for (const change of changes) {
      if (!change.range || typeof change.newText !== 'string') {
        fail('unsupported_language_edit', 'Only text-range language edits are supported.');
      }
      edit.replace(target, change.range, normalizeEol(change.newText, eol));
    }
    const planned = changes.map(change => ({ range: serialize(change.range), newText: change.newText }));
    return { doc, version, changes: planned };
  }

  async function languageEntries(r, uri, initial) {
    const line = integer(r.line ?? 1, 'line', 1, initial.lineCount);
    const character = integer(r.character ?? 0, 'character', 0, initial.lineAt(line - 1).text.length);
    const position = new vscode.Position(line - 1, character);
    if (r.op === 'renameSymbol') {
      return renameEntries(r, uri, position);
    }
    return formatEntries(r, uri);
  }

  async function applyLanguageEdit(r, plans, edit) {
    assertEpoch(r, 'Workspace changed during language-edit preflight.');
    permissions.assert(r.op);
    for (const plan of plans) {
      if (plan.doc.version !== plan.version) {
        fail('content_changed', 'A language-edit target changed before apply.');
      }
    }
    if (!plans.some(plan => plan.changes.length)) {
      return { applied: true, saved: true, files: [], textOnly: true };
    }
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      return { applied: false, saved: false, textOnly: true };
    }
    const files = [];
    for (const plan of plans) {
      permissions.assert(r.op);
      files.push(await saveResult(plan.doc));
    }
    return { applied: true, saved: allSaved(files), files, textOnly: true, fileOperationsApplied: false };
  }

  async function languageEdit(r) {
    const { uri } = resolve(r);
    const initial = await document(uri);
    precheck(initial, r);
    const entries = await languageEntries(r, uri, initial);
    const plans = [];
    const edit = new vscode.WorkspaceEdit();
    for (const [target, changes] of entries) {
      plans.push(await planLanguageTarget(r, target, changes, edit));
    }
    if (r.preview === true) {
      const files = plans.map(plan => ({ ...meta(plan.doc), changes: plan.changes }));
      return { preview: true, textOnly: true, files };
    }
    return applyLanguageEdit(r, plans, edit);
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  function dirtyDocumentsVisible() {
    return permissions.value('agent.enabled', true) && permissions.enabled('read');
  }

  function dirtySharedDocuments() {
    return vscode.workspace.textDocuments
      .filter(doc => doc.uri.scheme === 'vsls' && doc.isDirty)
      .map(doc => doc.uri.toString());
  }

  function info() {
    return {
      id: identity.id,
      epoch: identity.epoch(),
      version: identity.version,
      roots: rootInfo(),
      trusted: vscode.workspace.isTrusted,
      operations: OPERATIONS,
      transport: 'windows-local-pipe',
      ipc: identity.ipc?.() || { mode: 'ownerOnly' },
      permissions: permissions.snapshot(OPERATIONS),
      search: { hostScope: 'saved_host_files', editorSnapshotCompletion: false },
      dirtyDocuments: dirtyDocumentsVisible() ? dirtySharedDocuments() : [],
      dirtyDocumentsOmitted: !dirtyDocumentsVisible(),
    };
  }

  // -------------------------------------------------------------------------
  // Path-targeted operations (resolved before the handler runs)
  // -------------------------------------------------------------------------

  async function listDirectory(r, { uri }) {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    return { uri: uri.toString(), entries: entries.map(([name, type]) => ({ name, type })) };
  }

  async function statPath(r, { uri }) {
    const s = await vscode.workspace.fs.stat(uri);
    return {
      uri: uri.toString(),
      type: s.type,
      size: finiteOrNull(s.size),
      mtime: finiteOrNull(s.mtime),
      ctime: finiteOrNull(s.ctime),
    };
  }

  async function makeDirectory(r, { uri }) {
    await vscode.workspace.fs.createDirectory(uri);
    return { uri: uri.toString(), created: true };
  }

  async function saveDocument(r, { uri }) {
    const doc = await document(uri);
    if (r.expectedVersion === undefined || r.expectedVersion !== doc.version) {
      fail('content_changed', 'Targeted save needs the current expectedVersion.');
    }
    return saveResult(doc);
  }

  function createFileEdit(uri, text, eol) {
    const edit = new vscode.WorkspaceEdit();
    edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
    const lineEnding = eol === '\r\n' ? vscode.EndOfLine.CRLF : vscode.EndOfLine.LF;
    edit.set(uri, [
      vscode.TextEdit.insert(new vscode.Position(0, 0), normalizeEol(text, eol)),
      vscode.TextEdit.setEndOfLine(lineEnding),
    ]);
    return edit;
  }

  async function createFile(r, { uri }) {
    if (typeof r.text !== 'string') {
      fail('invalid_argument', 'text must be a string.');
    }
    rejectDirty(uri);
    if (r.parents !== false) {
      await parents(uri);
    }
    const eol = chooseEol(r.text, r.eol);
    const applied = await vscode.workspace.applyEdit(createFileEdit(uri, r.text, eol));
    if (!applied) {
      return { applied: false, saved: false, uri: uri.toString() };
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    return { applied, ...(await saveResult(doc)) };
  }

  async function movePath(r, { uri }) {
    if (r.overwrite === true) {
      permissions.assert('write');
    }
    const destination = resolve(r, r.to).uri;
    if (destination.toString() === uri.toString()) {
      fail('invalid_argument', 'Source and destination must differ.');
    }
    rejectDirty(uri);
    rejectDirty(destination);
    if (r.parents !== false) {
      await parents(destination);
    }
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(uri, destination, { overwrite: r.overwrite === true, ignoreIfExists: false });
    if (!await vscode.workspace.applyEdit(edit)) {
      return { applied: false, from: uri.toString(), to: destination.toString() };
    }
    return { moved: true, from: uri.toString(), to: destination.toString() };
  }

  async function deletePath(r, { uri }) {
    rejectDirty(uri);
    if (r.recursive === true) {
      fail('not_supported', 'v0.1 supports file and empty-directory deletion only.');
    }
    await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false });
    return { deleted: true, uri: uri.toString() };
  }

  async function providerRead(r, { uri }) {
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.byteLength > READ_LIMIT_BYTES) {
      fail('response_limit', 'Provider verification is limited to 1 MiB.');
    }
    return { uri: uri.toString(), bytes: bytes.byteLength, text: Buffer.from(bytes).toString('utf8') };
  }

  function diagnostics(r, { uri }) {
    return { uri: uri.toString(), diagnostics: serialize(vscode.languages.getDiagnostics(uri)) };
  }

  async function documentSymbols(r, { uri }) {
    const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri);
    return { uri: uri.toString(), symbols: serialize(symbols) };
  }

  function locationQuery(command) {
    return async (r, { uri }) => {
      integer(r.line, 'line', 1, MAX_POSITION);
      integer(r.character ?? 0, 'character', 0, MAX_POSITION);
      const position = new vscode.Position(r.line - 1, r.character ?? 0);
      return { locations: serialize(await vscode.commands.executeCommand(command, uri, position)) };
    };
  }

  async function findFilesSnapshot(r, { root }) {
    if (typeof r.pattern !== 'string' || !r.pattern) {
      fail('invalid_argument', 'pattern is required.');
    }
    const limit = integer(r.limit ?? 100, 'limit', 1, 1000);
    const exclude = r.useExcludes === false ? null : r.exclude ?? undefined;
    const found = await vscode.workspace.findFiles(new vscode.RelativePattern(root, r.pattern), exclude, limit);
    return {
      files: found.map(uri => uri.toString()),
      limit,
      complete: null,
      possiblyCapped: found.length >= limit,
      warning: FIND_FILES_WARNING,
    };
  }

  async function startSearch(r) {
    if (roots().length !== 1) {
      fail('not_supported', 'Search View search is limited to a single Live Share root in v0.1.');
    }
    if (typeof r.query !== 'string' || !r.query) {
      fail('invalid_argument', 'query is required.');
    }
    const waitMs = integer(r.waitMs ?? 800, 'waitMs', 0, 5000);
    searchId += 1;
    lastSearch = { id: searchId, query: r.query, include: r.include ?? '', exclude: r.exclude ?? '' };
    await vscode.commands.executeCommand('workbench.action.findInFiles', {
      query: r.query,
      filesToInclude: lastSearch.include,
      filesToExclude: lastSearch.exclude,
      isRegex: r.regex === true,
      isCaseSensitive: r.caseSensitive === true,
      triggerSearch: true,
      onlyOpenEditors: false,
      useExcludeSettingsAndIgnoreFiles: r.useExcludes !== false,
    });
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }

  async function searchResults(r) {
    if (r.searchId !== undefined && r.searchId !== lastSearch?.id) {
      fail('search_changed', 'Another bridge search has been started.');
    }
    const snapshot = await vscode.commands.executeCommand('search.action.getSearchResults');
    const text = typeof snapshot === 'string' ? snapshot : JSON.stringify(serialize(snapshot)) ?? '';
    const maxCharacters = integer(r.maxCharacters ?? 100000, 'maxCharacters', 1, 1000000);
    return {
      search: lastSearch,
      snapshot: text.slice(0, maxCharacters),
      truncated: text.length > maxCharacters,
      complete: null,
      correlation: 'best_effort',
      warning: SEARCH_WARNING,
    };
  }

  async function searchSnapshot(r) {
    await startSearch(r);
    return searchResults(r);
  }

  const PATH_OPERATIONS = {
    list: listDirectory,
    stat: statPath,
    mkdir: makeDirectory,
    save: saveDocument,
    create: createFile,
    move: movePath,
    delete: deletePath,
    providerRead,
    diagnostics,
    symbols: documentSymbols,
    definition: locationQuery('vscode.executeDefinitionProvider'),
    references: locationQuery('vscode.executeReferenceProvider'),
    findFilesSnapshot,
    searchSnapshot,
    searchResults,
  };

  async function pathOperation(r) {
    const target = resolve(r, r.path ?? '', ROOT_TARGET_OPERATIONS.includes(r.op));
    const handler = Object.prototype.hasOwnProperty.call(PATH_OPERATIONS, r.op) ? PATH_OPERATIONS[r.op] : null;
    if (!handler) {
      return undefined;
    }
    return handler(r, target);
  }

  // -------------------------------------------------------------------------
  // Dispatch
  // -------------------------------------------------------------------------

  async function workspaceSymbols(r) {
    resolve(r, '', true);
    if (typeof r.query !== 'string') {
      fail('invalid_argument', 'query is required.');
    }
    const symbols = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', r.query);
    return { symbols: serialize(symbols) };
  }

  function assertBinding(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      fail('invalid_request', 'Expected a JSON object.');
    }
    if (r.instance !== undefined && r.instance !== identity.id) {
      fail('instance_mismatch', 'The selected VS Code instance changed.');
    }
    assertEpoch(r, 'Workspace changed since discovery; rediscover the instance.');
  }

  // Runs after binding, epoch, operation and permission checks.
  function guestOperation(r) {
    if (r.op === 'renameSymbol' || r.op === 'format') {
      return languageEdit(r);
    }
    if (r.op === 'read') {
      return read(r);
    }
    if (r.op === 'readMany') {
      return readMany(r);
    }
    if (r.op === 'write') {
      return editFiles(r, true);
    }
    if (r.op === 'edit') {
      return editFiles(r);
    }
    if (r.op === 'workspaceSymbols') {
      return workspaceSymbols(r);
    }
    return pathOperation(r);
  }

  async function dispatchOperation(r) {
    assertBinding(r);
    if (r.op === 'info') {
      return info();
    }
    if (r.epoch === undefined) {
      fail('workspace_binding_required', 'Include epoch from instance discovery.');
    }
    if (!OPERATIONS.includes(r.op)) {
      fail('unknown_operation', `Unsupported operation: ${String(r.op)}`);
    }
    if (r.op === 'hostStatus') {
      return hostOperations.dispatch(r);
    }
    permissions.assert(r.op);
    if (HOST_OPERATIONS.includes(r.op)) {
      return hostOperations.dispatch(r);
    }
    return guestOperation(r);
  }

  async function dispatch(r) {
    const result = await dispatchOperation(r);
    if (!['info', 'hostStatus'].includes(r.op)) {
      permissions.assert(r.op);
    }
    assertEpoch(r, 'Workspace changed while this request was in flight; inspect any dispatched mutation.');
    return result;
  }

  return {
    dispatch,
    roots: rootInfo,
    permissions,
    dispose: () => host.dispose(),
    workspaceChanged: () => {
      externallyChanged.clear();
      host.changed(true);
    },
    terminalClosed: terminal => host.terminalClosed?.(terminal),
    configurationChanged: event => host.changed(affectsHostBinding(event)),
  };
}

module.exports = { createWorkspaceApi, OPERATIONS };
