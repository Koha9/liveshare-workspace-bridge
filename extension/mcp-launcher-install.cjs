'use strict';

// Installs the stable MCP launcher next to the discovery registry and renders
// agent configuration snippets that point at it. Never edits agent configs.

const fs = require('node:fs');
const path = require('node:path');

function launcherPath(registryDir) {
  return path.join(path.dirname(registryDir), 'mcp-server.cjs');
}

function sameContent(file, content) {
  try {
    return fs.readFileSync(file).equals(content);
  } catch {
    return false;
  }
}

function removeQuietly(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // Best effort cleanup only.
  }
}

function installLauncher({ registryDir, sourcePath, log }) {
  const target = launcherPath(registryDir);
  // A pid-scoped temporary name keeps concurrent VS Code windows apart.
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    const content = fs.readFileSync(sourcePath);
    if (sameContent(target, content)) {
      return { installed: false, path: target };
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, target);
    return { installed: true, path: target };
  } catch (error) {
    removeQuietly(temporary);
    log?.(`MCP launcher install failed: ${error.message}`);
    return { installed: false, path: target, error };
  }
}

// Node accepts forward slashes on Windows; they avoid doubled backslashes in
// the rendered JSON/TOML strings and in PowerShell.
function toForwardSlashes(file) {
  return file.replace(/\\/g, '/');
}

function renderMcpConfig(launcherFile) {
  const launcher = toForwardSlashes(launcherFile);
  const quoted = JSON.stringify(launcher);
  const vscodeConfig = {
    servers: { lswb: { type: 'stdio', command: 'node', args: [launcher] } },
  };
  return [
    'The launcher forwards to the currently running extension version; ' +
      'these configurations do not need changes after upgrading the extension.',
    '',
    '# Claude Code',
    `claude mcp add lswb -- node ${quoted}`,
    '',
    '# Codex (~/.codex/config.toml)',
    '[mcp_servers.lswb]',
    'command = "node"',
    `args = [${quoted}]`,
    '',
    '# VS Code (.vscode/mcp.json or user mcp.json)',
    JSON.stringify(vscodeConfig),
    '',
  ].join('\n');
}

module.exports = { installLauncher, launcherPath, renderMcpConfig };
