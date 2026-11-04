'use strict';
const { removeTempDirectory } = require('./temp-cleanup.cjs');

// Interoperability check against the official MCP TypeScript SDK client.
// The SDK is a devDependency only; without node_modules this file skips.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SERVER_PATH = path.join(__dirname, '..', 'mcp-server.cjs');
const { version: PACKAGE_VERSION } = require('../package.json');

function sdkUnavailableReason() {
  try {
    require.resolve('@modelcontextprotocol/sdk/package.json');
    return null;
  } catch (error) {
    return `@modelcontextprotocol/sdk is not installed (${error.code}); run npm ci --prefix extension to enable this test`;
  }
}

const skipReason = sdkUnavailableReason();

if (skipReason) {
  console.log(`# mcp-sdk-interop skipped: ${skipReason}`);
  test.skip(`official SDK client interoperates with mcp-server.cjs (${skipReason})`);
} else {
  test('official SDK client interoperates with mcp-server.cjs', async t => {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lswb-mcp-sdk-'));
    t.after(() => removeTempDirectory(base, { prefix: 'lswb-mcp-sdk-' }));

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_PATH],
      env: { ...process.env, LSWB_REGISTRY_DIR: path.join(base, 'instances') },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'lswb-interop-test', version: '0.0.0' });
    await client.connect(transport);
    t.after(() => client.close());

    assert.deepEqual(client.getServerVersion(), { name: 'liveshare-workspace-bridge', version: PACKAGE_VERSION });

    const { tools } = await client.listTools();
    assert.ok(tools.some(tool => tool.name === 'lswb_list_workspaces'));

    const result = await client.callTool({ name: 'lswb_list_workspaces', arguments: {} });
    assert.notEqual(result.isError, true);
    assert.equal(result.content[0].type, 'text');
    assert.equal(result.structuredContent.status, 'no_records');
    assert.deepEqual(result.structuredContent.workspaces, []);
  });
}
