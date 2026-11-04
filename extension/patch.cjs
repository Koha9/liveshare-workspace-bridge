'use strict';
const { fail, relativePath } = require('./core.cjs');
const MAX_PATCH_BYTES = 1024 * 1024;
const MAX_PATCH_FILES = 100;
const GIT_PATH_ESCAPES = { t: '\t', n: '\n', r: '\r', '\\': '\\', '"': '"' };
const UNSUPPORTED_PATCH = /^GIT binary patch|^Binary files |^(?:new file mode|old mode|new mode|deleted file mode) (?:120000|160000)/m;
const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/u;

// Decodes the escape whose backslash is at index i; returns the index of its last character.
function decodeEscape(value, i, bytes) {
  const octal = /^([0-7]{1,3})/.exec(value.slice(i + 1));
  if (octal) {
    bytes.push(parseInt(octal[1], 8));
    return i + octal[1].length;
  }
  const next = value[i + 1];
  if (!(next in GIT_PATH_ESCAPES)) {
    fail('invalid_patch', 'Unsupported Git path escape.');
  }
  bytes.push(...Buffer.from(GIT_PATH_ESCAPES[next]));
  return i + 1;
}

// Pushes the UTF-8 bytes of the code point at i; returns the index of its last UTF-16 unit.
function pushCodePoint(value, i, bytes) {
  const point = value.codePointAt(i);
  bytes.push(...Buffer.from(String.fromCodePoint(point)));
  return point > 0xffff ? i + 1 : i;
}

function decodeQuotedGitPath(value) {
  if (!value.endsWith('"')) {
    fail('invalid_patch', 'Unterminated quoted Git path.');
  }
  const bytes = [];
  for (let i = 1; i < value.length - 1; i++) {
    if (value[i] !== '\\') {
      i = pushCodePoint(value, i, bytes);
    } else {
      i = decodeEscape(value, i, bytes);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function decodeGitPath(value) {
  value = value.split('\t', 1)[0];
  if (value.startsWith('"')) {
    value = decodeQuotedGitPath(value);
  }
  return value;
}

function parseHunkCount(group) {
  return group === undefined ? 1 : Number(group);
}

// Counts one body line of the current hunk against its remaining old/new line budget.
function consumeHunkLine(line, counts) {
  if (line.startsWith(' ')) {
    counts.oldLines--;
    counts.newLines--;
  } else if (line.startsWith('-')) {
    counts.oldLines--;
  } else if (line.startsWith('+')) {
    counts.newLines--;
  } else if (!line.startsWith('\\ No newline')) {
    fail('invalid_patch', 'Malformed unified-diff hunk.');
  }
}

function headerPath(value) {
  if (!/^[ab]\//u.test(value)) {
    fail('invalid_patch', 'Text patch paths must use a/ and b/ prefixes.');
  }
  return value.slice(2);
}

function rejectGitAdministrationPath(value) {
  if (value.split('/').some(x => x.toLowerCase() === '.git')) {
    fail('outside_workspace', 'Patches cannot change Git administration paths.');
  }
}

function patchPaths(patch) {
  if (typeof patch !== 'string' || !patch.length || Buffer.byteLength(patch) > MAX_PATCH_BYTES) {
    fail('invalid_patch', 'Supply a text patch of at most 1 MiB.');
  }
  if (UNSUPPORTED_PATCH.test(patch)) {
    fail('unsupported_patch', 'Binary, symlink and submodule patches are not supported.');
  }
  const paths = new Set();
  const counts = { oldLines: 0, newLines: 0 };
  let headers = 0;
  for (const line of patch.split(/\r?\n/u)) {
    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      counts.oldLines = parseHunkCount(hunk[1]);
      counts.newLines = parseHunkCount(hunk[2]);
      continue;
    }
    if (counts.oldLines > 0 || counts.newLines > 0) {
      consumeHunkLine(line, counts);
      continue;
    }
    const header = /^(---|\+\+\+) (.*)$/u.exec(line);
    const rename = /^(?:rename|copy) (?:from|to) (.*)$/u.exec(line);
    if (!header && !rename) {
      continue;
    }
    let value = decodeGitPath(header ? header[2] : rename[1]);
    if (value === '/dev/null') {
      continue;
    }
    if (header) {
      value = headerPath(value);
      headers++;
    }
    relativePath(value);
    rejectGitAdministrationPath(value);
    paths.add(value);
  }
  if (!headers || !paths.size || paths.size > MAX_PATCH_FILES) {
    fail('invalid_patch', 'Patch must name 1..100 workspace files.');
  }
  return [...paths];
}

module.exports = { patchPaths };
