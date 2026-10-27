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
const { ACCESS_KEYS, prepareAccess, listLocalUsers, configureAccess } = require('./ipc-access.cjs');
const { createStartupJournal, captureStartupStderr } = require('./startup-diagnostics.cjs');
const version = require('./package.json').version;
const registry = path.join(os.homedir(), '.liveshare-local', 'instances');

function activate(context) {
  if (process.platform !== 'win32') return;
  const output = vscode.window.createOutputChannel('Live Share Workspace Bridge');
  const startup=createStartupJournal({directory:path.join(path.dirname(registry),'startup-diagnostics'),pid:process.pid,version,log:message=>output.appendLine(message)});
  let child = null, ready = false, disposed = false, epoch = 1, id, discovery, ipc, starting=false, generation=0, restartTimer;
  const fallbackState=new Map();
  const migrationState=context.globalState||{get:key=>fallbackState.get(key),update:async(key,value)=>{fallbackState.set(key,value)}};
  const powershellPath=()=>vscode.workspace.getConfiguration('liveshareWorkspaceBridge').get('powershell','')||path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const status = vscode.window.createStatusBarItem?.(vscode.StatusBarAlignment?.Right, 100);
  if (status) { status.command = 'liveshareWorkspaceBridge.openSettings'; context.subscriptions.push(status); }
  function updateStatus() {
    const health=startup.snapshot().current.health;
    if (!status || !api?.roots().length) { if(status&&health==='failed'){status.text='$(warning) LSWB: IPC failed';status.tooltip='Guest local IPC startup failed. Run Show Startup Diagnostics; shell identity/policy scope may be unknown.';status.command='liveshareWorkspaceBridge.showStartupDiagnostics';status.show();}else status?.hide();return; }
    status.command='liveshareWorkspaceBridge.openSettings';
    const agent = api.permissions.value('agent.enabled', true), terminal = api.permissions.value('terminal.enabled', false);
    status.text = !agent ? '$(lock) LSWB: Agent off' : terminal ? '$(terminal) LSWB: Host allowed' : '$(files) LSWB: Guest only';
    status.tooltip = !agent ? 'Agent operations are disabled. Click to configure permissions.' : terminal ? 'Host terminal access is allowed; individual permissions and a verified shared RW terminal are still required. Click to configure permissions.' : 'Host terminal access is disabled. Guest operations follow their individual permissions. Click to configure permissions.';
    status.tooltip+=' Local IPC: '+health+'.';
    if(health==='failed')status.text='$(warning) '+status.text;
    status.show();
  }
  const unregister = () => { if (discovery) { try { fs.unlinkSync(discovery); } catch {} } };
  let api;
  function publish() {
    if (!ready || !api) return;
    fs.mkdirSync(registry, { recursive: true });
    const record = { id, epoch, version, pipeName: `liveshare-local-${process.pid}-${id}`, pid: process.pid, roots: api.roots(), extensionPath: __dirname, ipc };
    const temporary = discovery + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(record));
    fs.renameSync(temporary, discovery);
  }
  function stop() {
    generation++;starting=false;clearTimeout(restartTimer);
    unregister(); ready = false;
    api?.dispose();
    if (child) { child.kill(); child = null; }
    startup.stop();
    updateStatus();
  }
  function start() {
    if (disposed || child || starting) return;
    starting=true;const token=++generation;
    id = crypto.randomUUID(); discovery = path.join(registry, `${id}.json`);
    ipc = { mode: 'starting' };
    api = createWorkspaceApi(vscode, { id, version, epoch: () => epoch, ipc: () => ipc });
    const config=vscode.workspace.getConfiguration('liveshareWorkspaceBridge'),powershell=powershellPath();
    startup.begin(id,epoch,powershell);
    prepareAccess(config,migrationState,()=>listLocalUsers(powershell),vscode.ConfigurationTarget?.Global).then(access=>{
    if(disposed||token!==generation)return;
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'pipe-host.ps1'), '-PipeName', `liveshare-local-${process.pid}-${id}`, '-ParentProcessId', String(process.pid),'-AccessMode',access.mode,'-SelectedSidsBase64',Buffer.from(JSON.stringify(access.selectedUserSids)).toString('base64')];
    startup.stage('process_start');
    const current = spawn(powershell, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child = current;starting=false;
    const currentApi = api;
    const stderrCapture=captureStartupStderr(startup);
    let runtimeStderrNoted=false;
    current.on('error', err => {if(token===generation){startup.spawnError(err.code);updateStatus();}});
    current.stdin.on('error', err => output.appendLine(`IPC response delivery failed: ${err.code}. An operation may have completed without delivery.`));
    current.on('close', () => {if(token!==generation)return;stderrCapture.end();if (child === current) {unregister();ready=false;child=null;startup.exited();updateStatus();} });
    current.stderr.on('data', chunk => {if(token!==generation)return;if(!ready)stderrCapture.write(chunk);else if(!runtimeStderrNoted){runtimeStderrNoted=true;output.appendLine('Guest local IPC helper stderr observed after ready; raw content omitted. This is not classified as a startup failure.');}});
    readline.createInterface({ input: current.stdout }).on('line', async line => {
      let frame;
      try { frame = JSON.parse(line); } catch { output.appendLine('Invalid IPC host frame.'); return; }
      if (frame.kind === 'ready') {
        if (child !== current) return;
        stderrCapture.end();startup.ready(frame.shell);ipc = {...frame.ipc,migratedLegacy:access.migratedLegacy===true}; ready = true; publish();updateStatus(); output.appendLine(`v${version}: local IPC ready (${['ownerOnly','allLocalUsers','selectedUsers'].includes(ipc?.mode)?ipc.mode:'unknown'}).`); return;
      }
      if (frame.kind !== 'request') return;
      let response;
      try { response = { ok: true, result: await currentApi.dispatch(frame.body) }; }
      catch (err) { response = { ok: false, error: { code: err.code || 'vscode_error', message: err.message, ...(err.details ? { details: err.details } : {}) } }; }
      let encoded = JSON.stringify(response);
      if (Buffer.byteLength(encoded, 'utf8') > MAX_RESPONSE) encoded = JSON.stringify({ ok: false, error: { code: 'response_limit', message: 'Response exceeds 4 MiB. Request smaller ranges or fewer files.' } });
      if (!current.killed && current.stdin.writable) current.stdin.write(encoded + '\n');
    });
    }).catch(error=>{if(token===generation){starting=false;startup.setupError(error);updateStatus();}});
  }
  context.subscriptions.push(output);
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { epoch++; api?.workspaceChanged(); publish(); updateStatus(); }));
  if (vscode.workspace.onDidChangeConfiguration) context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => { if (ACCESS_KEYS.some(key=>event.affectsConfiguration('liveshareWorkspaceBridge.'+key))) { if(!starting){stop();epoch++;restartTimer=setTimeout(start,100);} } else api?.configurationChanged(event); updateStatus(); }));
  if (vscode.window.onDidCloseTerminal) context.subscriptions.push(vscode.window.onDidCloseTerminal(terminal => api?.terminalClosed(terminal)));
  context.subscriptions.push(vscode.commands.registerCommand('liveshareWorkspaceBridge.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:Koha9-Lee.liveshare-workspace-bridge')));
  context.subscriptions.push(vscode.commands.registerCommand('liveshareWorkspaceBridge.showStartupDiagnostics',()=>{output.appendLine(JSON.stringify(startup.snapshot()));output.show?.(true);}));
  context.subscriptions.push(vscode.commands.registerCommand('liveshareWorkspaceBridge.configureAccess',async()=>{try{await configureAccess(vscode,()=>listLocalUsers(powershellPath()));}catch(error){await vscode.window.showErrorMessage('IPC access configuration failed: '+error.message);}}));
  context.subscriptions.push(vscode.commands.registerCommand('liveshareWorkspaceBridge.restart', () => { stop(); epoch++; start(); }));
  context.subscriptions.push(vscode.commands.registerCommand('liveshareWorkspaceBridge.stop', () => { stop(); output.appendLine('Stopped by command.'); }));
  context.subscriptions.push({ dispose() { disposed = true; stop();startup.dispose(); } });
  start(); // Also supports joining Live Share after this extension has activated.
  updateStatus();
}
module.exports = { activate };
