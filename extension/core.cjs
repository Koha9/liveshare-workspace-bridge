'use strict';
const crypto = require('node:crypto');
const MAX_REQUEST = 2 * 1024 * 1024;
const MAX_RESPONSE = 4 * 1024 * 1024;
function fail(code, message, details) { throw Object.assign(new Error(message), { code, details }); }
function textHash(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }
function integer(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) fail('invalid_argument', `${name} must be an integer in ${min}..${max}.`);
  return value;
}
function relativePath(value, allowRoot = false) {
  if (typeof value !== 'string' || (!value && !allowRoot) || value.length > 4096 || value.includes('\\') || /[\x00-\x1f?:*<>|]/u.test(value) || value.startsWith('/') || value.split('/').some(x => x === '..' || x === '.')) {
    fail('invalid_path', 'Use a workspace-relative path with forward slashes, without dot segments or a URI scheme.');
  }
  return value.replace(/\/+$/u, '');
}
function normalizeEol(text, eol) { return text.replace(/\r\n|\r|\n/gu, eol); }
function chooseEol(text, requested, fallback = '\n') {
  if (requested !== undefined && requested !== 'LF' && requested !== 'CRLF') fail('invalid_argument', 'eol must be LF or CRLF.');
  return requested ? (requested === 'CRLF' ? '\r\n' : '\n') : ((text.match(/\r\n|\n/u) || [fallback])[0]);
}
function precheck(doc, file, requireVersion = false) {
  if (doc.isDirty && file.allowDirty !== true) fail('dirty_document', 'Document has unsaved edits. Set allowDirty only when those edits should also be saved.');
  if (file.expectedVersion !== undefined && file.expectedVersion !== doc.version) fail('content_changed', 'Document version changed.', { actualVersion: doc.version });
  if (file.expectedHash !== undefined && file.expectedHash !== textHash(doc.getText())) fail('content_changed', 'Text hash changed.');
  if (requireVersion && file.expectedVersion === undefined && file.expectedHash === undefined) fail('guard_required', 'Full replacement needs expectedVersion from read (or expectedHash).');
}
function positionOffset(lines, starts, pos, name) {
  if (!pos || typeof pos !== 'object') fail('invalid_range', `${name} is required.`);
  integer(pos.line, `${name}.line`, 0, lines.length - 1);
  integer(pos.character, `${name}.character`, 0, lines[pos.line].length);
  return starts[pos.line] + pos.character;
}
function planChanges(text, changes, eol, guarded = false) {
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > 1000) fail('invalid_argument', 'changes must contain 1..1000 edits.');
  const lines = text.split(/\r\n|\n|\r/u), starts = [0];
  for (let i = 0; i < lines.length - 1; i++) starts.push(starts[i] + lines[i].length + eol.length);
  const edits = [];
  for (const change of changes) {
    if (!change || typeof change !== 'object' || typeof change.newText !== 'string') fail('invalid_argument', 'Each change needs newText.');
    const replacement = normalizeEol(change.newText, eol);
    if (typeof change.oldText === 'string') {
      const old = normalizeEol(change.oldText, eol);
      if (!old.length) fail('invalid_argument', 'oldText must not be empty; use a guarded range to insert.');
      let from = 0, count = 0;
      while (from <= text.length) {
        const at = text.indexOf(old, from);
        if (at < 0) break;
        count++; edits.push({ start: at, end: at + old.length, text: replacement }); from = at + old.length;
        if (count > 1000) fail('too_many_matches', 'Narrow the replacement.');
      }
      if (!count) fail('text_not_found', 'oldText was not found.');
      if (count > 1 && change.all !== true) fail('ambiguous_match', 'oldText matches multiple places; narrow it or explicitly use all:true.');
    } else {
      let start, end;
      if (change.range) {
        start = positionOffset(lines, starts, change.range.start, 'range.start');
        end = positionOffset(lines, starts, change.range.end, 'range.end');
      } else {
        integer(change.startLine, 'startLine', 1, lines.length);
        integer(change.endLine, 'endLine', change.startLine, lines.length);
        start = starts[change.startLine - 1]; end = starts[change.endLine - 1] + lines[change.endLine - 1].length;
      }
      if (end < start) fail('invalid_range', 'Range end precedes start.');
      if (change.expectedText !== undefined) {
        if (typeof change.expectedText !== 'string' || normalizeEol(change.expectedText, eol) !== text.slice(start, end)) fail('content_changed', 'expectedText does not match the selected range.');
      } else if (!guarded) fail('guard_required', 'Position edits need expectedVersion, expectedHash or expectedText.');
      edits.push({ start, end, text: replacement });
    }
  }
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < edits.length; i++) if (edits[i].start < edits[i - 1].end || edits[i].start === edits[i - 1].start) fail('overlapping_edits', 'Changes must not overlap; all positions refer to the original text.');
  return edits;
}
module.exports = { MAX_REQUEST, MAX_RESPONSE, fail, integer, textHash, relativePath, normalizeEol, chooseEol, precheck, planChanges };
