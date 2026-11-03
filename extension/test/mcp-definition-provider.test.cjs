'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  registerMcpDefinitionProvider,
  PROVIDER_ID,
  SERVER_LABEL,
  UNAVAILABLE_MESSAGE,
} = require('../mcp-definition-provider.cjs');
const manifest = require('../package.json');

const EXTENSION_DIR = path.join(path.sep, 'fake', 'extension');
const VERSION = '9.8.7';

class FakeStdioDefinition {
  constructor(label, command, args, env, version) {
    this.constructorArgs = [label, command, args, env, version];
    this.label = label;
    this.command = command;
    this.args = args;
    this.env = env;
    this.version = version;
  }
}

class FakeEmitter {
  constructor() {
    this.disposed = false;
    this.event = () => ({ dispose() {} });
  }

  dispose() {
    this.disposed = true;
  }
}

function createFakeVscode({ withEmitter }) {
  const calls = [];
  const registration = { disposed: false, dispose() { this.disposed = true; } };
  const vscode = {
    McpStdioServerDefinition: FakeStdioDefinition,
    Uri: { file: fsPath => ({ scheme: 'file', fsPath }) },
    lm: {
      registerMcpServerDefinitionProvider(id, provider) {
        calls.push({ id, provider });
        return registration;
      },
    },
  };
  if (withEmitter) {
    vscode.EventEmitter = FakeEmitter;
  }
  return { vscode, calls, registration };
}

function register(vscode, logs) {
  return registerMcpDefinitionProvider({
    vscode,
    extensionDir: EXTENSION_DIR,
    version: VERSION,
    log: message => logs.push(message),
  });
}

test('falls back with a log line when vscode.lm is missing', () => {
  const logs = [];
  const disposable = register({}, logs);
  assert.equal(typeof disposable.dispose, 'function');
  disposable.dispose();
  assert.deepEqual(logs, [UNAVAILABLE_MESSAGE]);
});

test('falls back when McpStdioServerDefinition is missing', () => {
  const logs = [];
  let registered = false;
  const vscode = { lm: { registerMcpServerDefinitionProvider() { registered = true; } } };
  const disposable = register(vscode, logs);
  disposable.dispose();
  assert.equal(registered, false);
  assert.deepEqual(logs, [UNAVAILABLE_MESSAGE]);
});

test('registers one stdio definition and returns the registration disposable', async () => {
  const logs = [];
  const { vscode, calls, registration } = createFakeVscode({ withEmitter: false });
  const disposable = register(vscode, logs);
  assert.equal(disposable, registration);
  assert.deepEqual(logs, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'liveshareWorkspaceBridge.mcp');
  assert.equal(calls[0].id, PROVIDER_ID);

  const provider = calls[0].provider;
  assert.equal(provider.onDidChangeMcpServerDefinitions, undefined);
  const definitions = await provider.provideMcpServerDefinitions();
  assert.equal(definitions.length, 1);
  const definition = definitions[0];
  assert.ok(definition instanceof FakeStdioDefinition);
  const serverScript = path.join(EXTENSION_DIR, 'mcp-server.cjs');
  assert.deepEqual(definition.constructorArgs, [SERVER_LABEL, 'node', [serverScript], {}, VERSION]);
  assert.equal(definition.label, 'Live Share Workspace Bridge');
  assert.deepEqual(definition.cwd, { scheme: 'file', fsPath: EXTENSION_DIR });
  assert.equal(await provider.resolveMcpServerDefinition(definition), definition);
});

test('exposes the emitter event and disposes registration and emitter together', () => {
  const { vscode, calls, registration } = createFakeVscode({ withEmitter: true });
  const disposable = register(vscode, []);
  const provider = calls[0].provider;
  assert.equal(typeof provider.onDidChangeMcpServerDefinitions, 'function');
  disposable.dispose();
  assert.equal(registration.disposed, true);
});

test('emitter wrapper disposes the emitter instance', () => {
  const { vscode, calls } = createFakeVscode({ withEmitter: true });
  const created = [];
  vscode.EventEmitter = class extends FakeEmitter {
    constructor() {
      super();
      created.push(this);
    }
  };
  const disposable = register(vscode, []);
  assert.equal(created.length, 1);
  assert.equal(calls[0].provider.onDidChangeMcpServerDefinitions, created[0].event);
  disposable.dispose();
  assert.equal(created[0].disposed, true);
});

test('manifest declares the same provider id', () => {
  const providers = manifest.contributes.mcpServerDefinitionProviders;
  assert.deepEqual(providers, [{ id: PROVIDER_ID, label: SERVER_LABEL }]);
});
