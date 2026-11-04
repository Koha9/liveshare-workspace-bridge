'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { removeTempDirectory } = require('./temp-cleanup.cjs');
const { installLauncher, launcherPath, renderMcpConfig } = require('../mcp-launcher-install.cjs');

const SOURCE = path.join(__dirname, '..', 'mcp-launcher.cjs');
const NOT_FOUND = 'No running Live Share Workspace Bridge instance was found.';

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => removeTempDirectory(dir, { prefix }));
  return dir;
}

function runLauncher(registryDir, args = []) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, LSWB_REGISTRY_DIR: registryDir };
    const child = spawn(process.execPath, [SOURCE, ...args], { env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

function makeFakeExtension(root, name, body) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'mcp-server.cjs'), body);
  return dir;
}

function writeRecord(registryDir, name, record) {
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(path.join(registryDir, `${name}.json`), JSON.stringify(record));
}

function deadPid() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', ''], { windowsHide: true });
    child.on('error', reject);
    child.on('exit', () => resolve(child.pid));
  });
}

test('installLauncher writes the launcher atomically without leftovers', t => {
  const home = tempDir(t, 'lswb-launcher-install-');
  const registryDir = path.join(home, '.liveshare-local', 'instances');
  const result = installLauncher({ registryDir, sourcePath: SOURCE, log: assert.fail });
  const target = launcherPath(registryDir);
  assert.equal(target, path.join(home, '.liveshare-local', 'mcp-server.cjs'));
  assert.equal(result.installed, true);
  assert.deepEqual(fs.readFileSync(target), fs.readFileSync(SOURCE));
  const leftovers = fs.readdirSync(path.dirname(target)).filter(name => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('installLauncher skips identical content and repairs changed content', t => {
  const home = tempDir(t, 'lswb-launcher-idem-');
  const registryDir = path.join(home, '.liveshare-local', 'instances');
  const target = launcherPath(registryDir);
  installLauncher({ registryDir, sourcePath: SOURCE, log: assert.fail });
  const past = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(target, past, past);
  const again = installLauncher({ registryDir, sourcePath: SOURCE, log: assert.fail });
  assert.equal(again.installed, false);
  assert.equal(fs.statSync(target).mtimeMs, past.getTime());
  fs.writeFileSync(target, '// stale launcher\n');
  const repaired = installLauncher({ registryDir, sourcePath: SOURCE, log: assert.fail });
  assert.equal(repaired.installed, true);
  assert.deepEqual(fs.readFileSync(target), fs.readFileSync(SOURCE));
});

test('installLauncher logs failures instead of throwing', t => {
  const home = tempDir(t, 'lswb-launcher-fail-');
  const registryDir = path.join(home, '.liveshare-local', 'instances');
  const messages = [];
  const result = installLauncher({
    registryDir,
    sourcePath: path.join(home, 'missing.cjs'),
    log: message => messages.push(message),
  });
  assert.equal(result.installed, false);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /MCP launcher install failed/);
  assert.equal(fs.existsSync(launcherPath(registryDir)), false);
});

test('launcher reports a missing instance on stderr only', async t => {
  const registryDir = tempDir(t, 'lswb-launcher-empty-');
  const result = await runLauncher(registryDir);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes(NOT_FOUND));
});

test('launcher ignores invalid records and records without a server file', async t => {
  const root = tempDir(t, 'lswb-launcher-invalid-');
  const registryDir = path.join(root, 'instances');
  const emptyExtension = path.join(root, 'empty-extension');
  fs.mkdirSync(emptyExtension);
  fs.mkdirSync(registryDir);
  fs.writeFileSync(path.join(registryDir, 'garbage.json'), '{not json');
  writeRecord(registryDir, 'string-pid', { extensionPath: emptyExtension, pid: String(process.pid) });
  writeRecord(registryDir, 'no-server', { extensionPath: emptyExtension, pid: process.pid });
  const result = await runLauncher(registryDir);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes(NOT_FOUND));
});

