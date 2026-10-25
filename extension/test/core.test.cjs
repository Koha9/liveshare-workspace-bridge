const { test } = require('node:test');
const assert = require('node:assert/strict');
const { relativePath, precheck, textHash, planChanges, normalizeEol, chooseEol } = require('../core.cjs');
test('rejects escape paths and accepts Unicode workspace paths', () => {
  for (const value of ['../a', 'a/../b', '/a', 'C:/a', 'a\\b', 'vsls:/a', 'a?b', 'a\u0000b']) assert.throws(() => relativePath(value), { code: 'invalid_path' });
  assert.equal(relativePath('目录/emoji😀.txt'), '目录/emoji😀.txt');
  assert.equal(relativePath('file#1.txt'), 'file#1.txt');
  assert.equal(relativePath('', true), '');
});
test('prevents stale replacement and unrelated unsaved document overwrite', () => {
  const doc = { isDirty: false, version: 7, getText: () => '中文😀\r\n' };
  precheck(doc, { expectedHash: textHash(doc.getText()), text: '' });
  assert.throws(() => precheck(doc, { expectedHash: textHash('old'), text: 'new' }), { code: 'content_changed' });
  assert.throws(() => precheck({ ...doc, isDirty: true }, { expectedHash: textHash(doc.getText()), text: 'new' }), { code: 'dirty_document' });
  assert.throws(() => precheck(doc, { expectedVersion: 6 }), { code: 'content_changed' });
  assert.throws(() => precheck(doc, {}, true), { code: 'guard_required' });
  precheck({ ...doc, isDirty: true }, { allowDirty: true, expectedVersion: 7 });
});
test('literal edits preserve CRLF and reject ambiguous or overlapping matches', () => {
  const text = 'a\r\n中文😀\r\na';
  assert.throws(() => planChanges(text, [{ oldText: 'a', newText: 'b' }], '\r\n'), { code: 'ambiguous_match' });
  const planned = planChanges(text, [{ oldText: 'a\n中文😀', newText: 'first\n改' }], '\r\n');
  assert.deepEqual(planned, [{ start: 0, end: 7, text: 'first\r\n改' }]);
  assert.equal(planChanges(text, [{ oldText: 'a', newText: 'b', all: true }], '\r\n').length, 2);
  assert.throws(() => planChanges('abcd', [{ oldText: 'abc', newText: '' }, { oldText: 'bc', newText: '' }], '\n'), { code: 'overlapping_edits' });
});
test('position edits use UTF-16 and enforce exact bounds and content guards', () => {
  const change = { range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } }, expectedText: 'x', newText: 'y' };
  assert.deepEqual(planChanges('😀x\nend', [change], '\n'), [{ start: 2, end: 3, text: 'y' }]);
  assert.throws(() => planChanges('short', [{ startLine: 1, endLine: 2, newText: '' }], '\n', true), { code: 'invalid_argument' });
  assert.throws(() => planChanges('short', [{ startLine: 1, endLine: 1, newText: '' }], '\n'), { code: 'guard_required' });
  assert.equal(chooseEol('a\r\nb'), '\r\n');
  assert.equal(chooseEol('a\nb'), '\n');
  assert.equal(normalizeEol('a\r\nb\nc', '\n'), 'a\nb\nc');
});
