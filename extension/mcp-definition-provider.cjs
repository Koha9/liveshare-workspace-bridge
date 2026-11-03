'use strict';
const path = require('node:path');

const PROVIDER_ID = 'liveshareWorkspaceBridge.mcp';
const SERVER_LABEL = 'Live Share Workspace Bridge';
const UNAVAILABLE_MESSAGE = 'MCP server definition API unavailable in this VS Code; use Copy MCP Server Configuration instead.';

function apiAvailable(vscode) {
  const register = vscode.lm?.registerMcpServerDefinitionProvider;
  if (typeof register !== 'function') return false;
  return typeof vscode.McpStdioServerDefinition === 'function';
}

function createChangeEmitter(vscode) {
  if (typeof vscode.EventEmitter !== 'function') return undefined;
  return new vscode.EventEmitter();
}

// The official guide's example passes one object literal to the constructor.
// vscode.d.ts declares positional parameters (label, command, args?, env?, version?)
// and a settable cwd property; the declaration file is authoritative here.
function createServerDefinition({ vscode, extensionDir, version }) {
  const serverScript = path.join(extensionDir, 'mcp-server.cjs');
  const definition = new vscode.McpStdioServerDefinition(SERVER_LABEL, 'node', [serverScript], {}, version);
  if (typeof vscode.Uri?.file === 'function') {
    definition.cwd = vscode.Uri.file(extensionDir);
  }
  return definition;
}

function combineDisposables(...disposables) {
  return {
    dispose() {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    },
  };
}

function registerMcpDefinitionProvider({ vscode, extensionDir, version, log }) {
  if (!apiAvailable(vscode)) {
    log(UNAVAILABLE_MESSAGE);
    return { dispose() {} };
  }
  const emitter = createChangeEmitter(vscode);
  const provider = {
    provideMcpServerDefinitions: () => [createServerDefinition({ vscode, extensionDir, version })],
    resolveMcpServerDefinition: server => server,
  };
  if (emitter) {
    provider.onDidChangeMcpServerDefinitions = emitter.event;
  }
  const registration = vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, provider);
  if (!emitter) return registration;
  return combineDisposables(registration, emitter);
}

module.exports = { registerMcpDefinitionProvider, PROVIDER_ID, SERVER_LABEL, UNAVAILABLE_MESSAGE };