test('launcher forwards argv, stdout and exit code to the server', async t => {
  const root = tempDir(t, 'lswb-launcher-pass-');
  const registryDir = path.join(root, 'instances');
  const body = [
    "process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }) + '\\n');",
    "process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\\n');",
    'process.exit(7);',
  ].join('\n');
  const extensionPath = makeFakeExtension(root, 'extension', body);
  writeRecord(registryDir, 'live', { extensionPath, pid: process.pid });
  const result = await runLauncher(registryDir, ['a', 'b']);
  const expected =
    JSON.stringify({ argv: ['a', 'b'] }) + '\n' +
    JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n';
  assert.equal(result.stdout, expected);
  assert.equal(result.code, 7);
});

test('launcher skips records whose process has exited', async t => {
  const root = tempDir(t, 'lswb-launcher-dead-');
  const registryDir = path.join(root, 'instances');
  const deadExtension = makeFakeExtension(root, 'dead', "process.stdout.write('dead');");
  const liveExtension = makeFakeExtension(root, 'live', "process.stdout.write('alive');");
  // Give the dead record the newer server file so only liveness can exclude it.
  const older = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(path.join(liveExtension, 'mcp-server.cjs'), older, older);
  writeRecord(registryDir, 'dead', { extensionPath: deadExtension, pid: await deadPid() });
  writeRecord(registryDir, 'live', { extensionPath: liveExtension, pid: process.pid });
  const result = await runLauncher(registryDir);
  assert.equal(result.stdout, 'alive');
  assert.equal(result.code, 0);
});

test('launcher breaks equal server mtimes by the newest discovery record', async t => {
  const root = tempDir(t, 'lswb-launcher-tie-');
  const registryDir = path.join(root, 'instances');
  const oldExtension = makeFakeExtension(root, 'old', "process.stdout.write('old');");
  const newExtension = makeFakeExtension(root, 'new', "process.stdout.write('new');");
  const fixed = new Date('1980-01-01T00:00:00Z');
  fs.utimesSync(path.join(oldExtension, 'mcp-server.cjs'), fixed, fixed);
  fs.utimesSync(path.join(newExtension, 'mcp-server.cjs'), fixed, fixed);
  writeRecord(registryDir, 'old', { extensionPath: oldExtension, pid: process.pid });
  writeRecord(registryDir, 'new', { extensionPath: newExtension, pid: process.pid });
  const earlier = new Date('2021-01-01T00:00:00Z');
  fs.utimesSync(path.join(registryDir, 'old.json'), earlier, earlier);
  const result = await runLauncher(registryDir);
  assert.equal(result.stdout, 'new');
});

test('renderMcpConfig renders Windows paths with forward slashes into valid snippets', () => {
  const windowsPath = 'C:\\Users\\x y\\.liveshare-local\\mcp-server.cjs';
  const launcher = 'C:/Users/x y/.liveshare-local/mcp-server.cjs';
  const text = renderMcpConfig(windowsPath);
  assert.ok(!text.includes('\\'), 'snippets must not contain backslashes');
  const lines = text.split('\n');
  assert.ok(lines.includes(`claude mcp add lswb -- node "${launcher}"`));
  assert.ok(lines.includes('[mcp_servers.lswb]'));
  assert.ok(lines.includes('command = "node"'));
  const argsLine = lines.find(line => line.startsWith('args = '));
  assert.deepEqual(JSON.parse(argsLine.slice('args = '.length)), [launcher]);
  const vscodeLine = lines[lines.indexOf('# VS Code (.vscode/mcp.json or user mcp.json)') + 1];
  const vscodeConfig = JSON.parse(vscodeLine);
  assert.deepEqual(vscodeConfig, {
    servers: { lswb: { type: 'stdio', command: 'node', args: [launcher] } },
  });
  assert.match(lines[0], /do not need changes after upgrading/);
});
