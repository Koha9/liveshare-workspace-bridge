'use strict';
const { fail, relativePath } = require('./core.cjs');
function decodeGitPath(value) {
  value = value.split('\t', 1)[0];
  if (value.startsWith('"')) {
    if (!value.endsWith('"')) fail('invalid_patch', 'Unterminated quoted Git path.');
    const bytes = [];
    for (let i = 1; i < value.length - 1; i++) {
      if (value[i] !== '\\') { const point=value.codePointAt(i);bytes.push(...Buffer.from(String.fromCodePoint(point)));if(point>0xffff)i++;continue; }
      const octal = /^([0-7]{1,3})/.exec(value.slice(i + 1));
      if (octal) { bytes.push(parseInt(octal[1], 8)); i += octal[1].length; }
      else { const next = value[++i]; const map = { t: '\t', n: '\n', r: '\r', '\\': '\\', '"': '"' }; if (!(next in map)) fail('invalid_patch', 'Unsupported Git path escape.'); bytes.push(...Buffer.from(map[next])); }
    }
    value = Buffer.from(bytes).toString('utf8');
  }
  return value;
}
function patchPaths(patch) {
  if (typeof patch !== 'string' || !patch.length || Buffer.byteLength(patch) > 1024 * 1024) fail('invalid_patch', 'Supply a text patch of at most 1 MiB.');
  if (/^GIT binary patch|^Binary files |^(?:new file mode|old mode|new mode|deleted file mode) (?:120000|160000)/m.test(patch)) fail('unsupported_patch', 'Binary, symlink and submodule patches are not supported.');
  const paths = new Set(); let headers = 0, oldLines=0, newLines=0;
  for (const line of patch.split(/\r?\n/u)) {
    const hunk=/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/u.exec(line);
    if(hunk){oldLines=hunk[1]===undefined?1:Number(hunk[1]);newLines=hunk[2]===undefined?1:Number(hunk[2]);continue;}
    if(oldLines>0||newLines>0){if(line.startsWith(' ')){oldLines--;newLines--;}else if(line.startsWith('-'))oldLines--;else if(line.startsWith('+'))newLines--;else if(line.startsWith('\\ No newline'))continue;else fail('invalid_patch','Malformed unified-diff hunk.');continue;}
    const header = /^(---|\+\+\+) (.*)$/u.exec(line);
    const rename = /^(?:rename|copy) (?:from|to) (.*)$/u.exec(line);
    if (!header && !rename) continue;
    let value = decodeGitPath(header ? header[2] : rename[1]);
    if (value === '/dev/null') continue;
    if (header) { if (!/^[ab]\//u.test(value)) fail('invalid_patch', 'Text patch paths must use a/ and b/ prefixes.'); value = value.slice(2); headers++; }
    relativePath(value);
    if (value.split('/').some(x => x.toLowerCase() === '.git')) fail('outside_workspace', 'Patches cannot change Git administration paths.');
    paths.add(value);
  }
  if (!headers || !paths.size || paths.size > 100) fail('invalid_patch', 'Patch must name 1..100 workspace files.');
  return [...paths];
}
module.exports = { patchPaths };
