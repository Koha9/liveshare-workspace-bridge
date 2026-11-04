'use strict';
// Host channel: binds the shared workspace root to a Host helper and routes
// requests through the selected transport. Requests are strictly serialized;
// an unknown outcome makes the channel uncertain and nothing is replayed.
//
// host.transport = sharedTerminal (default): every request is typed into the
// shared Host terminal. portForward: the terminal starts a foreground Host
// helper once, the Host shares its port through Live Share, and requests use
// loopback TCP.
const crypto = require('node:crypto');
const { fail } = require('./core.cjs');
const bootstrap = require('./host-bootstrap.cjs');
const { createTerminalTransport } = require('./host-transport-terminal.cjs');
const tcp = require('./host-transport-tcp.cjs');

const { psString, renderBootstrap, newNonce } = bootstrap;
const { MUTATION_ACTIONS } = tcp;
const TRANSPORTS = ['sharedTerminal', 'portForward'];
const BANNER_TIMEOUT_MS = 30000;
const SHUTDOWN_TIMEOUT_MS = 1000;
const HANDSHAKE_ATTEMPT_MS = 1500;
const OUTPUT_NAME = 'Live Share Workspace Bridge Host';
const RECOVERY_HINT = 'Before binding again, ask the Host to press Ctrl+C in the shared terminal '
  + 'if the previous Host helper is still running.';

function readHostLimits(permissions) {
  const limits = {
    timeout: permissions.value('terminal.commandTimeoutMs', 120000),
    output: permissions.value('terminal.maxOutputCharacters', 65536),
    ttl: permissions.value('transfer.idleTimeoutMs', 120000),
    chunkBytes: permissions.value('transfer.chunkBytes', 32768),
  };
  const ranges = [
    [limits.timeout, 1000, 3600000],
    [limits.output, 1024, 262144],
    [limits.ttl, 10000, 900000],
    [limits.chunkBytes, 1024, 65536],
  ];
  for (const [value, min, max] of ranges) {
    if (!Number.isInteger(value) || value < min || value > max) {
      fail('invalid_configuration', 'Host timeout, output or transfer limit is outside its supported range.');
    }
  }
  return limits;
}

function readTransport(permissions) {
  const transport = permissions.value('host.transport', 'sharedTerminal');
  if (!TRANSPORTS.includes(transport)) {
    fail('invalid_configuration', 'liveshareWorkspaceBridge.host.transport must be sharedTerminal or portForward.');
  }
  return transport;
}

function readIntegerSetting(permissions, key, fallback, min, max) {
  const value = permissions.value(key, fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    fail('invalid_configuration', `liveshareWorkspaceBridge.${key} must be an integer in ${min}..${max}.`);
  }
  return value;
}

function readPortForwardSettings(permissions) {
  return {
    idleTimeoutMinutes: readIntegerSetting(permissions, 'host.idleTimeoutMinutes', 30, 1, 1440),
    handshakeTimeoutMinutes: readIntegerSetting(permissions, 'host.handshakeTimeoutMinutes', 5, 1, 60),
  };
}

function assertActionPermissions(permissions, op, action) {
  permissions.assert(op);
  if (action.parents === true) {
    permissions.assert('mkdir');
  }
  if (action.overwrite === true) {
    permissions.assert('write');
  }
  if (['readBytes', 'openRead', 'readChunk'].includes(action.action)) {
    permissions.assert('readBytes');
  }
  if (['writeBytes', 'beginWrite', 'writeChunk', 'commitWrite'].includes(action.action)) {
    permissions.assert('writeBytes');
  }
  if (action.action === 'applyPatch') {
    for (const permission of ['edit', 'create', 'move', 'delete']) {
      permissions.assert(permission);
    }
  }
}

function abortReason(reason) {
  const passThrough = ['workspace_changed', 'host_channel_closed', 'host_transport_changed'];
  const code = passThrough.includes(reason?.code) ? reason.code : 'host_access_revoked';
  return Object.assign(new Error(reason?.message || 'Host handshake stopped.'), { code, details: reason });
}

// Best effort only: the helper also exits on idle timeout, Ctrl+C or session end.
function shutdownHelper(target) {
  if (target?.transport !== 'tcp') {
    return Promise.resolve();
  }
  const request = { port: target.port, token: target.token, action: { action: 'shutdown' }, timeoutMs: SHUTDOWN_TIMEOUT_MS };
  return tcp.sendTcpRequest(request).then(() => {}, () => {});
}

