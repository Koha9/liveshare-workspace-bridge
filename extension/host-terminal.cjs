'use strict';
// Selects the shared Host terminal used once to start the Host helper. Only a
// Live Share shared read/write pty qualifies; ordinary Guest terminals and
// known read-only shares are never selected. No request travels through it.
const { fail } = require('./core.cjs');

const SHARED_NAME = /\[(?:shared|共享|共用|共有)[^\]]*\]$/iu;
const READ_ONLY_NAME = /read.?only|只读|唯讀|読み取り専用/iu;

function isWritablePty(terminal) {
  const pty = terminal.creationOptions?.pty;
  if (!pty || typeof pty.onDidWrite !== 'function' || typeof pty.handleInput !== 'function') {
    return false;
  }
  return !(pty.isReadonly === true || pty.isReadOnly === true || pty.readOnly === true);
}

function createTerminalSelector({ vscode, permissions }) {
  function candidates() {
    if (!permissions.value('host.enabled', false) || !permissions.value('agent.enabled', true)) {
      return [];
    }
    const selected = permissions.value('host.terminalName', '');
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
        ? 'Choose the exact Host shared read/write PowerShell terminal name in settings (host.terminalName).'
        : 'Ask the Host once to open and share a read/write PowerShell terminal, then wait. Do not run in a Guest terminal.';
      fail(code, message, { needsUser: true, candidates: matches.map(x => x.name) });
    }
    return matches[0];
  }

  return { candidates, selectTerminal };
}

module.exports = { createTerminalSelector, isWritablePty };
