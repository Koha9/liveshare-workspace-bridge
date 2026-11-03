'use strict';
// Shared-terminal transport: every Host request is typed into the selected
// Live Share RW terminal and its framed reply is scraped from pty output.
// Any failure after a command was sent marks the channel uncertain.
const { fail } = require('./core.cjs');
const { compactTerminalText, parseResultFrame, psString, newNonce } = require('./host-bootstrap.cjs');

const SHARED_NAME = /\[(?:shared|共享|共用|共有)[^\]]*\]$/iu;
const READ_ONLY_NAME = /read.?only|只读|唯讀|読み取り専用/iu;
const PAYLOAD_PIECE = 4096;
const RAW_LIMIT = 12 * 1024 * 1024;
const RAW_KEEP = 8 * 1024 * 1024;

function isWritablePty(terminal) {
  const pty = terminal.creationOptions?.pty;
  if (!pty || typeof pty.onDidWrite !== 'function' || typeof pty.handleInput !== 'function') {
    return false;
  }
  return !(pty.isReadonly === true || pty.isReadOnly === true || pty.readOnly === true);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function captureTimeoutError(op, progress) {
  const bind = op === 'hostBind';
  const message = bind
    ? 'No verified response from the Host RW PowerShell. Ask the Host once to open/share it in the project root, then wait.'
    : 'Host response timed out. Inspect the Host before retrying a mutation.';
  const details = {
    receivedCharacters: progress.receivedCharacters,
    payloadCharactersSent: progress.payloadCharactersSent,
    frameStartSeen: progress.raw.includes('LSWB_RESULT:'),
    frameEndSeen: progress.raw.includes('LSWB_END:'),
  };
  return Object.assign(new Error(message), { code: bind ? 'host_terminal_required' : 'host_outcome_unknown', details });
}

function createTerminalTransport({ vscode, permissions, state }) {
  function candidates() {
    if (!permissions.value('terminal.enabled', false) || !permissions.value('agent.enabled', true)) {
      return [];
    }
    const selected = permissions.value('terminal.name', '');
    return vscode.window.terminals.filter(terminal => {
      if (!isWritablePty(terminal)) {
        return false;
      }
      if (selected) {
        return terminal.name === selected;
      }
      return SHARED_NAME.test(terminal.name) && !READ_ONLY_NAME.test(terminal.name);
    });
  }

  function selectTerminal() {
    const matches = candidates();
    if (matches.length !== 1) {
      const code = matches.length ? 'host_terminal_selection_required' : 'host_terminal_required';
      const message = matches.length
        ? 'Choose the exact Host shared read/write PowerShell terminal name in settings.'
        : 'Ask the Host once to open and share a read/write PowerShell terminal, then wait. Do not run in a Guest terminal.';
      fail(code, message, { needsUser: true, candidates: matches.map(x => x.name) });
    }
    return matches[0];
  }

  function capture(terminal, op, nonce, command, timeoutMs, payload) {
    permissions.assert(op);
    return new Promise((resolve, reject) => {
      const pty = terminal.creationOptions.pty;
      const progress = { raw: '', receivedCharacters: 0, payloadCharactersSent: 0 };
      let done = false;
      let sent = false;
      let payloadSent = false;
      let scheduled = null;
      let listener;
      const finish = (error, result) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        if (scheduled) {
          clearTimeout(scheduled);
        }
        listener?.dispose();
        if (state.pending?.nonce === nonce) {
          state.pending = null;
        }
        if (!error) {
          resolve(result);
          return;
        }
        error.details = { ...error.details, requestSent: sent };
        if (sent) {
          state.uncertain = true;
        }
        reject(error);
      };
      const timer = setTimeout(() => finish(captureTimeoutError(op, progress)), timeoutMs);
      async function sendPayload() {
        for (let offset = 0; offset < payload.length; offset += PAYLOAD_PIECE) {
          if (done) {
            return;
          }
          permissions.assert(op);
          const piece = payload.slice(offset, offset + PAYLOAD_PIECE);
          terminal.sendText(piece, offset + PAYLOAD_PIECE >= payload.length);
          progress.payloadCharactersSent += piece.length;
          await delay(2);
        }
      }
      function inspect() {
        scheduled = null;
        if (done) {
          return;
        }
        const compact = compactTerminalText(progress.raw);
        if (payload && !payloadSent && compact.includes(`LSWB_READY:${nonce}`)) {
          payloadSent = true;
          sendPayload().catch(error => finish(error));
        }
        let reply;
        try {
          reply = parseResultFrame(compact, nonce);
        } catch (error) {
          error.code = 'invalid_host_response';
          finish(error);
          return;
        }
        if (reply) {
          finish(null, reply);
        }
      }
      listener = pty.onDidWrite(data => {
        progress.raw += data;
        progress.receivedCharacters += data.length;
        if (progress.raw.length > RAW_LIMIT) {
          progress.raw = progress.raw.slice(-RAW_KEEP);
        }
        if (!scheduled) {
          scheduled = setTimeout(inspect, 5);
        }
      });
      const revoke = reason => {
        finish(Object.assign(new Error(reason.message), { code: 'host_access_revoked', details: reason }));
      };
      state.pending = { nonce, op, terminal, reject: revoke };
      try {
        sent = true;
        terminal.sendText(command, true);
      } catch (error) {
        finish(error);
      }
    });
  }

  // Returns the raw { ok, result | error } reply; the channel interprets it.
  function perform(binding, op, action, options = {}) {
    const nonce = newNonce();
    const payload = Buffer.from(JSON.stringify({ ...action, requestNonce: nonce })).toString('base64');
    const useInput = binding.noEchoInput && payload.length > 2048;
    const argument = useInput ? '-ReadInput' : `-Payload ${psString(payload)}`;
    const command = `& ${psString(binding.functionName)} -Nonce ${psString(nonce)} ` + argument;
    const timeoutMs = options.timeoutMs || 45000;
    return capture(binding.terminal, op, nonce, command, timeoutMs, useInput ? payload : null);
  }

  return { candidates, selectTerminal, capture, perform };
}

module.exports = { createTerminalTransport, isWritablePty };
