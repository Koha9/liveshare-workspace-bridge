'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { MAX_RESPONSE } = require('./core.cjs');
const { createWorkspaceApi } = require('./workspace.cjs');
const version = require('./package.json').version;
const registry = path.join(os.homedir(), '.liveshare-local', 'instances');

function activate(context) {
  if (process.platform !== 'win32') return;
  const output = vscode.window.createOutputChannel('Live Share Workspace Bridge');
  let child = null, ready = false, disposed = false, epoch = 1, id, discovery;
  const status = vscode.window.createStatusBarItem?.(vscode.StatusBarAlignment?.Right, 100);
  if (status) { status.command = 'liveshareWorkspaceBridge.openSettings'; context.subscriptions.push(status); }
  function updateStatus() {
    if (!status || !api?.roots().length) { status?.hide(); return; }
    const agent = api.permissions.value('agent.enabled', true), terminal = api.permissions.value('terminal.enabled', false);
    status.text = !agent ? '$(lock) LSWB: Agent off' : terminal ? '$(terminal) LSWB: Host allowed' : '$(files) LSWB: Guest only';
    status.tooltip = !agent ? 'Agent operations are disabled. Click to configure permissions.' : terminal ? 'Host terminal access is allowed; individual permissions and a verified shared RW terminal are still required. Click to configure permissions.' : 'Host terminal access is disabled. Guest operations follow their individual permissions. Click to configure permissions.';
    status.show();
  }
  const unregister = () => { if (discovery) { try { fs.unlinkSync(discovery); } catch {} } };
  let api;
  function publish() {
    if (!ready || !api) return;
    fs.mkdirSync(registry, { recursive: true });
    const record = { id, epoch, version, pipeName: `liveshare-local-${process.pid}-${id}`, pid: process.pid, roots: api.roots(), extensionPath: __dirname };
    const temporary = discovery + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(record));
    fs.renameSync(temporary, discovery);
  }
  function stop() {
    unregister(); ready = false;
    api?.dispose();
    if (child) { child.kill(); child = null; }
  }
  function start() {
    if (disposed || child) return;
    id = crypto.randomUUID(); discovery = path.join(registry, `${id}.json`);
    api = createWorkspaceApi(vscode, { id, version, epoch: () => epoch });
    const powershell = vscode.workspace.getConfiguration('liveshareWorkspaceBridge').get('powershell', '') || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const current = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'pipe-host.ps1'), '-PipeName', `liveshare-local-${process.pid}-${id}`, '-ParentProcessId', String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child = current;
    const currentApi = api;
    current.on('error', err => output.appendLine(`IPC host unavailable: ${err.message}`));
    current.stdin.on('error', err => output.appendLine(`IPC response delivery failed: ${err.code}. An operation may have completed without delivery.`));
    current.on('exit', () => { if (child === current) { unregister(); ready = false; child = null; } });
    current.stderr.on('data', chunk => output.append(chunk.toString()));
    readline.createInterface({ input: current.stdout }).on('line', async line => {
      let frame;
      try { frame = JSON.parse(line); } catch { output.appendLine('Invalid IPC host frame.'); return; }
      if (frame.kind === 'ready') {
        if (child !== current) return;
        ready = true; publish(); output.appendLine(`v${version}: current-user IPC ready.`); return;
      }
      if (frame.kind !== 'request') return;
      let response;
      try { response = { ok: true, result: await currentApi.dispatch(frame.body) }; }
      catch (err) { response = { ok: false, error: { code: err.code || 'vscode_error', message: err.message, ...(err.details ? { details: err.details } : {}) } }; }
      let encoded = JSON.stringify(response);
      if (Buffer.byteLength(encoded, 'utf8') > MAX_RESPONSE) encoded = JSON.stringify({ ok: false, error: { code: 'response_limit', message: 'Response exceeds 4 MiB. Request smaller ranges or fewer files.' } });
      if (!current.killed && current.stdin.writable) current.stdin.write(encoded + '\n');
    });
  }
  context.subscriptions.push(output);
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { epoch++; api?.workspaceChanged(); publish(); updateStatus(); }));
  if (vscode.workspace.onDidChangeConfiguration) context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => { api?.configurationChanged(event); updateStatus(); }));
  if (vscode.window.onDidCloseTerminal) context.subscriptions.push(vscode.window.onDidCloseTerminal(terminal => api?.terminalClosed(terminal)));
  context.subscriptions.push(vscode.commands.registerCommand('liveshareWorkspaceBridge.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:Koha9-Lee.liveshare-workspace-bridge')));
  context.subscriptions.push(vscode.commands.registerCommand('liveshareWorkspaceBridge.restart', () => { stop(); epoch++; start(); }));
  context.subscriptions.push(vscode.commands.registerCommand('liveshareWorkspaceBridge.stop', () => { stop(); output.appendLine('Stopped by command.'); }));
  context.subscriptions.push({ dispose() { disposed = true; stop(); } });
  start(); // Also supports joining Live Share after this extension has activated.
  updateStatus();
}
module.exports = { activate };