function nextStepFor(hostPort) {
  return `Ask the Host to run "Live Share: Share Server" for port ${hostPort}, then call lswb_host_status until bound. `
    + 'Do not retry other Host tools to wait for the handshake. ' + RECOVERY_HINT;
}

/**
 * @param internal Testing only: { handshakeTimeoutMs, handshakeIntervalMs }
 *   override the handshake deadline and poll interval. Product code never
 *   passes it; the deadline comes from host.handshakeTimeoutMinutes.
 */
function createHostChannel(vscode, identity, permissions, internal = {}) {
  const state = { pending: null, uncertain: false };
  const jobs = new Map();
  const transfers = new Map();
  const terminalTransport = createTerminalTransport({ vscode, permissions, state });
  let binding = null;
  let queue = Promise.resolve();
  let disposed = false;
  let output = null;
  let handshake = { state: 'idle', hostPort: null, guestPort: null, message: null, code: null };
  // The forwarded-port handshake that runs after hostBind has returned.
  let handshakeTask = null;
  const bindingKey = root => `${identity.epoch()}\n${root.toString()}`;

  function log(message) {
    if (disposed) {
      return;
    }
    if (!output) {
      output = vscode.window.createOutputChannel?.(OUTPUT_NAME) || null;
    }
    output?.appendLine(message);
  }

  function setHandshake(next) {
    handshake = { ...handshake, ...next };
    if (next.message) {
      log(next.message);
    }
  }

  function isBound(root) {
    if (!binding || binding.key !== bindingKey(root)) {
      return false;
    }
    return binding.transport === 'tcp' || vscode.window.terminals.includes(binding.terminal);
  }

  function clearBinding() {
    const previous = binding;
    binding = null;
    jobs.clear();
    transfers.clear();
    return previous;
  }

  function configuredTransport() {
    try {
      return readTransport(permissions);
    } catch {
      return null;
    }
  }

  function status(root) {
    const transport = configuredTransport();
    const denial = permissions.reason('hostBind');
    if (denial) {
      return { available: false, bound: false, reason: denial.code, message: denial.message, candidates: [], transport, handshake: { ...handshake } };
    }
    const eligible = terminalTransport.candidates();
    const bound = isBound(root);
    let reason = null;
    if (eligible.length !== 1) {
      reason = eligible.length ? 'host_terminal_selection_required' : 'host_terminal_required';
    }
    const result = {
      available: eligible.length === 1,
      bound,
      uncertain: state.uncertain,
      candidates: eligible.map(x => x.name),
      reason,
      transport,
      handshake: { ...handshake },
    };
    if (bound && binding.transport === 'tcp') {
      result.port = binding.port;
    }
    return result;
  }

  function assertEpoch(expectedEpoch) {
    if (identity.epoch() !== expectedEpoch) {
      fail('workspace_changed', 'Workspace changed during Host binding.');
    }
  }

  async function bindTerminal(root, options) {
    const expectedEpoch = identity.epoch();
    const terminal = terminalTransport.selectTerminal();
    const nonce = newNonce();
    const functionName = 'Invoke_Lswb_' + newNonce();
    const script = renderBootstrap();
    const file = bootstrap.prepareBootstrapFile(vscode, root, script);
    const limits = readHostLimits(permissions);
    const chosenRoot = options.hostWorkspacePath || permissions.value('terminal.hostWorkspacePath', '');
    const payload = Buffer.from(JSON.stringify({ action: 'hello', requestNonce: nonce })).toString('base64');
    const command = bootstrap.buildTerminalBindCommand({
      rootExpression: bootstrap.rootExpressionFor(chosenRoot),
      filename: file.filename,
      sha256: file.sha256,
      functionName,
      limits,
      payload,
      nonce,
    });
    try {
      await bootstrap.writeBootstrapFile(vscode, file, script);
      assertEpoch(expectedEpoch);
      permissions.assert('hostBind');
      const response = await terminalTransport.capture(terminal, 'hostBind', nonce, command, 30000);
      if (!response.ok) {
        fail(response.error.code, response.error.message);
      }
      assertEpoch(expectedEpoch);
      if (response.result.protocol !== 2) {
        fail('host_protocol_mismatch', 'Unexpected Host helper protocol.');
      }
      binding = {
        key: bindingKey(root),
        root: root.toString(),
        transport: 'terminal',
        terminal,
        functionName,
        noEchoInput: response.result.noEchoInput === true,
        chunkBytes: response.result.chunkBytes,
      };
      jobs.clear();
      transfers.clear();
      state.uncertain = false;
      return {
        bound: true,
        workspace: root.toString(),
        terminal: terminal.name,
        protocol: 2,
        noEchoInput: binding.noEchoInput,
        chunkBytes: binding.chunkBytes,
      };
    } finally {
      if (identity.epoch() === expectedEpoch) {
        await bootstrap.deleteBootstrapFile(vscode, file);
      }
    }
  }

  // Starts the foreground helper through the shared terminal and returns its
  // banner. The bootstrap file (which holds the token) is deleted as soon as
  // the banner arrives or the attempt ends.
  async function launchHelper(root, terminal, options, expectedEpoch) {
    const limits = readHostLimits(permissions);
    const settings = readPortForwardSettings(permissions);
    const chosenRoot = options.hostWorkspacePath || permissions.value('terminal.hostWorkspacePath', '');
    const requestedPort = await tcp.chooseGuestPort({ excludedRanges: await tcp.queryExcludedPortRanges() });
    const token = crypto.randomBytes(32).toString('hex');
    const nonce = newNonce();
    const script = bootstrap.renderServerBootstrap({
      token,
      port: requestedPort,
      portAttempts: 5,
      idleTimeoutMs: settings.idleTimeoutMinutes * 60000,
      defaultTimeout: limits.timeout,
      outputLimit: limits.output,
      transferTtl: limits.ttl,
      chunkBytes: limits.chunkBytes,
    });
    const file = bootstrap.prepareBootstrapFile(vscode, root, script);
    const command = bootstrap.buildServerLaunchCommand({
      rootExpression: bootstrap.rootExpressionFor(chosenRoot),
      filename: file.filename,
      sha256: file.sha256,
      nonce,
    });
    setHandshake({ state: 'starting', hostPort: null, guestPort: null, code: null, message: `Starting the Host helper (requested port ${requestedPort}).` });
    try {
      await bootstrap.writeBootstrapFile(vscode, file, script);
      assertEpoch(expectedEpoch);
      permissions.assert('hostBind');
      const banner = await bootstrap.awaitListening({
        terminal,
        permissions,
        state,
        op: 'hostBind',
        nonce,
        tokenPrefix: token.slice(0, 8),
        command,
        timeoutMs: BANNER_TIMEOUT_MS,
      });
      return { banner, token, settings };
    } finally {
      if (identity.epoch() === expectedEpoch) {
        await bootstrap.deleteBootstrapFile(vscode, file);
      }
    }
  }

  function guestPortFor(hostPort) {
    const override = readIntegerSetting(permissions, 'host.guestPort', 0, 0, 65535);
    return override > 0 ? override : hostPort;
  }

  function promptHost(hostPort, controller) {
    const message = `Ask the Host to run "Live Share: Share Server" and enter port ${hostPort}. Waiting for the forwarded port…`;
    log(message);
    const shown = vscode.window.showInformationMessage?.(message, 'Cancel');
    Promise.resolve(shown).then(choice => {
      if (choice === 'Cancel' && !controller.signal.aborted) {
        const cancelled = Object.assign(new Error('Host bind cancelled by the user. The Host helper stops on Ctrl+C or its idle timeout.'), { code: 'host_bind_cancelled' });
        controller.abort(cancelled);
      }
    }, () => {});
  }

  async function warnIfLocalPortBusy(hostPort) {
    if (guestPortFor(hostPort) !== hostPort || await tcp.isPortFree(hostPort)) {
      return;
    }
    log(`Local port ${hostPort} is already in use; Live Share may forward the Host port to another local port. If so, set liveshareWorkspaceBridge.host.guestPort.`);
  }

  // Waits until the forwarded port answers hello. Cancellation, permission
  // changes and terminal closure abort the wait; none mark the channel uncertain.
  async function awaitHandshake(terminal, hostPort, token, settings) {
    const controller = new AbortController();
    const nonce = newNonce();
    state.pending = { nonce, op: 'hostBind', terminal, kind: 'handshake', reject: reason => controller.abort(abortReason(reason)) };
    setHandshake({ state: 'waitingForward', hostPort, guestPort: guestPortFor(hostPort) });
    promptHost(hostPort, controller);
    let warned = false;
    const notify = outcome => {
      setHandshake({ guestPort: outcome.port, message: outcome.message });
      if (outcome.reason === 'foreign_port' && !warned) {
        warned = true;
        vscode.window.showWarningMessage?.(outcome.message);
      }
    };
    const attempt = port => tcp.sendTcpRequest({ port, token, action: { action: 'hello' }, timeoutMs: HANDSHAKE_ATTEMPT_MS });
    try {
      return await tcp.awaitForwardedPort({
        attempt,
        targetPort: () => guestPortFor(hostPort),
        notify,
        timeoutMs: internal.handshakeTimeoutMs ?? settings.handshakeTimeoutMinutes * 60000,
        intervalMs: internal.handshakeIntervalMs,
        signal: controller.signal,
      });
    } finally {
      if (state.pending?.nonce === nonce) {
        state.pending = null;
      }
    }
  }

  function setHandshakeFailure(error) {
    const code = error.code || 'error';
    setHandshake({
      state: code === 'host_bind_cancelled' ? 'cancelled' : 'failed',
      code,
      message: `Host bind failed: ${code}: ${error.message} ${RECOVERY_HINT}`,
    });
  }

  function finishHandshakeTask(task) {
    if (handshakeTask === task) {
      handshakeTask = null;
    }
  }

  function installBinding(task, connected, expectedEpoch) {
    finishHandshakeTask(task);
    if (disposed) {
      fail('host_channel_closed', 'Host channel closed during the handshake.');
    }
    assertEpoch(expectedEpoch);
    binding = {
      key: task.key,
      root: task.root,
      transport: 'tcp',
      terminal: task.terminal,
      port: connected.port,
      token: task.token,
      functionName: null,
      chunkBytes: connected.hello.chunkBytes,
      protocol: 3,
    };
    state.uncertain = false;
    setHandshake({ state: 'bound', code: null, guestPort: connected.port, message: `Host helper connected on local port ${connected.port}.` });
    vscode.window.showInformationMessage?.(`Live Share Workspace Bridge: Host helper connected on port ${connected.port}.`);
  }

  // Runs after hostBind has returned. Every outcome is recorded in the
  // handshake status; the promise never rejects.
  function startBackgroundHandshake(root, terminal, launched, expectedEpoch) {
    const { banner, token, settings } = launched;
    const task = { key: bindingKey(root), root: root.toString(), terminal, token, settled: null };
    handshakeTask = task;
    const handshakeDone = awaitHandshake(terminal, banner.port, token, settings);
    task.settled = handshakeDone
      .then(connected => installBinding(task, connected, expectedEpoch))
      .catch(error => {
        finishHandshakeTask(task);
        setHandshakeFailure(error);
      });
    return task;
  }

  function pendingBindResult(task) {
    return {
      bound: false,
      workspace: task.root,
      terminal: task.terminal.name,
      transport: 'portForward',
      handshake: { ...handshake },
      next: nextStepFor(handshake.hostPort),
    };
  }

  function failHandshakePending() {
    const port = handshake.hostPort;
    const details = {
      state: handshake.state,
      hostPort: port,
      guestPort: handshake.guestPort,
      requestSent: false,
      needsUser: true,
    };
    const message = `The Host helper is waiting for the Host to share port ${port} ("Live Share: Share Server"); `
      + 'the request was not sent. Call lswb_host_status until bound instead of retrying this request.';
    fail('host_handshake_pending', message, details);
  }

  async function launchForPortForward(root, terminal, options, expectedEpoch) {
    await shutdownHelper(clearBinding());
    try {
      const launched = await launchHelper(root, terminal, options, expectedEpoch);
      assertEpoch(expectedEpoch);
      if (launched.banner.protocol !== 3) {
        fail('host_protocol_mismatch', 'Unexpected Host helper protocol.');
      }
      await warnIfLocalPortBusy(launched.banner.port);
      return launched;
    } catch (error) {
      setHandshakeFailure(error);
      throw error;
    }
  }

  // Returns as soon as the helper is listening; the forwarded-port handshake
  // continues in the background and is reported by status().
  async function bindPortForward(root, options) {
    if (handshakeTask) {
      if (handshakeTask.key !== bindingKey(root)) {
        failHandshakePending();
      }
      return pendingBindResult(handshakeTask);
    }
    const expectedEpoch = identity.epoch();
    const terminal = terminalTransport.selectTerminal();
    const launched = await launchForPortForward(root, terminal, options, expectedEpoch);
    const task = startBackgroundHandshake(root, terminal, launched, expectedEpoch);
    return pendingBindResult(task);
  }

  // A transport switch must not leave the helper handshake holding the
  // terminal's pending slot while commands are typed there.
  async function abortHandshakeForTransportSwitch() {
    const task = handshakeTask;
    if (!task) {
      return;
    }
    state.pending?.reject({ code: 'host_transport_changed', message: 'host.transport changed while the Host helper handshake was waiting.' });
    await task.settled;
  }

  async function bind(root, options = {}) {
    permissions.assert('hostBind');
    if (state.uncertain && options.acknowledgeRecovery !== true) {
      fail('host_channel_uncertain', 'Inspect the shared Host terminal and explicitly rebind with acknowledgeRecovery:true once idle. No command was replayed.');
    }
    if (readTransport(permissions) === 'portForward') {
      return bindPortForward(root, options);
    }
    await abortHandshakeForTransportSwitch();
    // A running helper occupies the terminal; stop it before typing commands there.
    if (binding?.transport === 'tcp') {
      await shutdownHelper(clearBinding());
    }
    return bindTerminal(root, options);
  }

  // workspace.cjs does not watch host.* settings, so a transport switch is
  // detected here and forces a fresh bind.
  async function dropBindingOnTransportSwitch() {
    const wantsTcp = readTransport(permissions) === 'portForward';
    if (!wantsTcp) {
      await abortHandshakeForTransportSwitch();
    }
    if (!binding) {
      return;
    }
    if (wantsTcp !== (binding.transport === 'tcp')) {
      shutdownHelper(clearBinding());
    }
  }

  function send(op, action, options) {
    if (binding.transport === 'tcp') {
      return tcp.sendTcpRequest({ port: binding.port, token: binding.token, action, timeoutMs: options.timeoutMs, state });
    }
    return terminalTransport.perform(binding, op, action, options);
  }

  async function perform(root, op, action, options = {}) {
    permissions.assert(op);
    await dropBindingOnTransportSwitch();
    if (handshakeTask) {
      failHandshakePending();
    }
    if (!isBound(root)) {
      await bind(root);
    }
    if (!isBound(root)) {
      // A portForward auto-bind only started the handshake.
      failHandshakePending();
    }
    if (state.uncertain) {
      fail('host_channel_uncertain', 'Host command outcome is unknown. Inspect the Host and explicitly recover the binding.');
    }
    assertActionPermissions(permissions, op, action);
    const response = await send(op, action, options);
    if (!response.ok) {
      const details = { action: action.action, mutationMayHaveOccurred: MUTATION_ACTIONS.includes(action.action) };
      fail(response.error.code || 'host_error', response.error.message, details);
    }
    return response.result;
  }

  function enqueue(task) {
    const result = queue.then(() => {
      if (disposed) {
        fail('host_channel_closed', 'Host channel is closed.');
      }
      return task();
    });
    queue = result.catch(() => {});
    return result;
  }

  function request(root, op, action, options) {
    const epoch = identity.epoch();
    return enqueue(() => {
      if (identity.epoch() !== epoch) {
        fail('workspace_changed', 'Workspace changed while the Host request was queued.');
      }
      return perform(root, op, action, options);
    });
  }

  function changed(workspaceChanged = false) {
    const denied = state.pending && permissions.reason(state.pending.op);
    if (denied) {
      state.pending.reject(denied);
    }
    if (workspaceChanged) {
      state.pending?.reject({ code: 'workspace_changed', message: 'Host context changed while a request was in flight.' });
      shutdownHelper(clearBinding());
    }
  }

  function resource(map, id, root) {
    const entry = map.get(id);
    if (!entry || entry.key !== bindingKey(root)) {
      fail('host_resource_not_found', 'The job or transfer does not belong to this workspace binding.');
    }
    return entry;
  }

  // In portForward mode the helper may outlive a closed terminal view, so a
  // binding is not dropped here; the next failing request shows it instead.
  function terminalClosed(terminal) {
    const pending = state.pending;
    if (pending?.terminal === terminal && (pending.kind === 'handshake' || pending.kind === 'banner')) {
      pending.reject({ code: 'host_channel_closed', message: 'The Host terminal closed while the Host helper was starting.' }, false);
      return;
    }
    if ((binding?.transport !== 'tcp' && binding?.terminal === terminal) || pending?.terminal === terminal) {
      changed(true);
    }
  }

  function dispose() {
    disposed = true;
    state.pending?.reject({ code: 'host_channel_closed', message: 'Host channel closed; already-dispatched work may continue until its bounded timeout.' });
    shutdownHelper(clearBinding());
    output?.dispose?.();
    output = null;
  }

  return {
    status,
    bind: (root, options) => enqueue(() => bind(root, options)),
    request,
    jobs,
    transfers,
    resource,
    key: bindingKey,
    terminalClosed,
    changed,
    dispose,
  };
}

module.exports = { createHostChannel, renderBootstrap, psString };
