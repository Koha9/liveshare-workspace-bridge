'use strict';
// Host channel: binds the shared workspace root to a Host helper and routes
// requests through the selected transport. Requests are strictly serialized;
// an unknown outcome makes the channel uncertain and nothing is replayed.
const { fail } = require('./core.cjs');
const bootstrap = require('./host-bootstrap.cjs');
const { createTerminalTransport } = require('./host-transport-terminal.cjs');

const { psString, renderBootstrap, newNonce } = bootstrap;
const MUTATION_ACTIONS = ['copyFile', 'copyDirectory', 'writeBytes', 'commitWrite', 'applyPatch', 'startJob'];

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

function createHostChannel(vscode, identity, permissions) {
  const state = { pending: null, uncertain: false };
  const jobs = new Map();
  const transfers = new Map();
  const terminalTransport = createTerminalTransport({ vscode, permissions, state });
  let binding = null;
  let queue = Promise.resolve();
  let disposed = false;
  const bindingKey = root => `${identity.epoch()}\n${root.toString()}`;

  function isBound(root) {
    return !!binding && binding.key === bindingKey(root) && vscode.window.terminals.includes(binding.terminal);
  }

  function status(root) {
    const denial = permissions.reason('hostBind');
    if (denial) {
      return { available: false, bound: false, reason: denial.code, message: denial.message, candidates: [] };
    }
    const eligible = terminalTransport.candidates();
    let reason = null;
    if (eligible.length !== 1) {
      reason = eligible.length ? 'host_terminal_selection_required' : 'host_terminal_required';
    }
    return {
      available: eligible.length === 1,
      bound: isBound(root),
      uncertain: state.uncertain,
      candidates: eligible.map(x => x.name),
      reason,
    };
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

  async function bind(root, options = {}) {
    permissions.assert('hostBind');
    if (state.uncertain && options.acknowledgeRecovery !== true) {
      fail('host_channel_uncertain', 'Inspect the shared Host terminal and explicitly rebind with acknowledgeRecovery:true once idle. No command was replayed.');
    }
    return bindTerminal(root, options);
  }

  async function perform(root, op, action, options = {}) {
    permissions.assert(op);
    if (!isBound(root)) {
      await bind(root);
    }
    if (state.uncertain) {
      fail('host_channel_uncertain', 'Host command outcome is unknown. Inspect the Host and explicitly recover the binding.');
    }
    assertActionPermissions(permissions, op, action);
    const response = await terminalTransport.perform(binding, op, action, options);
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
      binding = null;
      jobs.clear();
      transfers.clear();
    }
  }

  function resource(map, id, root) {
    const entry = map.get(id);
    if (!entry || entry.key !== bindingKey(root)) {
      fail('host_resource_not_found', 'The job or transfer does not belong to this workspace binding.');
    }
    return entry;
  }

  function terminalClosed(terminal) {
    if (binding?.terminal === terminal || state.pending?.terminal === terminal) {
      changed(true);
    }
  }

  function dispose() {
    disposed = true;
    state.pending?.reject({ code: 'host_channel_closed', message: 'Host channel closed; already-dispatched work may continue until its bounded timeout.' });
    binding = null;
    jobs.clear();
    transfers.clear();
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
