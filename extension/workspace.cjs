'use strict';
const { fail, integer, textHash, relativePath, normalizeEol, chooseEol, precheck, planChanges } = require('./core.cjs');
const OPERATIONS = ['info', 'list', 'read', 'readMany', 'create', 'write', 'edit', 'save', 'mkdir', 'stat', 'copy', 'move', 'delete', 'diagnostics', 'symbols', 'definition', 'workspaceSymbols', 'findFiles', 'search', 'searchResults', 'providerRead'];
function createWorkspaceApi(vscode, identity) {
  let searchId = 0, lastSearch = null;
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
  async function read(r) {
    const { uri } = resolve(r);
    const doc = await vscode.workspace.openTextDocument(uri);
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
    if (parent.path !== root.uri.path) await vscode.workspace.fs.createDirectory(parent);
  }
  async function saveResult(doc, extra = {}) {
    try {
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
      const doc = await vscode.workspace.openTextDocument(uri);
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
  async function dispatch(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) fail('invalid_request', 'Expected a JSON object.');
    if (r.instance !== undefined && r.instance !== identity.id) fail('instance_mismatch', 'The selected VS Code instance changed.');
    if (r.epoch !== undefined && r.epoch !== identity.epoch()) fail('workspace_changed', 'Workspace changed since discovery; rediscover the instance.');
    if (r.op === 'info') return { id: identity.id, epoch: identity.epoch(), version: identity.version, roots: rootInfo(), trusted: vscode.workspace.isTrusted, operations: OPERATIONS, transport: 'windows-current-user-pipe', search: { contentCompletion: false, newFilePathResultsReliable: false }, dirtyDocuments: vscode.workspace.textDocuments.filter(d => d.uri.scheme === 'vsls' && d.isDirty).map(d => d.uri.toString()) };
    if (r.epoch === undefined) fail('workspace_binding_required', 'Include epoch from instance discovery.');
    if (!OPERATIONS.includes(r.op)) fail('unknown_operation', `Unsupported operation: ${String(r.op)}`);
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
    const { uri, root } = resolve(r, r.path ?? '', ['list', 'stat', 'findFiles', 'search', 'searchResults', 'diagnostics'].includes(r.op));
    if (r.op === 'list') return { uri: uri.toString(), entries: (await vscode.workspace.fs.readDirectory(uri)).map(([name, type]) => ({ name, type })) };
    if (r.op === 'stat') {
      const s = await vscode.workspace.fs.stat(uri);
      return { uri: uri.toString(), type: s.type, size: Number.isFinite(s.size) ? s.size : null, mtime: Number.isFinite(s.mtime) ? s.mtime : null, ctime: Number.isFinite(s.ctime) ? s.ctime : null };
    }
    if (r.op === 'mkdir') { await vscode.workspace.fs.createDirectory(uri); return { uri: uri.toString(), created: true }; }
    if (r.op === 'save') {
      const doc = await vscode.workspace.openTextDocument(uri);
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
    if (r.op === 'copy' || r.op === 'move') {
      const destination = resolve(r, r.to).uri;
      if (destination.toString() === uri.toString()) fail('invalid_argument', 'Source and destination must differ.');
      rejectDirty(uri); rejectDirty(destination);
      if (r.op === 'copy') {
        const source = await vscode.workspace.fs.stat(uri);
        if (!(source.type & 1) || source.type & 2) fail('not_supported', 'v0.1 copies files only; directory copy is not implemented.');
      }
      if (r.parents !== false) await parents(destination);
      if (r.op === 'copy') await vscode.workspace.fs.copy(uri, destination, { overwrite: r.overwrite === true });
      else {
        const edit = new vscode.WorkspaceEdit(); edit.renameFile(uri, destination, { overwrite: r.overwrite === true, ignoreIfExists: false });
        if (!await vscode.workspace.applyEdit(edit)) return { applied: false, from: uri.toString(), to: destination.toString() };
      }
      return { [r.op === 'copy' ? 'copied' : 'moved']: true, from: uri.toString(), to: destination.toString() };
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
    if (r.op === 'findFiles') {
      if (typeof r.pattern !== 'string' || !r.pattern) fail('invalid_argument', 'pattern is required.');
      const limit = integer(r.limit ?? 100, 'limit', 1, 1000);
      const found = await vscode.workspace.findFiles(new vscode.RelativePattern(root, r.pattern), r.useExcludes === false ? null : r.exclude ?? undefined, limit);
      return { files: found.map(x => x.toString()), limit, complete: null, possiblyCapped: found.length >= limit, warning: 'Live Share may omit new files; an empty result does not prove absence.' };
    }
    if (r.op === 'search') {
      if (roots().length !== 1) fail('not_supported', 'Search View search is limited to a single Live Share root in v0.1.');
      if (typeof r.query !== 'string' || !r.query) fail('invalid_argument', 'query is required.');
      const waitMs = integer(r.waitMs ?? 800, 'waitMs', 0, 5000);
      lastSearch = { id: ++searchId, query: r.query, include: r.include ?? '', exclude: r.exclude ?? '' };
      await vscode.commands.executeCommand('workbench.action.findInFiles', { query: r.query, filesToInclude: lastSearch.include, filesToExclude: lastSearch.exclude, isRegex: r.regex === true, isCaseSensitive: r.caseSensitive === true, triggerSearch: true, onlyOpenEditors: false, useExcludeSettingsAndIgnoreFiles: r.useExcludes !== false });
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    if (r.op === 'search' || r.op === 'searchResults') {
      if (r.searchId !== undefined && r.searchId !== lastSearch?.id) fail('search_changed', 'Another bridge search has been started.');
      const snapshot = await vscode.commands.executeCommand('search.action.getSearchResults');
      const text = typeof snapshot === 'string' ? snapshot : JSON.stringify(serialize(snapshot)) ?? '';
      const maxCharacters = integer(r.maxCharacters ?? 100000, 'maxCharacters', 1, 1000000);
      return { search: lastSearch, snapshot: text.slice(0, maxCharacters), truncated: text.length > maxCharacters, complete: null, correlation: 'best_effort', warning: 'Current Search View snapshot; no completion signal. User changes to the Search View are not tracked.' };
    }
  }
  return { dispatch, roots: rootInfo };
}
module.exports = { createWorkspaceApi, OPERATIONS };
