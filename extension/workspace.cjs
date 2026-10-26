'use strict';
const { fail, integer, textHash, relativePath, normalizeEol, chooseEol, precheck, planChanges } = require('./core.cjs');
const { createPermissions } = require('./permissions.cjs');
const { createHostChannel } = require('./host-channel.cjs');
const { createHostOperations, OPERATIONS: HOST_OPERATIONS } = require('./host-operations.cjs');
const OPERATIONS = [...new Set(['info', 'list', 'read', 'readMany', 'create', 'write', 'edit', 'save', 'mkdir', 'stat', 'move', 'delete', 'diagnostics', 'symbols', 'definition', 'references', 'renameSymbol', 'format', 'workspaceSymbols', 'findFilesSnapshot', 'searchSnapshot', 'searchResults', 'providerRead', ...HOST_OPERATIONS])];
function createWorkspaceApi(vscode, identity, services = {}) {
  let searchId = 0, lastSearch = null;
  const permissions = services.permissions || createPermissions(vscode);
  const host = services.host || createHostChannel(vscode, identity, permissions);
  const externallyChanged = new Map();
  const roots = () => (vscode.workspace.workspaceFolders || []).filter(f => f.uri.scheme === 'vsls');
  const rootInfo = () => roots().map(f => ({ name: f.name, uri: f.uri.toString() }));
  function resolve(r, value = r.path, allowRoot = false) {
    const root = roots().find(f => f.uri.toString() === r.workspace);
    if (!root) fail('workspace_mismatch', 'workspace must exactly match a current Live Share root URI.');
    const clean = relativePath(value, allowRoot);
    if (!clean && !allowRoot) fail('invalid_path', 'This operation cannot target the workspace root.');
    const uri = vscode.Uri.joinPath(root.uri, clean);
    if (uri.scheme !== root.uri.scheme || uri.authority !== root.uri.authority || !(uri.path === root.uri.path || uri.path.startsWith(root.uri.path.replace(/\/$/u, '') + '/'))) fail('outside_workspace', 'Path is outside the selected workspace.');
    return { uri, root, clean };
  }
  function meta(doc, hash = false) {
    return { uri: doc.uri.toString(), version: doc.version, dirty: doc.isDirty, lineCount: doc.lineCount, eol: doc.eol === vscode.EndOfLine.CRLF ? 'CRLF' : 'LF', ...(hash ? { hash: textHash(doc.getText()) } : {}) };
  }
  function serialize(value) {
    if (value instanceof vscode.Uri) return value.toString();
    if (value instanceof vscode.Position) return { line: value.line, character: value.character };
    if (value instanceof vscode.Range) return { start: serialize(value.start), end: serialize(value.end) };
    if (Array.isArray(value)) return value.map(serialize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
    return value;
  }
  function rejectDirty(uri) {
    if (vscode.workspace.textDocuments.some(d => d.isDirty && d.uri.scheme === uri.scheme && d.uri.authority === uri.authority && (d.uri.path === uri.path || d.uri.path.startsWith(uri.path.replace(/\/$/u, '') + '/')))) fail('dirty_document', 'The source or destination has unsaved documents.');
  }
  const normalizedTextHash = text => textHash(text.replace(/^\uFEFF/u, '').replace(/\r\n|\r/gu, '\n'));
  function noteExternalChange(uri, selectedRoot) {
    const observed = [];
    const expectedEpoch = identity.epoch();
    const root = selectedRoot || roots().find(f => uri.path.startsWith(f.uri.path)).uri;
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === uri.scheme && doc.uri.authority === uri.authority && (doc.uri.path === uri.path || doc.uri.path.startsWith(uri.path.replace(/\/$/u, '') + '/'))) {
        const relative = doc.uri.path.slice(root.path.replace(/\/$/u, '').length + 1);
        externallyChanged.set(doc.uri.toString(), { expectedHash: null }); observed.push({ doc, relative });
      }
    }
    const finish = textStates => {
      if (identity.epoch() !== expectedEpoch) return;
      for (const item of observed) {
        const expectedHash = textStates?.[item.relative] || null;
        if (expectedHash && normalizedTextHash(item.doc.getText()) === expectedHash) externallyChanged.delete(item.doc.uri.toString());
        else externallyChanged.set(item.doc.uri.toString(), { expectedHash });
      }
    };
    finish.paths = observed.map(x => x.relative); return finish;
  }
  async function document(uri) {
    const doc = await vscode.workspace.openTextDocument(uri);
    const previous = externallyChanged.get(uri.toString());
    if (previous !== undefined) {
      const matches = () => previous.expectedHash && normalizedTextHash(doc.getText()) === previous.expectedHash;
      if (!matches()) {
        if (doc.isDirty) fail('external_change_dirty_document', 'Host changed a file while its Guest buffer became dirty. Preserve the buffer and resolve the conflict.');
        if (vscode.workspace.onDidChangeTextDocument) await new Promise(resolve => {
          const listener = vscode.workspace.onDidChangeTextDocument(event => { if (event.document === doc && matches()) { clearTimeout(timer); listener.dispose(); resolve(); } });
          const timer = setTimeout(() => { listener.dispose(); resolve(); }, 1200);
        });
        if (!matches()) fail('editor_refresh_pending', 'Host changed this file but the Guest document has not reloaded yet. Preserve the buffer; use an explicit Host byte read or reopen the document before another text edit.');
        if (doc.isDirty) fail('external_change_dirty_document', 'Guest buffer changed while waiting for the Host update. Preserve it and resolve the conflict.');
      }
      externallyChanged.delete(uri.toString());
    }
    return doc;
  }
  const hostOperations = createHostOperations({ vscode, host, permissions, resolve, rejectDirty, noteExternalChange });
  async function read(r) {
    const { uri } = resolve(r);
    const doc = await document(uri);
    const start = integer(r.startLine ?? 1, 'startLine', 1, doc.lineCount);
    const end = integer(r.endLine ?? doc.lineCount, 'endLine', start, doc.lineCount);
    const text = doc.getText(new vscode.Range(start - 1, 0, end - 1, doc.lineAt(end - 1).text.length));
    if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) fail('response_limit', 'Read a smaller line range (1 MiB text limit).');
    return { ...meta(doc, r.withHash === true), startLine: start, endLine: end, text };
  }
  async function parents(uri) {
    const parent = vscode.Uri.joinPath(uri, '..');
    const root = roots().find(f => f.uri.scheme === uri.scheme && f.uri.authority === uri.authority && (parent.path === f.uri.path || parent.path.startsWith(f.uri.path.replace(/\/$/u, '') + '/')));
    if (!root) fail('outside_workspace', 'Parent is outside the workspace.');
    if (parent.path !== root.uri.path) { permissions.assert('mkdir'); await vscode.workspace.fs.createDirectory(parent); }
  }
  async function saveResult(doc, extra = {}) {
    try {
      permissions.assert('save');
      const saved = await doc.save();
      return { ...extra, saved, ...meta(doc), ...(saved ? {} : { error: { code: 'save_failed', message: 'Document.save() returned false; applied text remains in the editor.' } }) };
    } catch (err) {
      return { ...extra, saved: false, ...meta(doc), error: { code: err.code || 'save_failed', message: err.message } };
    }
  }
  async function editFiles(r, rewrite = false) {
    const files = rewrite ? [r] : r.files;
    if (!Array.isArray(files) || !files.length || files.length > 100) fail('invalid_argument', 'files must contain 1..100 documents.');
    const seen = new Set(), plans = [];
    for (const file of files) {
      if (!file || typeof file !== 'object') fail('invalid_argument', 'Each file must be an object.');
      const { uri } = resolve(r, file.path);
      if (seen.has(uri.toString())) fail('duplicate_file', 'Merge changes for the same file into one entry.');
      seen.add(uri.toString());
      const doc = await document(uri);
      precheck(doc, file, rewrite);
      const original = doc.getText(), eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
      let edits;
      if (rewrite) {
        if (typeof file.text !== 'string') fail('invalid_argument', 'text must be a string.');
        edits = [{ start: 0, end: original.length, text: normalizeEol(file.text, eol) }];
      } else edits = planChanges(original, file.changes, eol, file.expectedVersion !== undefined || file.expectedHash !== undefined);
      plans.push({ doc, uri, edits, version: doc.version });
    }
    const wsEdit = new vscode.WorkspaceEdit();
    permissions.assert(rewrite ? 'write' : 'edit');
    if (r.epoch !== undefined && r.epoch !== identity.epoch()) fail('workspace_changed', 'Workspace changed during edit preflight.');
    for (const plan of plans) {
      if (plan.doc.version !== plan.version) fail('content_changed', 'A document changed during batch preflight.');
      for (const edit of plan.edits) wsEdit.replace(plan.uri, new vscode.Range(plan.doc.positionAt(edit.start), plan.doc.positionAt(edit.end)), edit.text);
    }
    const applied = await vscode.workspace.applyEdit(wsEdit);
    if (!applied) return { applied: false, saved: false, files: plans.map(p => ({ ...meta(p.doc), saved: false })), error: { code: 'apply_failed', message: 'workspace.applyEdit() returned false.' } };
    const results = [];
    for (const plan of plans) results.push(await saveResult(plan.doc, { changes: plan.edits.length }));
    return { applied: true, saved: results.every(x => x.saved && !x.dirty), files: results };
  }
  async function languageEdit(r) {
    const { uri } = resolve(r); const initial = await document(uri); precheck(initial, r);
    const line = integer(r.line ?? 1, 'line', 1, initial.lineCount);
    const position = new vscode.Position(line - 1, integer(r.character ?? 0, 'character', 0, initial.lineAt(line - 1).text.length));
    let entries;
    if (r.op === 'renameSymbol') {
      if (typeof r.newName !== 'string' || !r.newName || r.newName.length > 256) fail('invalid_argument', 'newName must contain 1..256 characters.');
      const rename = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', uri, position, r.newName);
      if (!rename) fail('provider_unavailable', 'The language provider returned no symbol rename.');
      entries = rename.entries();
    } else {
      const edits = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', uri, { tabSize: integer(r.tabSize ?? 2, 'tabSize', 1, 16), insertSpaces: r.insertSpaces !== false });
      if (!edits) fail('provider_unavailable', 'No document formatting provider returned edits.');
      entries = [[uri, edits]];
    }
    const plans = [], edit = new vscode.WorkspaceEdit();
    for (const [target, changes] of entries) {
      const root = roots().find(f => f.uri.toString() === r.workspace);
      if (target.scheme !== root.uri.scheme || target.authority !== root.uri.authority || !target.path.startsWith(root.uri.path.replace(/\/$/u, '') + '/')) fail('outside_workspace', 'Language edits cannot change files outside the selected root.');
      const doc = await document(target); precheck(doc, { allowDirty: r.allowDirty });
      const version = doc.version, eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
      for (const change of changes) {
        if (!change.range || typeof change.newText !== 'string') fail('unsupported_language_edit', 'Only text-range language edits are supported.');
        edit.replace(target, change.range, normalizeEol(change.newText, eol));
      }
      plans.push({ doc, version, changes: changes.map(c => ({ range: serialize(c.range), newText: c.newText })) });
    }
    if (r.preview === true) return { preview: true, textOnly: true, files: plans.map(p => ({ ...meta(p.doc), changes: p.changes })) };
    if (r.epoch !== undefined && r.epoch !== identity.epoch()) fail('workspace_changed', 'Workspace changed during language-edit preflight.');
    permissions.assert(r.op);
    for (const p of plans) if (p.doc.version !== p.version) fail('content_changed', 'A language-edit target changed before apply.');
    if (!plans.some(p => p.changes.length)) return { applied: true, saved: true, files: [], textOnly: true };
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) return { applied: false, saved: false, textOnly: true };
    const files = []; for (const p of plans) { permissions.assert(r.op); files.push(await saveResult(p.doc)); }
    return { applied: true, saved: files.every(f => f.saved && !f.dirty), files, textOnly: true, fileOperationsApplied: false };
  }
  async function dispatchOperation(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) fail('invalid_request', 'Expected a JSON object.');
    if (r.instance !== undefined && r.instance !== identity.id) fail('instance_mismatch', 'The selected VS Code instance changed.');
    if (r.epoch !== undefined && r.epoch !== identity.epoch()) fail('workspace_changed', 'Workspace changed since discovery; rediscover the instance.');
    if (r.op === 'info') return { id: identity.id, epoch: identity.epoch(), version: identity.version, roots: rootInfo(), trusted: vscode.workspace.isTrusted, operations: OPERATIONS, transport: 'windows-current-user-pipe', permissions: permissions.snapshot(OPERATIONS), search: { hostScope: 'saved_host_files', editorSnapshotCompletion: false }, dirtyDocuments: permissions.value('agent.enabled', true) && permissions.enabled('read') ? vscode.workspace.textDocuments.filter(d => d.uri.scheme === 'vsls' && d.isDirty).map(d => d.uri.toString()) : [], dirtyDocumentsOmitted: !permissions.value('agent.enabled', true) || !permissions.enabled('read') };
    if (r.epoch === undefined) fail('workspace_binding_required', 'Include epoch from instance discovery.');
    if (!OPERATIONS.includes(r.op)) fail('unknown_operation', `Unsupported operation: ${String(r.op)}`);
    if (r.op === 'hostStatus') return hostOperations.dispatch(r);
    permissions.assert(r.op);
    if (HOST_OPERATIONS.includes(r.op)) return hostOperations.dispatch(r);
    if (r.op === 'renameSymbol' || r.op === 'format') return languageEdit(r);
    if (r.op === 'read') return read(r);
    if (r.op === 'readMany') {
      if (!Array.isArray(r.files) || !r.files.length || r.files.length > 50) fail('invalid_argument', 'files must contain 1..50 read requests.');
      const results = [];
      for (const file of r.files) {
        try { results.push({ ok: true, result: await read({ ...r, ...file, workspace: r.workspace }) }); }
        catch (err) { results.push({ ok: false, path: file.path, error: { code: err.code || 'vscode_error', message: err.message } }); }
      }
      return { files: results };
    }
    if (r.op === 'write') return editFiles(r, true);
    if (r.op === 'edit') return editFiles(r);
    if (r.op === 'workspaceSymbols') {
      resolve(r, '', true);
      if (typeof r.query !== 'string') fail('invalid_argument', 'query is required.');
      return { symbols: serialize(await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', r.query)) };
    }
    const { uri, root } = resolve(r, r.path ?? '', ['list', 'stat', 'findFilesSnapshot', 'searchSnapshot', 'searchResults', 'diagnostics'].includes(r.op));
    if (r.op === 'list') return { uri: uri.toString(), entries: (await vscode.workspace.fs.readDirectory(uri)).map(([name, type]) => ({ name, type })) };
    if (r.op === 'stat') {
      const s = await vscode.workspace.fs.stat(uri);
      return { uri: uri.toString(), type: s.type, size: Number.isFinite(s.size) ? s.size : null, mtime: Number.isFinite(s.mtime) ? s.mtime : null, ctime: Number.isFinite(s.ctime) ? s.ctime : null };
    }
    if (r.op === 'mkdir') { await vscode.workspace.fs.createDirectory(uri); return { uri: uri.toString(), created: true }; }
    if (r.op === 'save') {
      const doc = await document(uri);
      if (r.expectedVersion === undefined || r.expectedVersion !== doc.version) fail('content_changed', 'Targeted save needs the current expectedVersion.');
      return saveResult(doc);
    }
    if (r.op === 'create') {
      if (typeof r.text !== 'string') fail('invalid_argument', 'text must be a string.');
      rejectDirty(uri);
      if (r.parents !== false) await parents(uri);
      const eol = chooseEol(r.text, r.eol);
      const edit = new vscode.WorkspaceEdit();
      edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
      edit.set(uri, [vscode.TextEdit.insert(new vscode.Position(0, 0), normalizeEol(r.text, eol)), vscode.TextEdit.setEndOfLine(eol === '\r\n' ? vscode.EndOfLine.CRLF : vscode.EndOfLine.LF)]);
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) return { applied: false, saved: false, uri: uri.toString() };
      const doc = await vscode.workspace.openTextDocument(uri);
      return { applied, ...(await saveResult(doc)) };
    }
    if (r.op === 'move') {
      if (r.overwrite === true) permissions.assert('write');
      const destination = resolve(r, r.to).uri;
      if (destination.toString() === uri.toString()) fail('invalid_argument', 'Source and destination must differ.');
      rejectDirty(uri); rejectDirty(destination);
      if (r.parents !== false) await parents(destination);
      const edit = new vscode.WorkspaceEdit(); edit.renameFile(uri, destination, { overwrite: r.overwrite === true, ignoreIfExists: false });
      if (!await vscode.workspace.applyEdit(edit)) return { applied: false, from: uri.toString(), to: destination.toString() };
      return { moved: true, from: uri.toString(), to: destination.toString() };
    }
    if (r.op === 'delete') {
      rejectDirty(uri);
      if (r.recursive === true) fail('not_supported', 'v0.1 supports file and empty-directory deletion only.');
      await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false });
      return { deleted: true, uri: uri.toString() };
    }
    if (r.op === 'providerRead') {
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > 1024 * 1024) fail('response_limit', 'Provider verification is limited to 1 MiB.');
      return { uri: uri.toString(), bytes: bytes.byteLength, text: Buffer.from(bytes).toString('utf8') };
    }
    if (r.op === 'diagnostics') return { uri: uri.toString(), diagnostics: serialize(vscode.languages.getDiagnostics(uri)) };
    if (r.op === 'symbols') return { uri: uri.toString(), symbols: serialize(await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri)) };
    if (r.op === 'definition') {
      integer(r.line, 'line', 1, 10000000); integer(r.character ?? 0, 'character', 0, 10000000);
      return { locations: serialize(await vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, new vscode.Position(r.line - 1, r.character ?? 0))) };
    }
    if (r.op === 'references') {
      integer(r.line, 'line', 1, 10000000); integer(r.character ?? 0, 'character', 0, 10000000);
      return { locations: serialize(await vscode.commands.executeCommand('vscode.executeReferenceProvider', uri, new vscode.Position(r.line - 1, r.character ?? 0))) };
    }
    if (r.op === 'findFilesSnapshot') {
      if (typeof r.pattern !== 'string' || !r.pattern) fail('invalid_argument', 'pattern is required.');
      const limit = integer(r.limit ?? 100, 'limit', 1, 1000);
      const found = await vscode.workspace.findFiles(new vscode.RelativePattern(root, r.pattern), r.useExcludes === false ? null : r.exclude ?? undefined, limit);
      return { files: found.map(x => x.toString()), limit, complete: null, possiblyCapped: found.length >= limit, warning: 'Live Share may omit new files; an empty result does not prove absence.' };
    }
    if (r.op === 'searchSnapshot') {
      if (roots().length !== 1) fail('not_supported', 'Search View search is limited to a single Live Share root in v0.1.');
      if (typeof r.query !== 'string' || !r.query) fail('invalid_argument', 'query is required.');
      const waitMs = integer(r.waitMs ?? 800, 'waitMs', 0, 5000);
      lastSearch = { id: ++searchId, query: r.query, include: r.include ?? '', exclude: r.exclude ?? '' };
      await vscode.commands.executeCommand('workbench.action.findInFiles', { query: r.query, filesToInclude: lastSearch.include, filesToExclude: lastSearch.exclude, isRegex: r.regex === true, isCaseSensitive: r.caseSensitive === true, triggerSearch: true, onlyOpenEditors: false, useExcludeSettingsAndIgnoreFiles: r.useExcludes !== false });
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    if (r.op === 'searchSnapshot' || r.op === 'searchResults') {
      if (r.searchId !== undefined && r.searchId !== lastSearch?.id) fail('search_changed', 'Another bridge search has been started.');
      const snapshot = await vscode.commands.executeCommand('search.action.getSearchResults');
      const text = typeof snapshot === 'string' ? snapshot : JSON.stringify(serialize(snapshot)) ?? '';
      const maxCharacters = integer(r.maxCharacters ?? 100000, 'maxCharacters', 1, 1000000);
      return { search: lastSearch, snapshot: text.slice(0, maxCharacters), truncated: text.length > maxCharacters, complete: null, correlation: 'best_effort', warning: 'Current Search View snapshot; no completion signal. User changes to the Search View are not tracked.' };
    }
  }
  async function dispatch(r) {
    const result = await dispatchOperation(r);
    if (!['info', 'hostStatus'].includes(r.op)) permissions.assert(r.op);
    if (r.epoch !== undefined && r.epoch !== identity.epoch()) fail('workspace_changed', 'Workspace changed while this request was in flight; inspect any dispatched mutation.');
    return result;
  }
  return { dispatch, roots: rootInfo, permissions, dispose: () => host.dispose(), workspaceChanged: () => { externallyChanged.clear(); host.changed(true); }, terminalClosed: terminal => host.terminalClosed?.(terminal), configurationChanged: event => host.changed(event?.affectsConfiguration?.('liveshareWorkspaceBridge.terminal') || event?.affectsConfiguration?.('liveshareWorkspaceBridge.transfer') || event?.affectsConfiguration?.('liveshareWorkspaceBridge.agent.enabled')) };
}
module.exports = { createWorkspaceApi, OPERATIONS };
