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

const SECTION = 'liveshareWorkspaceBridge';
const RECOVERY_LIMIT = 3;
const STABLE_HELPER_MS = 60000;
const ACCESS_RESTART_DELAY_MS = 100;
const LOCAL_STATE_OPS = ['info', 'hostStatus'];

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

function pipeName(id) {
  return `liveshare-local-${process.pid}-${id}`;
}

function defaultPowerShell() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function helperArgs(id, access) {
  const selected = Buffer.from(JSON.stringify(access.selectedUserSids)).toString('base64');
  return [
    '-NoLogo', '-NoProfile', '-NonInteractive',
    '-File', path.join(__dirname, 'pipe-host.ps1'),
    '-PipeName', pipeName(id),
    '-ParentProcessId', String(process.pid),
    '-AccessMode', access.mode,
    '-SelectedSidsBase64', selected,
  ];
}

function statusText(agent, hostEnabled) {
  if (!agent) return '$(lock) LSWB: Agent off';
  if (hostEnabled) return '$(terminal) LSWB: Host allowed';
  return '$(files) LSWB: Guest only';
}

function statusTooltip(agent, hostEnabled) {
  if (!agent) return 'Agent operations are disabled. Click to configure permissions.';
  if (hostEnabled) return 'Host access is allowed; individual permissions and a shared RW terminal to start the Host helper are still required. Click to configure permissions.';
  return 'Host access is disabled. Guest operations follow their individual permissions. Click to configure permissions.';
}

function errorResponse(err) {
  const error = { code: err.code || 'vscode_error', message: err.message };
  if (err.details) error.details = err.details;
  return { ok: false, error };
}

function encodeResponse(response) {
  const encoded = JSON.stringify(response);
  if (Buffer.byteLength(encoded, 'utf8') <= MAX_RESPONSE) return encoded;
  return JSON.stringify({ ok: false, error: { code: 'response_limit', message: 'Response exceeds 4 MiB. Request smaller ranges or fewer files.' } });
}

