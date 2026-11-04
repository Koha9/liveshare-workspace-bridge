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
const { MODES, ACCESS_KEYS, prepareAccess, listLocalUsers, configureAccess, noticeRemovedMode } = require('./ipc-access.cjs');
const { createStartupJournal, captureStartupStderr } = require('./startup-diagnostics.cjs');
const { installLauncher, launcherPath, renderMcpConfig } = require('./mcp-launcher-install.cjs');
const { registerMcpDefinitionProvider } = require('./mcp-definition-provider.cjs');
const { cleanupStaleRecords } = require('./registry-cleanup.cjs');
const version = require('./package.json').version;
const registry = path.join(os.homedir(), '.liveshare-local', 'instances');

// The helper reports the mode it enforces; keep the ignored User value visible.
function readyIpc(helperIpc, access) {
  const result = { ...helperIpc, migratedLegacy: access.migratedLegacy === true };
  if (access.deprecatedModeIgnored === true) {
    result.requestedMode = access.requestedMode;
    result.deprecatedModeIgnored = true;
  }
  return result;
}

// Reload or a crash can skip dispose; remove records of exited windows once.
// Failures are logged by code only and never block activation.
function removeLeftoverRecords(log) {
  let result;
  try {
    result = cleanupStaleRecords({ registryPath: registry });
  } catch (error) {
    log(`Discovery record cleanup skipped: ${error.code || 'cleanup_failed'}.`);
    return;
  }
  if (result.removed.length) log(`Removed ${result.removed.length} discovery record(s) left by exited VS Code windows.`);
  for (const issue of result.issues) log(`Discovery record cleanup issue: ${issue.code}.`);
}

