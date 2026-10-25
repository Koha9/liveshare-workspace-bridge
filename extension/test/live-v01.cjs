'use strict';
// Explicit real-workspace acceptance: only creates/removes a unique fixture directory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { instances, request } = require('../cli.cjs');
async function main() {
  const available = (await instances()).filter(x => x.info.version.startsWith('0.1.') && x.roots.length);
  assert.equal(available.length, 1, 'Requires exactly one v0.1.x instance attached to Live Share.');
  const instance = available[0]; assert.equal(instance.roots.length, 1);
  const workspace = instance.roots[0].uri, fixture = `liveshare-local-v01-${crypto.randomUUID()}`;
  const marker = `LSLOCAL_V01_${crypto.randomUUID().replaceAll('-', '')}`;
  const receipt = { startedAt: new Date().toISOString(), version: instance.info.version, id: instance.id, epoch: instance.epoch, root: instance.roots[0], trusted: instance.info.trusted, fixture, checks: [], calls: [], limitations: [], cleanup: {} };
  const targets = [];
  async function call(op, args = {}) {
    receipt.calls.push({ op, path: args.path, ...(args.files ? { fileCount: args.files.length } : {}) });
    return request(instance, { instance: instance.id, epoch: instance.epoch, workspace, op, ...args }, 30000);
  }
  async function must(op, args = {}) { const r = await call(op, args); assert.equal(r.ok, true, JSON.stringify(r.error)); return r.result; }
  function pass(name, detail = {}) { receipt.checks.push({ name, passed: true, ...detail }); process.stdout.write(name + ': passed\n'); }
  let failure;
  try {
    const root = await must('list', { path: '' });
    const readme = root.entries.find(x => /^readme\.md$/iu.test(x.name));
    if (readme) {
      const read = await must('read', { path: readme.name, startLine: 1, endLine: 5 });
      assert.equal('hash' in read, false); assert.match(read.uri, /^vsls:/u);
      pass('existing_partial_read_without_hash', { lines: 5, version: read.version });
    }
    await must('mkdir', { path: fixture }); targets.push(fixture);
    await must('mkdir', { path: fixture }); pass('mkdir_idempotent');
    targets.push(`${fixture}/nested`, `${fixture}/nested/deep`);
    const contents = { [`${fixture}/a.js`]: `export const localValue = 1;\n// ${marker}\n`, [`${fixture}/nested/deep/b.js`]: `export function localFunction() { return 10; }\r\n// ${marker}\r\n`, [`${fixture}/empty.txt`]: '' };
    const made = {};
    for (const [file, text] of Object.entries(contents)) {
      targets.push(file);
      const result = await must('create', { path: file, text });
      assert.equal(result.applied, true); assert.equal(result.saved, true); assert.equal(result.dirty, false);
      made[file] = result;
      assert.equal((await must('providerRead', { path: file })).text, text);
    }
    pass('new_LF_CRLF_Unicode_and_empty_files_with_exact_provider_verification', { versions: Object.values(made).map(x => x.version) });
    const conflict = await call('create', { path: `${fixture}/a.js`, text: 'must not overwrite' });
    assert.ok(!conflict.ok || conflict.result.applied === false); pass('create_overwrite_refused');
    const reads = await must('readMany', { files: [{ path: `${fixture}/a.js` }, { path: `${fixture}/nested/deep/b.js` }] });
    assert.ok(reads.files.every(x => x.ok));
    const a = reads.files[0].result, b = reads.files[1].result;
    const stale = await call('write', { path: `${fixture}/a.js`, expectedVersion: -1, text: '' });
    assert.equal(stale.ok, false); assert.equal(stale.error.code, 'content_changed'); pass('stale_version_refused');
    const rejected = await call('edit', { files: [{ path: `${fixture}/a.js`, changes: [{ oldText: 'localValue = 1', newText: 'localValue = 999' }] }, { path: `${fixture}/nested/deep/b.js`, changes: [{ oldText: 'not present', newText: 'bad' }] }] });
    assert.equal(rejected.ok, false); assert.equal(rejected.error.code, 'text_not_found');
    assert.equal((await must('providerRead', { path: `${fixture}/a.js` })).text, contents[`${fixture}/a.js`]); pass('batch_preflight_prevents_partial_modification');
    const edited = await must('edit', { files: [{ path: `${fixture}/a.js`, expectedVersion: a.version, changes: [{ oldText: 'localValue = 1', newText: 'localValue = 2' }, { oldText: `// ${marker}`, newText: `// 中文😀 ${marker}` }] }, { path: `${fixture}/nested/deep/b.js`, expectedVersion: b.version, changes: [{ oldText: 'return 10;', newText: 'return 20;' }] }] });
    assert.equal(edited.applied, true); assert.equal(edited.saved, true); assert.ok(edited.files.every(x => x.saved && !x.dirty));
    assert.equal((await must('providerRead', { path: `${fixture}/a.js` })).text, `export const localValue = 2;\n// 中文😀 ${marker}\n`);
    assert.equal((await must('providerRead', { path: `${fixture}/nested/deep/b.js` })).text, contents[`${fixture}/nested/deep/b.js`].replace('return 10;', 'return 20;'));
    pass('multi_file_multi_edit_targeted_save_preserves_EOL');
    const cleared = await must('write', { path: `${fixture}/a.js`, expectedVersion: edited.files[0].version, text: '' });
    assert.equal(cleared.saved, true); assert.equal((await must('providerRead', { path: `${fixture}/a.js` })).bytes, 0);
    const restored = await must('write', { path: `${fixture}/a.js`, expectedVersion: cleared.files[0].version, text: `export const localValue = 2;\n// ${marker}\n` });
    assert.equal(restored.saved, true); pass('whole_file_clear_and_restore_using_receipt_versions');
    const saved = await must('save', { path: `${fixture}/a.js`, expectedVersion: restored.files[0].version });
    assert.equal(saved.saved, true); pass('targeted_save_without_reapplying_changes');
    const copy = `${fixture}/nested/copy.js`, renamed = `${fixture}/nested/renamed.js`;
    targets.push(copy, renamed);
    assert.equal((await must('copy', { path: `${fixture}/a.js`, to: copy })).copied, true);
    assert.equal((await must('move', { path: copy, to: renamed })).moved, true);
    targets.splice(targets.indexOf(copy), 1); // The source no longer exists after a successful move.
    assert.equal((await must('providerRead', { path: renamed })).text, `export const localValue = 2;\n// ${marker}\n`);
    const refusedCopy = await call('copy', { path: `${fixture}/a.js`, to: `${fixture}/nested/deep/b.js` });
    assert.ok(!refusedCopy.ok || refusedCopy.result.copied === false); pass('file_copy_move_and_overwrite_refusal');
    receipt.stat = await must('stat', { path: renamed }); pass('provider_stat_preserves_unknown_fields');
    receipt.language = {};
    for (const [op, args] of [['diagnostics', { path: `${fixture}/a.js` }], ['symbols', { path: `${fixture}/a.js` }], ['workspaceSymbols', { query: 'localValue' }], ['definition', { path: `${fixture}/a.js`, line: 1, character: 14 }]]) {
      const r = await call(op, args); receipt.language[op] = r;
      assert.equal(r.ok, true, JSON.stringify(r.error));
    }
    pass('language_and_diagnostic_endpoints_return', { note: 'Empty language/diagnostic results are not build or provider acceptance.' });
    const firstDefinition = receipt.language.definition.result.locations?.[0];
    if (firstDefinition) {
      assert.equal(typeof firstDefinition.range.start.line, 'number');
      assert.match(firstDefinition.uri, /^vsls:/u);
      pass('canonical_symbol_position_serialization');
    }
    receipt.pathSearch = await must('findFiles', { pattern: `${fixture}/**/*.js`, useExcludes: false });
    receipt.contentSearch = await must('search', { query: marker, include: fixture, useExcludes: false, waitMs: 1200 });
    assert.equal(receipt.contentSearch.complete, null);
    if (!receipt.contentSearch.snapshot.includes('a.js') || !receipt.contentSearch.snapshot.includes('b.js')) {
      await new Promise(resolve => setTimeout(resolve, 800));
      receipt.contentSearchSecondSnapshot = await must('searchResults', { searchId: receipt.contentSearch.search.id });
    }
    receipt.limitations.push('Native content search is a snapshot with no completion signal; native path search may omit new files.');
    pass('native_search_limited_contract', { pathMatches: receipt.pathSearch.files.length, complete: null });
    const badRoot = await request(instance, { op: 'read', instance: instance.id, epoch: instance.epoch, workspace: 'file:///C:/', path: 'anything' });
    assert.equal(badRoot.ok, false); assert.equal(badRoot.error.code, 'workspace_mismatch');
    const oldEpoch = await request(instance, { op: 'read', instance: instance.id, epoch: instance.epoch - 1, workspace, path: 'a' });
    assert.equal(oldEpoch.ok, false); assert.equal(oldEpoch.error.code, 'workspace_changed'); pass('workspace_and_epoch_binding');
    const skillClient = process.env.LIVESHARE_SKILL_CLIENT || path.join(__dirname, '..', '..', 'skills', 'liveshare-workspace-bridge', 'scripts', 'liveshare.cjs');
    const skillResult = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [skillClient, '--instance', instance.id, '--epoch', String(instance.epoch), '--workspace', workspace], { windowsHide: true });
      let stdout = '', stderr = ''; child.stdout.on('data', x => stdout += x); child.stderr.on('data', x => stderr += x); child.once('error', reject); child.once('close', code => resolve({ code, stdout, stderr }));
      child.stdin.end(JSON.stringify({ op: 'read', path: `${fixture}/a.js`, startLine: 1, endLine: 1 }));
    });
    assert.equal(skillResult.code, 0, skillResult.stdout + skillResult.stderr);
    assert.equal(JSON.parse(skillResult.stdout).result.text, 'export const localValue = 2;'); pass('self_contained_skill_client_real_read');
    receipt.acceptance = 'v0.1_core_passed_search_limitations_retained';
  } catch (err) { failure = err; receipt.failure = err.stack; receipt.acceptance = 'failed'; }
  finally {
    receipt.cleanup.deleted = []; receipt.cleanup.errors = [];
    // Files first, then their known empty parent directories. Never recurse through user data.
    const sorted = [...new Set(targets)].sort((a, b) => b.split('/').length - a.split('/').length || b.length - a.length);
    for (const target of sorted) {
      const r = await call('delete', { path: target });
      if (r.ok) receipt.cleanup.deleted.push(target);
      else if (!['FileNotFound', 'ENOENT'].includes(r.error.code) && !/not found|does not exist|不存在/iu.test(r.error.message)) receipt.cleanup.errors.push({ path: target, error: r.error });
    }
    try { receipt.cleanup.rootAbsent = !(await must('list', { path: '' })).entries.some(x => x.name === fixture); }
    catch (err) { receipt.cleanup.verifyError = err.message; }
    receipt.completedAt = new Date().toISOString();
    const evidenceDirectory = path.join(__dirname, '..', '..', '.local', 'evidence');
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    const destination = path.join(evidenceDirectory, 'live-v0.1-validation.json');
    fs.writeFileSync(destination, JSON.stringify(receipt, null, 2) + '\n');
    process.stdout.write(`receipt: ${destination}\ncleanup: ${JSON.stringify(receipt.cleanup)}\nacceptance: ${receipt.acceptance}\n`);
  }
  if (failure) throw failure;
  assert.equal(receipt.cleanup.rootAbsent, true); assert.deepEqual(receipt.cleanup.errors, []);
}
if (process.env.LIVESHARE_RUN_LIVE !== '1') { process.stdout.write('Real workspace test disabled. Set LIVESHARE_RUN_LIVE=1 explicitly.\n'); }
else main().catch(err => { process.stderr.write(err.stack + '\n'); process.exitCode = 1; });