function activate(context) {
  if (process.platform !== 'win32') return;
  const output = vscode.window.createOutputChannel('Live Share Workspace Bridge');
  const log = message => output.appendLine(message);
  const startup = createStartupJournal({
    directory: path.join(path.dirname(registry), 'startup-diagnostics'),
    pid: process.pid,
    version,
    log,
  });
  let child = null;
  let ready = false;
  let disposed = false;
  let epoch = 1;
  let id;
  let discovery;
  let ipc;
  let starting = false;
  let generation = 0;
  let restartTimer;
  let recoveryAttempts = 0;
  let readyAt = 0;
  let dispatchQueue = Promise.resolve();
  let api;
  const noticeSession = {};
  const fallbackState = new Map();
  const migrationState = context.globalState || {
    get: key => fallbackState.get(key),
    update: async (key, value) => { fallbackState.set(key, value); },
  };
  const powershellPath = () => vscode.workspace.getConfiguration(SECTION).get('powershell', '') || defaultPowerShell();
  const status = vscode.window.createStatusBarItem?.(vscode.StatusBarAlignment?.Right, 100);
  if (status) {
    status.command = 'liveshareWorkspaceBridge.openSettings';
    context.subscriptions.push(status);
  }

  function showStartupFailure() {
    status.text = '$(warning) LSWB: IPC failed';
    status.tooltip = 'Guest local IPC startup failed. Run Show Startup Diagnostics; shell identity/policy scope may be unknown.';
    status.command = 'liveshareWorkspaceBridge.showStartupDiagnostics';
    status.show();
  }

  function updateStatus() {
    const health = startup.snapshot().current.health;
    if (!status || !api?.roots().length) {
      if (status && health === 'failed') showStartupFailure();
      else status?.hide();
      return;
    }
    status.command = 'liveshareWorkspaceBridge.openSettings';
    const agent = api.permissions.value('agent.enabled', true);
    const hostEnabled = api.permissions.value('host.enabled', false);
    status.text = statusText(agent, hostEnabled);
    status.tooltip = statusTooltip(agent, hostEnabled);
    status.tooltip += ' Local IPC: ' + health + '.';
    if (health === 'failed') status.text = '$(warning) ' + status.text;
    status.show();
  }

  const unregister = () => {
    if (!discovery) return;
    try {
      fs.unlinkSync(discovery);
    } catch {}
  };

  // Write to a temporary file and rename, so readers never see a partial record.
  function publish() {
    if (!ready || !api) return;
    fs.mkdirSync(registry, { recursive: true });
    const record = { id, epoch, version, pipeName: pipeName(id), pid: process.pid, roots: api.roots(), extensionPath: __dirname, ipc };
    const temporary = discovery + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(record));
    fs.renameSync(temporary, discovery);
  }

  function stop() {
    generation++;
    starting = false;
    clearTimeout(restartTimer);
    unregister();
    ready = false;
    // Keep Host uncertainty across an explicit restart; it is not an acknowledgement
    // that a previously dispatched command finished. Invalidate its binding only.
    api?.workspaceChanged();
    if (child) {
      child.kill();
      child = null;
    }
    startup.stop();
    updateStatus();
  }

  function start(recover = false) {
    if (disposed || child || starting) return;
    starting = true;
    const token = ++generation;
    if (!recover) {
      id = crypto.randomUUID();
      recoveryAttempts = 0;
    }
    discovery = path.join(registry, `${id}.json`);
    ipc = { mode: 'starting' };
    api ||= createWorkspaceApi(vscode, { get id() { return id; }, version, epoch: () => epoch, ipc: () => ipc });
    const config = vscode.workspace.getConfiguration(SECTION);
    const powershell = powershellPath();
    startup.begin(id, epoch, powershell);
    // Errors thrown while launching are setup errors too, so catch after then.
    prepareAccess(config, migrationState, () => listLocalUsers(powershell), vscode.ConfigurationTarget?.Global)
      .then(access => launchHelper(token, powershell, access))
      .catch(error => {
        if (token !== generation) return;
        starting = false;
        startup.setupError(error);
        updateStatus();
      });
  }

  function launchHelper(token, powershell, access) {
    if (disposed || token !== generation) return;
    // The prompt must never delay or block the helper start.
    noticeRemovedMode(vscode, access, noticeSession, log)
      .catch(error => log('IPC access notice failed: ' + error.message));
    const args = helperArgs(id, access);
    startup.stage('process_start');
    const current = spawn(powershell, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child = current;
    starting = false;
    // One helper run; every handler checks it is still the current one.
    const run = { token, current, api, access, stderrCapture: captureStartupStderr(startup), runtimeStderrNoted: false };
    current.on('error', err => {
      if (token !== generation) return;
      startup.spawnError(err.code);
      updateStatus();
    });
    current.stdin.on('error', err => log(`IPC response delivery failed: ${err.code}. An operation may have completed without delivery.`));
    current.on('close', () => onHelperClose(run));
    current.stderr.on('data', chunk => onHelperStderr(run, chunk));
    readline.createInterface({ input: current.stdout }).on('line', line => onHelperLine(run, line));
  }

  function onHelperClose(run) {
    if (run.token !== generation) return;
    run.stderrCapture.end();
    if (child !== run.current) return;
    const wasReady = ready;
    unregister();
    ready = false;
    child = null;
    startup.exited();
    // Recover only a helper that actually reached ready. Startup/security errors
    // need diagnosis, not an endless process loop. Stop/dispose invalidate token.
    if (wasReady && !disposed) scheduleRecovery(run.token);
    updateStatus();
  }

  function scheduleRecovery(token) {
    if (Date.now() - readyAt >= STABLE_HELPER_MS) recoveryAttempts = 0;
    if (recoveryAttempts >= RECOVERY_LIMIT) {
      log('Local IPC recovery paused after three unstable restarts. Run Show Startup Diagnostics, then Restart Connection when appropriate.');
      return;
    }
    const delay = 1000 * 2 ** recoveryAttempts++;
    log(`Local IPC helper exited; reconnecting in ${delay} ms (attempt ${recoveryAttempts}/3). Sent requests are not replayed.`);
    restartTimer = setTimeout(() => {
      if (token === generation) start(true);
    }, delay);
  }

  function onHelperStderr(run, chunk) {
    if (run.token !== generation) return;
    if (!ready) {
      run.stderrCapture.write(chunk);
      return;
    }
    if (run.runtimeStderrNoted) return;
    run.runtimeStderrNoted = true;
    log('Guest local IPC helper stderr observed after ready; raw content omitted. This is not classified as a startup failure.');
  }

  async function onHelperLine(run, line) {
    if (run.token !== generation || child !== run.current) return;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      log('Invalid IPC host frame.');
      return;
    }
    if (frame.kind === 'ready') {
      onHelperReady(run, frame);
      return;
    }
    if (frame.kind !== 'request') return;
    const encoded = encodeResponse(await respond(run, frame.body));
    const current = run.current;
    if (run.token === generation && child === current && !current.killed && current.stdin.writable) current.stdin.write(encoded + '\n');
  }

  function onHelperReady(run, frame) {
    if (child !== run.current) return;
    run.stderrCapture.end();
    startup.ready(frame.shell);
    ipc = readyIpc(frame.ipc, run.access);
    ready = true;
    readyAt = Date.now();
    publish();
    updateStatus();
    const mode = MODES.includes(ipc?.mode) ? ipc.mode : 'unknown';
    log(`v${version}: local IPC ready (${mode}).`);
  }

  async function respond(run, body) {
    try {
      // Retain serialization across helper replacement, including a request
      // still running after its client's transport has disappeared.
      const dispatch = () => {
        if (run.token !== generation || child !== run.current) {
          throw Object.assign(new Error('IPC connection was replaced before dispatch.'), { code: 'transport_unavailable' });
        }
        return run.api.dispatch(body);
      };
      // info and hostStatus only report local state: discovery and Host
      // handshake status must remain usable while an old request is
      // finishing. All workspace work stays queued.
      const readsLocalState = LOCAL_STATE_OPS.includes(body?.op);
      const work = (readsLocalState ? Promise.resolve() : dispatchQueue).then(dispatch);
      if (!readsLocalState) {
        dispatchQueue = work.catch(() => {});
      }
      return { ok: true, result: await work };
    } catch (err) {
      return errorResponse(err);
    }
  }

  function onConfigurationChanged(event) {
    if (ACCESS_KEYS.some(key => event.affectsConfiguration(SECTION + '.' + key))) {
      if (!starting) {
        stop();
        epoch++;
        restartTimer = setTimeout(start, ACCESS_RESTART_DELAY_MS);
      }
    } else {
      api?.configurationChanged(event);
    }
    updateStatus();
  }

  function onWorkspaceFoldersChanged() {
    epoch++;
    api?.workspaceChanged();
    publish();
    updateStatus();
  }

  function showStartupDiagnostics() {
    log(JSON.stringify(startup.snapshot()));
    output.show?.(true);
  }

  async function runConfigureAccess() {
    try {
      await configureAccess(vscode, () => listLocalUsers(powershellPath()));
    } catch (error) {
      await vscode.window.showErrorMessage('IPC access configuration failed: ' + error.message);
    }
  }

  function register(command, callback) {
    context.subscriptions.push(vscode.commands.registerCommand(command, callback));
  }

  context.subscriptions.push(output);
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(onWorkspaceFoldersChanged));
  if (vscode.workspace.onDidChangeConfiguration) context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onConfigurationChanged));
  if (vscode.window.onDidCloseTerminal) context.subscriptions.push(vscode.window.onDidCloseTerminal(terminal => api?.terminalClosed(terminal)));
  register('liveshareWorkspaceBridge.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:Koha9-Lee.liveshare-workspace-bridge'));
  register('liveshareWorkspaceBridge.showStartupDiagnostics', showStartupDiagnostics);
  register('liveshareWorkspaceBridge.configureAccess', runConfigureAccess);
  register('liveshareWorkspaceBridge.restart', () => {
    stop();
    epoch++;
    start();
  });
  register('liveshareWorkspaceBridge.stop', () => {
    stop();
    log('Stopped by command.');
  });
  register('liveshareWorkspaceBridge.copyMcpConfig', () => copyMcpConfig(output));
  context.subscriptions.push({
    dispose() {
      disposed = true;
      stop();
      api?.dispose();
      startup.dispose();
    },
  });
  // Install the stable launcher once per activation, independent of IPC readiness.
  installLauncher({
    registryDir: registry,
    sourcePath: path.join(__dirname, 'mcp-launcher.cjs'),
    log,
  });
  context.subscriptions.push(registerMcpDefinitionProvider({
    vscode,
    extensionDir: __dirname,
    version,
    log,
  }));
  removeLeftoverRecords(log);
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
