#!/usr/bin/env node
'use strict';

// Zero-dependency MCP stdio server for Live Share Workspace Bridge.
// Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout.
// stdout carries protocol messages only; every diagnostic goes to stderr.

const { TOOLS, registryDir } = require('./mcp-tools.cjs');
const { version: SERVER_VERSION } = require('./package.json');

const SERVER_NAME = 'liveshare-workspace-bridge';
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];
const MAX_LINE_BYTES = 4 * 1024 * 1024;
const NEWLINE = 0x0a;

const RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
};

// ---------------------------------------------------------------------------
// Tool table (see mcp-tools.cjs)
// ---------------------------------------------------------------------------

function publicTool(tool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}

// ---------------------------------------------------------------------------
// Protocol layer
// ---------------------------------------------------------------------------

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.rpcCode = code;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function logError(message) {
  process.stderr.write(`[lswb-mcp] ${message}\n`);
}

function writeMessage(message) {
  // JSON.stringify escapes newlines inside strings, so one message is one line.
  process.stdout.write(JSON.stringify(message) + '\n');
}

function requireParams(params) {
  if (!isPlainObject(params)) {
    throw new RpcError(RPC_ERRORS.invalidParams, 'params must be an object.');
  }
  return params;
}

function handleInitialize(params) {
  const { protocolVersion } = requireParams(params);
  if (typeof protocolVersion !== 'string') {
    throw new RpcError(RPC_ERRORS.invalidParams, 'protocolVersion must be a string.');
  }
  const negotiated = SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)
    ? protocolVersion
    : DEFAULT_PROTOCOL_VERSION;
  return {
    protocolVersion: negotiated,
    capabilities: { tools: {} },
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
  };
}

function handlePing() {
  return {};
}

function handleToolsList() {
  return { tools: TOOLS.map(publicTool) };
}

async function handleToolsCall(params) {
  const { name, arguments: args = {} } = requireParams(params);
  if (typeof name !== 'string') {
    throw new RpcError(RPC_ERRORS.invalidParams, 'name must be a string.');
  }
  if (!isPlainObject(args)) {
    throw new RpcError(RPC_ERRORS.invalidParams, 'arguments must be an object.');
  }
  const tool = TOOLS.find(candidate => candidate.name === name);
  if (!tool) {
    throw new RpcError(RPC_ERRORS.invalidParams, `Unknown tool: ${name}`);
  }
  const problem = tool.validate ? tool.validate(args) : null;
  if (problem) {
    throw new RpcError(RPC_ERRORS.invalidParams, problem);
  }
  return tool.handler(args);
}

// No initialize gating in the skeleton: every method answers at any time.
const METHODS = {
  initialize: handleInitialize,
  ping: handlePing,
  'tools/list': handleToolsList,
  'tools/call': handleToolsCall,
};

function validId(id) {
  return typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
}

// Returns the response object, or null when nothing must be sent.
async function dispatch(message) {
  if (!isPlainObject(message)) {
    return rpcError(null, RPC_ERRORS.invalidRequest, 'Expected a single JSON-RPC request object.');
  }
  const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
  const id = hasId && validId(message.id) ? message.id : null;
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || (hasId && id === null)) {
    return rpcError(id, RPC_ERRORS.invalidRequest, 'Invalid JSON-RPC 2.0 request.');
  }
  if (!hasId) {
    // Notifications (including notifications/initialized) never get a reply.
    return null;
  }
  const handler = Object.prototype.hasOwnProperty.call(METHODS, message.method)
    ? METHODS[message.method]
    : null;
  if (!handler) {
    return rpcError(id, RPC_ERRORS.methodNotFound, `Method not found: ${message.method}`);
  }
  return invokeHandler(id, handler, message.params);
}

async function invokeHandler(id, handler, params) {
  try {
    return rpcResult(id, await handler(params));
  } catch (error) {
    if (error instanceof RpcError) {
      return rpcError(id, error.rpcCode, error.message);
    }
    logError(`internal error: ${error && error.stack ? error.stack : error}`);
    return rpcError(id, RPC_ERRORS.internal, 'Internal error.');
  }
}

async function handleLine(text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return rpcError(null, RPC_ERRORS.parse, 'Parse error.');
  }
  return dispatch(message);
}

// Splits a byte stream into lines, enforcing maxBytes per line before the
// whole line is buffered. onOversize fires once per oversized line.
function createLineReader(onLine, onOversize, maxBytes = MAX_LINE_BYTES) {
  let chunks = [];
  let pendingBytes = 0;
  let discarding = false;

  function flushLine() {
    const line = Buffer.concat(chunks, pendingBytes).toString('utf8').trim();
    chunks = [];
    pendingBytes = 0;
    if (line) {
      onLine(line);
    }
  }

  function append(piece) {
    if (discarding) {
      return;
    }
    if (pendingBytes + piece.length > maxBytes) {
      chunks = [];
      pendingBytes = 0;
      discarding = true;
      onOversize();
      return;
    }
    chunks.push(piece);
    pendingBytes += piece.length;
  }

  function push(data) {
    let start = 0;
    let end = data.indexOf(NEWLINE, start);
    while (end !== -1) {
      append(data.subarray(start, end));
      if (discarding) {
        discarding = false;
      } else {
        flushLine();
      }
      start = end + 1;
      end = data.indexOf(NEWLINE, start);
    }
    append(data.subarray(start));
  }

  function finish() {
    if (!discarding && pendingBytes > 0) {
      flushLine();
    }
  }

  return { push, finish };
}

function main() {
  let chain = Promise.resolve();

  function enqueue(task) {
    chain = chain
      .then(task)
      .then(response => {
        if (response) {
          writeMessage(response);
        }
      })
      .catch(error => logError(`request failed: ${error && error.stack ? error.stack : error}`));
  }

  const reader = createLineReader(
    line => enqueue(() => handleLine(line)),
    () => enqueue(() => rpcError(null, RPC_ERRORS.invalidRequest, `Message exceeds ${MAX_LINE_BYTES} bytes.`)),
  );

  process.stdout.on('error', error => {
    logError(`stdout closed: ${error.code || error.message}`);
  });
  process.stdin.on('data', data => reader.push(data));
  process.stdin.on('end', () => {
    reader.finish();
    enqueue(() => {
      process.exitCode = 0;
      return null;
    });
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  TOOLS,
  registryDir,
  SUPPORTED_PROTOCOL_VERSIONS,
  MAX_LINE_BYTES,
  createLineReader,
  dispatch,
};
