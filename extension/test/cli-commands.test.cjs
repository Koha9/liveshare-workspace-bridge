'use strict';
// The CLI is a human diagnostic tool; agents use the MCP server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const cli = require('../cli.cjs');

const CLI_PATH = path.join(__dirname, '..', 'cli.cjs');

function runCli(args) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    input: '',
    windowsHide: true,
    timeout: 10000,
  });
  return result;
}

test('CLI help lists only diagnostic commands and points agents to MCP', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /instances/u);
  assert.match(result.stdout, /diagnose/u);
  assert.match(result.stdout, /--request FILE/u);
  assert.match(result.stdout, /Agents should use the MCP server; see docs\/MCP\.md/u);
  assert.doesNotMatch(result.stdout, /upload|download|apply-patch/u);
});

for (const removed of ['upload', 'download', 'apply-patch']) {
  test(`CLI rejects the removed ${removed} subcommand without contacting a bridge`, () => {
    const result = runCli([removed, '--input', 'x', '--path', 'y']);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const reply = JSON.parse(result.stdout);
    assert.equal(reply.ok, false);
    assert.match(reply.error.message, new RegExp(`Unknown or incomplete option: ${removed}`, 'u'));
  });
}

test('CLI keeps the transport exports used by the MCP server', () => {
  for (const name of ['discover', 'request', 'uploadTransfer', 'projectStartupRecord']) {
    assert.equal(typeof cli[name], 'function', name);
  }
  assert.equal(cli.transferClient, undefined);
});