function activate(context) {
  if (process.platform !== 'win32') return;
  const output = vscode.window.createOutputChannel('Live Share Workspace Bridge');
  const startup=createStartupJournal({directory:path.join(path.dirname(registry),'startup-diagnostics'),pid:process.pid,version,log:message=>output.appendLine(message)});
  let child = null, ready = false, disposed = false, epoch = 1, id, discovery, ipc, starting=false, generation=0, restartTimer;
  let recoveryAttempts = 0, readyAt = 0, dispatchQueue = Promise.resolve();
  const noticeSession = {};
  const fallbackState=new Map();
  const migrationState=context.globalState||{get:key=>fallbackState.get(key),update:async(key,value)=>{fallbackState.set(key,value)}};
  const powershellPath=()=>vscode.workspace.getConfiguration('liveshareWorkspaceBridge').get('powershell','')||path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const status = vscode.window.createStatusBarItem?.(vscode.StatusBarAlignment?.Right, 100);
  if (status) { status.command = 'liveshareWorkspaceBridge.openSettings'; context.subscriptions.push(status); }
  function updateStatus() {
    const health=startup.snapshot().current.health;
    if (!status || !api?.roots().length) { if(status&&health==='failed'){status.text='$(warning) LSWB: IPC failed';status.tooltip='Guest local IPC startup failed. Run Show Startup Diagnostics; shell identity/policy scope may be unknown.';status.command='liveshareWorkspaceBridge.showStartupDiagnostics';status.show();}else status?.hide();return; }
    status.command='liveshareWorkspaceBridge.openSettings';
    const agent = api.permissions.value('agent.enabled', true);
    const hostEnabled = api.permissions.value('host.enabled', false);
    status.text = !agent ? '$(lock) LSWB: Agent off' : hostEnabled ? '$(terminal) LSWB: Host allowed' : '$(files) LSWB: Guest only';
    status.tooltip = !agent ? 'Agent operations are disabled. Click to configure permissions.' : hostEnabled ? 'Host access is allowed; individual permissions and a shared RW terminal to start the Host helper are still required. Click to configure permissions.' : 'Host access is disabled. Guest operations follow their individual permissions. Click to configure permissions.';
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
    // Keep Host uncertainty across an explicit restart; it is not an acknowledgement
    // that a previously dispatched command finished. Invalidate its binding only.
    api?.workspaceChanged();
    if (child) { child.kill(); child = null; }
    startup.stop();
    updateStatus();
  }
  function start(recover = false) {
    if (disposed || child || starting) return;
    starting=true;const token=++generation;
    if (!recover) { id = crypto.randomUUID(); recoveryAttempts = 0; }
    discovery = path.join(registry, `${id}.json`);
    ipc = { mode: 'starting' };
    api ||= createWorkspaceApi(vscode, { get id() { return id; }, version, epoch: () => epoch, ipc: () => ipc });
    const config=vscode.workspace.getConfiguration('liveshareWorkspaceBridge'),powershell=powershellPath();
    startup.begin(id,epoch,powershell);
    prepareAccess(config,migrationState,()=>listLocalUsers(powershell),vscode.ConfigurationTarget?.Global).then(access=>{
    if(disposed||token!==generation)return;
    // The prompt must never delay or block the helper start.
    noticeRemovedMode(vscode,access,noticeSession,line=>output.appendLine(line))
      .catch(error=>output.appendLine('IPC access notice failed: '+error.message));
    const args =['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'pipe-host.ps1'), '-PipeName', `liveshare-local-${process.pid}-${id}`, '-ParentProcessId', String(process.pid),'-AccessMode',access.mode,'-SelectedSidsBase64',Buffer.from(JSON.stringify(access.selectedUserSids)).toString('base64')];
    startup.stage('process_start');
    const current = spawn(powershell, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child = current;starting=false;
    const currentApi = api;
    const stderrCapture=captureStartupStderr(startup);
    let runtimeStderrNoted=false;
    current.on('error', err => {if(token===generation){startup.spawnError(err.code);updateStatus();}});
    current.stdin.on('error', err => output.appendLine(`IPC response delivery failed: ${err.code}. An operation may have completed without delivery.`));
    current.on('close', () => {
      if (token !== generation) return;
      stderrCapture.end();
      if (child !== current) return;
      const wasReady = ready;
      unregister(); ready = false; child = null; startup.exited();
      // Recover only a helper that actually reached ready. Startup/security errors
      // need diagnosis, not an endless process loop. Stop/dispose invalidate token.
      if (wasReady && !disposed) {
        if (Date.now() - readyAt >= 60000) recoveryAttempts = 0;
        if (recoveryAttempts < 3) {
          const delay = 1000 * 2 ** recoveryAttempts++;
          output.appendLine(`Local IPC helper exited; reconnecting in ${delay} ms (attempt ${recoveryAttempts}/3). Sent requests are not replayed.`);
          restartTimer = setTimeout(() => { if (token === generation) start(true); }, delay);
        } else output.appendLine('Local IPC recovery paused after three unstable restarts. Run Show Startup Diagnostics, then Restart Connection when appropriate.');
      }
      updateStatus();
    });
    current.stderr.on('data', chunk => {if(token!==generation)return;if(!ready)stderrCapture.write(chunk);else if(!runtimeStderrNoted){runtimeStderrNoted=true;output.appendLine('Guest local IPC helper stderr observed after ready; raw content omitted. This is not classified as a startup failure.');}});
    readline.createInterface({ input: current.stdout }).on('line', async line => {
      if (token !== generation || child !== current) return;
      let frame;
      try { frame = JSON.parse(line); } catch { output.appendLine('Invalid IPC host frame.'); return; }
      if (frame.kind === 'ready') {
        if (child !== current) return;
        stderrCapture.end();
        startup.ready(frame.shell);
        ipc = readyIpc(frame.ipc, access);
        ready = true;
        readyAt = Date.now();
        publish();
        updateStatus();
        const mode = MODES.includes(ipc?.mode) ? ipc.mode : 'unknown';
        output.appendLine(`v${version}: local IPC ready (${mode}).`);
        return;
      }
      if (frame.kind !== 'request') return;
      let response;
      try {
        // Retain serialization across helper replacement, including a request
        // still running after its client's transport has disappeared.
        const dispatch = () => {
          if (token !== generation || child !== current) throw Object.assign(new Error('IPC connection was replaced before dispatch.'), { code: 'transport_unavailable' });
          return currentApi.dispatch(frame.body);
        };
        // info and hostStatus only report local state: discovery and Host
        // handshake status must remain usable while an old request is
        // finishing. All workspace work stays queued.
        const readsLocalState = ['info', 'hostStatus'].includes(frame.body?.op);
        const work = (readsLocalState ? Promise.resolve() : dispatchQueue).then(dispatch);
        if (!readsLocalState) {
          dispatchQueue = work.catch(() => {});
        }
        response = { ok: true, result: await work };
      }
      catch (err) { response = { ok: false, error: { code: err.code || 'vscode_error', message: err.message, ...(err.details ? { details: err.details } : {}) } }; }
      let encoded = JSON.stringify(response);
      if (Buffer.byteLength(encoded, 'utf8') > MAX_RESPONSE) encoded = JSON.stringify({ ok: false, error: { code: 'response_limit', message: 'Response exceeds 4 MiB. Request smaller ranges or fewer files.' } });
      if (token === generation && child === current && !current.killed && current.stdin.writable) current.stdin.write(encoded + '\n');
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
  context.subscriptions.push(vscode.commands.registerCommand('liveshareWorkspaceBridge.copyMcpConfig', () => copyMcpConfig(output)));
  context.subscriptions.push({ dispose() { disposed = true; stop();api?.dispose();startup.dispose(); } });
  // Install the stable launcher once per activation, independent of IPC readiness.
  installLauncher({
    registryDir: registry,
    sourcePath: path.join(__dirname, 'mcp-launcher.cjs'),
    log: message => output.appendLine(message),
  });
  context.subscriptions.push(registerMcpDefinitionProvider({
    vscode,
    extensionDir: __dirname,
    version,
    log: message => output.appendLine(message),
  }));
  removeLeftoverRecords(message => output.appendLine(message));
  start(); // Also supports joining Live Share after this extension has activated.
  updateStatus();
}
async function copyMcpConfig(output) {
  const text = renderMcpConfig(launcherPath(registry));
  output.appendLine(text);
  output.show?.(true);
  const clipboard = vscode.env?.clipboard;
  if (!clipboard) {
    return;
  }
  try {
    await clipboard.writeText(text);
  } catch (error) {
    output.appendLine(`Clipboard write failed: ${error.message}`);
    await vscode.window.showErrorMessage?.('Copying the MCP configuration failed: ' + error.message);
    return;
  }
  await vscode.window.showInformationMessage?.('MCP configuration copied to the clipboard.');
}
module.exports = { activate };
