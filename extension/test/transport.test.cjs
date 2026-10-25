const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const { request } = require('../cli.cjs');
test('CurrentUserOnly PowerShell pipe round-trips consecutive UTF-8 requests without TCP or tokens', { skip: process.platform !== 'win32', timeout: 20000 }, async t => {
  const pwsh = process.env.LIVESHARE_TEST_PWSH || path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const pipeName = `liveshare-local-${process.pid}-${crypto.randomUUID()}`;
  const child = spawn(pwsh, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(__dirname, '..', 'pipe-host.ps1'), '-PipeName', pipeName], { windowsHide: true });
  let errors = '';
  const received = [];
  child.stderr.on('data', x => errors += x.toString());
  t.after(() => child.kill());
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Host exited ${code}: ${errors}`)));
    readline.createInterface({ input: child.stdout }).on('line', line => {
      const frame = JSON.parse(line);
      if (frame.kind === 'ready') resolve();
      else if (frame.kind === 'request') {
        received.push(frame.body);
        if (frame.body.op !== 'noReply') child.stdin.write(JSON.stringify({ ok: true, result: frame.body }) + '\n');
      }
    });
  });
  await ready;
  for (const text of ['中文😀\r\n', '', 'second request']) {
    const body = { text };
    const response = await request({ pipeName }, body);
    assert.deepEqual(response, { ok: true, result: body });
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(errors, '');
  const id = pipeName.split('-').slice(3).join('-');
  const registry = path.join(os.homedir(), '.liveshare-local', 'instances');
  fs.mkdirSync(registry, { recursive: true });
  const record = path.join(registry, `${id}.json`);
  fs.writeFileSync(record, JSON.stringify({ id, epoch: 1, pipeName, roots: [{ name: 'Transport Test', uri: 'vsls:/' }] }));
  t.after(() => { try { fs.unlinkSync(record); } catch {} });
  const countBefore = received.length;
  const result = await new Promise((resolve, reject) => {
    const cli = spawn(process.execPath, [path.join(__dirname, '..', 'cli.cjs'), '--instance', id, '--epoch', '1', '--workspace', 'vsls:/'], { windowsHide: true });
    let stdout = '', stderr = '';
    cli.stdout.on('data', x => stdout += x.toString()); cli.stderr.on('data', x => stderr += x.toString());
    cli.once('error', reject); cli.once('close', code => resolve({ code, stdout, stderr }));
    cli.stdin.end(JSON.stringify({ op: 'read', path: 'a.txt' }));
  });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(received.length - countBefore, 1, 'Selected instance should receive only the requested operation, without info ping.');
  assert.equal(received.at(-1).op, 'read');
  await assert.rejects(request({ pipeName }, { op: 'noReply' }, 200), { code: 'transport_outcome_unknown', requestSent: true });
  assert.equal(received.filter(x => x.op === 'noReply').length, 1, 'Uncertain requests must never be resent.');
});
test('pipe helper exits when its owning process exits, including while waiting for a client', { skip: process.platform !== 'win32', timeout: 10000 }, async t => {
  const owner = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true });
  const pwsh = process.env.LIVESHARE_TEST_PWSH || path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const helper = spawn(pwsh, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(__dirname, '..', 'pipe-host.ps1'), '-PipeName', `liveshare-local-${process.pid}-${crypto.randomUUID()}`, '-ParentProcessId', String(owner.pid)], { windowsHide: true });
  t.after(() => { owner.kill(); helper.kill(); });
  const exit = new Promise(resolve => helper.once('exit', code => resolve(code)));
  await new Promise((resolve, reject) => {
    helper.once('error', reject);
    readline.createInterface({ input: helper.stdout }).on('line', line => { if (JSON.parse(line).kind === 'ready') resolve(); });
  });
  owner.kill();
  assert.equal(await exit, 0);
});
