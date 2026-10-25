'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWorkspaceApi } = require('../workspace.cjs');

function fixture(initial = {}) {
  class Uri {
    constructor(value) { const u = new URL(value); this.scheme = u.protocol.slice(0, -1); this.authority = u.host; this.path = decodeURIComponent(u.pathname); }
    toString() { return this.scheme + ':' + (this.authority ? '//' + this.authority : '') + this.path; }
    static joinPath(uri, ...parts) { return new Uri(uri.scheme + ':' + (uri.authority ? '//' + uri.authority : '') + path.posix.join(uri.path, ...parts)); }
  }
  class Position { constructor(line, character) { Object.assign(this, { line, character }); } }
  class Range { constructor(a, b, c, d) { this.start = typeof a === 'number' ? new Position(a, b) : a; this.end = typeof a === 'number' ? new Position(c, d) : b; } }
  class WorkspaceEdit {
    constructor() { this.creates = []; this.edits = new Map(); this.renames = []; }
    createFile(uri, options) { this.creates.push({ uri, options }); }
    renameFile(from, to, options) { this.renames.push({ from, to, options }); }
    replace(uri, range, newText) { if (!this.edits.has(uri.toString())) this.edits.set(uri.toString(), []); this.edits.get(uri.toString()).push({ range, newText }); }
    set(uri, changes) { this.edits.set(uri.toString(), changes); }
  }
  const docs = new Map(), disk = new Map(), saveBehavior = new Map();
  const calls = { open: 0, apply: 0, save: [], providerReads: 0, commands: [], directories: [], copy: 0, delete: 0 };
  function document(uri, text) {
    const doc = { uri, text, version: 1, isDirty: false, eol: text.includes('\r\n') ? 2 : 1,
      get lineCount() { return this.text.split(/\r\n|\n/u).length; },
      lineAt(i) { return { text: this.text.split(/\r\n|\n/u)[i] }; },
      offsetAt(p) { const lines = this.text.split(/\r\n|\n/u); return lines.slice(0, p.line).reduce((n, x) => n + x.length + (this.eol === 2 ? 2 : 1), 0) + p.character; },
      positionAt(offset) { const before = this.text.slice(0, offset).split(/\r\n|\n/u); return new Position(before.length - 1, before.at(-1).length); },
      getText(range) { return range ? this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end)) : this.text; },
      async save() { calls.save.push(this.uri.toString()); const behavior = saveBehavior.get(this.uri.toString()); if (behavior instanceof Error) throw behavior; if (behavior === false) return false; disk.set(this.uri.toString(), this.text); this.isDirty = false; return true; }
    };
    docs.set(uri.toString(), doc); return doc;
  }
  for (const [name, text] of Object.entries(initial)) { document(new Uri('vsls:/' + name), text); disk.set('vsls:/' + name, text); }
  let applyFalse = false;
  const vscode = { Uri, Range, Position, WorkspaceEdit, EndOfLine: { LF: 1, CRLF: 2 }, TextEdit: { insert: (at, text) => ({ range: new Range(at, at), newText: text }), setEndOfLine: eol => ({ newEol: eol }) }, RelativePattern: class { constructor(base, pattern) { Object.assign(this, { base, pattern }); } },
    languages: { getDiagnostics: () => [] }, commands: { executeCommand: async (...args) => { calls.commands.push(args); return []; } },
    workspace: { workspaceFolders: [{ name: 'Test', uri: new Uri('vsls:/') }], isTrusted: true,
      get textDocuments() { return [...docs.values()]; },
      async openTextDocument(uri) { calls.open++; if (!docs.has(uri.toString())) throw Object.assign(new Error('missing'), { code: 'FileNotFound' }); return docs.get(uri.toString()); },
      fs: { createDirectory: async uri => calls.directories.push(uri.toString()), readFile: async uri => { calls.providerReads++; return Buffer.from(disk.get(uri.toString())); }, copy: async () => { calls.copy++; }, delete: async () => { calls.delete++; } },
      async applyEdit(edit) {
        calls.apply++;
        if (applyFalse) return false;
        for (const { uri } of edit.creates) { if (docs.has(uri.toString())) return false; document(uri, ''); }
        for (const [key, items] of edit.edits) {
          const doc = docs.get(key);
          const textChanges = items.filter(x => x.range).map(x => ({ start: doc.offsetAt(x.range.start), end: doc.offsetAt(x.range.end), text: x.newText })).sort((a, b) => b.start - a.start);
          for (const change of textChanges) doc.text = doc.text.slice(0, change.start) + change.text + doc.text.slice(change.end);
          const newEol = items.find(x => x.newEol)?.newEol;
          if (newEol) { doc.eol = newEol; doc.text = doc.text.replace(/\r\n|\n/gu, newEol === 2 ? '\r\n' : '\n'); }
          doc.version++; doc.isDirty = true;
        }
        return true;
      }
    }
  };
  const api = createWorkspaceApi(vscode, { id: 'test-instance', epoch: () => 3, version: '0.1.0' });
  const send = r => api.dispatch({ workspace: 'vsls:/', epoch: 3, ...r });
  return { send, docs, disk, calls, saveBehavior, vscode, setApplyFalse: () => applyFalse = true };
}
test('read returns current buffered content and version without provider reread or default hash', async () => {
  const f = fixture({ 'a.txt': 'one\n中文😀\n' });
  f.docs.get('vsls:/a.txt').text = 'dirty\n中文😀\n'; f.docs.get('vsls:/a.txt').isDirty = true;
  const r = await f.send({ op: 'read', path: 'a.txt', startLine: 2, endLine: 2 });
  assert.equal(r.text, '中文😀'); assert.equal(r.version, 1); assert.equal(r.dirty, true); assert.equal('hash' in r, false); assert.equal(f.calls.providerReads, 0);
});
test('batch preflight rejects a bad second file before changing or saving the first', async () => {
  const f = fixture({ 'a.txt': 'alpha', 'b.txt': 'beta' });
  await assert.rejects(f.send({ op: 'edit', files: [{ path: 'a.txt', changes: [{ oldText: 'alpha', newText: 'A' }] }, { path: 'b.txt', changes: [{ oldText: 'missing', newText: 'B' }] }] }), { code: 'text_not_found' });
  assert.equal(f.docs.get('vsls:/a.txt').text, 'alpha'); assert.equal(f.calls.apply, 0); assert.deepEqual(f.calls.save, []);
});
test('one apply, one save per target, no provider verification, unrelated dirty document untouched', async () => {
  const f = fixture({ 'a.txt': 'alpha\n', 'b.txt': 'beta\r\n', 'user.txt': 'unsaved' });
  f.docs.get('vsls:/user.txt').isDirty = true;
  const r = await f.send({ op: 'edit', files: [{ path: 'a.txt', expectedVersion: 1, changes: [{ oldText: 'alpha', newText: '中文😀' }] }, { path: 'b.txt', changes: [{ oldText: 'beta', newText: 'new\nline' }] }] });
  assert.equal(r.saved, true); assert.equal(f.calls.apply, 1); assert.equal(f.calls.open, 2); assert.equal(f.calls.providerReads, 0);
  assert.deepEqual(f.calls.save, ['vsls:/a.txt', 'vsls:/b.txt']); assert.equal(f.disk.get('vsls:/b.txt'), 'new\r\nline\r\n'); assert.equal(f.docs.get('vsls:/user.txt').isDirty, true);
});
test('partial save false or exception is explicit and is not retried or rolled back', async () => {
  const f = fixture({ 'a': 'a', 'b': 'b', 'c': 'c' });
  f.saveBehavior.set('vsls:/b', false); f.saveBehavior.set('vsls:/c', new Error('provider offline'));
  const r = await f.send({ op: 'edit', files: ['a', 'b', 'c'].map(name => ({ path: name, changes: [{ oldText: name, newText: name.toUpperCase() }] })) });
  assert.equal(r.applied, true); assert.equal(r.saved, false); assert.deepEqual(r.files.map(x => x.saved), [true, false, false]);
  assert.equal(f.disk.get('vsls:/a'), 'A'); assert.equal(f.disk.get('vsls:/b'), 'b'); assert.equal(f.docs.get('vsls:/b').text, 'B'); assert.equal(f.docs.get('vsls:/b').isDirty, true); assert.equal(f.calls.apply, 1); assert.equal(f.calls.save.length, 3);
});
test('apply false never triggers save; stale versions and dirty buffers fail before apply', async () => {
  const f = fixture({ 'a': 'old' });
  await assert.rejects(f.send({ op: 'write', path: 'a', expectedVersion: 2, text: 'new' }), { code: 'content_changed' });
  f.docs.get('vsls:/a').isDirty = true;
  await assert.rejects(f.send({ op: 'edit', files: [{ path: 'a', changes: [{ oldText: 'old', newText: 'new' }] }] }), { code: 'dirty_document' });
  f.docs.get('vsls:/a').isDirty = false; f.setApplyFalse();
  const r = await f.send({ op: 'write', path: 'a', expectedVersion: 1, text: '' });
  assert.equal(r.applied, false); assert.deepEqual(f.calls.save, []);
});
test('create emits an explicit EOL edit and creates missing parents without stat/read probes', async () => {
  const f = fixture();
  const r = await f.send({ op: 'create', path: 'nested/deep/a.txt', text: '中文😀\n', eol: 'LF' });
  assert.equal(r.saved, true); assert.equal(r.eol, 'LF'); assert.equal(f.disk.get('vsls:/nested/deep/a.txt'), '中文😀\n'); assert.deepEqual(f.calls.directories, ['vsls:/nested/deep']); assert.equal(f.calls.providerReads, 0);
});
test('root mutations, stale workspace epoch and instance mismatches fail before IO', async () => {
  const f = fixture();
  await assert.rejects(f.send({ op: 'delete', path: '' }), { code: 'invalid_path' });
  await assert.rejects(f.send({ op: 'read', path: 'a', epoch: 2 }), { code: 'workspace_changed' });
  await assert.rejects(f.send({ op: 'read', path: 'a', instance: 'other' }), { code: 'instance_mismatch' });
  await assert.rejects(f.send({ op: 'read', path: 'a', workspace: 'file:///C:/' }), { code: 'workspace_mismatch' });
  assert.equal(f.calls.open, 0); assert.equal(f.calls.delete, 0);
});
test('dirty copy targets and unsupported recursive deletes do not trigger IO', async () => {
  const f = fixture({ source: 'a', target: 'b' }); f.docs.get('vsls:/target').isDirty = true;
  await assert.rejects(f.send({ op: 'copy', path: 'source', to: 'target', overwrite: true }), { code: 'dirty_document' });
  await assert.rejects(f.send({ op: 'delete', path: 'folder', recursive: true }), { code: 'not_supported' });
  assert.equal(f.calls.copy, 0); assert.equal(f.calls.delete, 0);
});
test('retrying a failed save uses only the current buffer and never reapplies text', async () => {
  const f = fixture({ a: 'old' });
  const doc = f.docs.get('vsls:/a'); doc.text = 'new'; doc.isDirty = true; doc.version = 4;
  await assert.rejects(f.send({ op: 'save', path: 'a', expectedVersion: 3 }), { code: 'content_changed' });
  const result = await f.send({ op: 'save', path: 'a', expectedVersion: 4 });
  assert.equal(result.saved, true); assert.equal(f.disk.get('vsls:/a'), 'new'); assert.equal(f.calls.apply, 0); assert.equal(f.calls.providerReads, 0); assert.equal(f.calls.save.length, 1);
});
test('language results expose canonical URI and 0-based UTF-16 position fields', async () => {
  const f = fixture({ a: 'value' });
  f.vscode.commands.executeCommand = async () => [{ uri: new f.vscode.Uri('vsls:/a'), range: new f.vscode.Range(0, 1, 0, 4) }];
  const result = await f.send({ op: 'definition', path: 'a', line: 1, character: 2 });
  assert.deepEqual(result.locations, [{ uri: 'vsls:/a', range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } } }]);
});
