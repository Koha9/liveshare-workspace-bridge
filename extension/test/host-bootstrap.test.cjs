'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const bootstrap = require('../host-bootstrap.cjs');

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

function renderSample(overrides = {}) {
  return bootstrap.renderServerBootstrap({ token: TOKEN, port: 23456, idleTimeoutMs: 600000, ...overrides });
}

test('renderServerBootstrap produces one self-contained script with injected defaults', () => {
  const script = renderSample();
  assert.ok(!script.includes(bootstrap.IMPORT_BEGIN));
  assert.ok(!script.includes(bootstrap.IMPORT_END));
  assert.ok(!script.includes('LswbHostV020'));
  assert.ok(!script.includes('__RUNTIME_BASE64__'));
  assert.ok(!script.includes('#__LSWB_HOST_CORE__#'));
  assert.ok(!/Join-Path \$PSScriptRoot/u.test(script));
  assert.ok(script.includes(`[string]$Token = '${TOKEN}'`));
  assert.ok(script.includes('[int]$Port = 23456,'));
  assert.ok(script.includes('[int]$IdleTimeoutMs = 600000,'));
  assert.ok(script.includes('[int]$PortAttempts = 5,'));
  assert.ok(!script.includes('Mandatory'));
  assert.ok(script.includes('function Process-Request'));
  assert.match(script, /LswbHost[0-9a-f]{12}\.Job/u);
});

test('renderServerBootstrap rejects unsafe tokens and out-of-range options', () => {
  assert.throws(() => renderSample({ token: "short" }), /token/u);
  assert.throws(() => renderSample({ token: TOKEN + "'" }), /token/u);
  assert.throws(() => renderSample({ port: 0 }), /port/u);
  assert.throws(() => renderSample({ idleTimeoutMs: 10 }), /idleTimeoutMs/u);
  assert.throws(() => renderSample({ chunkBytes: 1.5 }), /chunkBytes/u);
});

test('the shared-terminal launch command never carries the token', () => {
  const script = renderSample();
  const command = bootstrap.buildServerLaunchCommand({
    rootExpression: bootstrap.rootExpressionFor(''),
    filename: '.lswb-bootstrap-x.txt',
    sha256: 'f'.repeat(64),
    nonce: 'n'.repeat(32),
  });
  assert.ok(script.includes(TOKEN));
  assert.ok(!command.includes(TOKEN));
  assert.ok(!command.includes(TOKEN.slice(0, 8)));
  assert.ok(command.includes('(Get-Location).ProviderPath'));
  assert.ok(command.includes("'.lswb-bootstrap-x.txt'"));
  assert.ok(command.includes("'" + 'f'.repeat(64) + "'"));
  // The echoed command must not look like a frame to the output reader.
  const compact = bootstrap.compactTerminalText(command);
  assert.equal(bootstrap.parseBootFailure(compact, 'n'.repeat(32)), null);
  assert.equal(bootstrap.parseListeningFrame(compact, TOKEN.slice(0, 8)), null);
});

test('listening banners are read across wraps and escapes and must carry the token prefix', () => {
  const prefix = TOKEN.slice(0, 8);
  const stale = 'LSWB_LISTENING:{"port":4000,"protocol":3,"token":"00000000"}\r\n';
  const wrapped = '\x1b]0;title\x07LSWB_LISTEN\r\nING:{"port":23457,"proto\x1b[0mcol":3,"token":"' + prefix + '"}\r\n';
  const compact = bootstrap.compactTerminalText(stale + wrapped);
  assert.deepEqual(bootstrap.parseListeningFrame(compact, prefix), { port: 23457, protocol: 3, token: prefix });
  assert.equal(bootstrap.parseListeningFrame(bootstrap.compactTerminalText(stale), prefix), null);
  const invalid = bootstrap.compactTerminalText('LSWB_LISTENING:{"port":70000,"protocol":3,"token":"' + prefix + '"}');
  assert.equal(bootstrap.parseListeningFrame(invalid, prefix), null);
});

test('boot failure frames keep the Host error code and fall back to host_boot_failed', () => {
  const nonce = 'b'.repeat(32);
  const frame = message => {
    const encoded = Buffer.from(JSON.stringify({ message })).toString('base64');
    return bootstrap.compactTerminalText(`\r\nLSWB_BOOT_FAILED:${nonce}:${encoded}\r\nLSWB_END:${nonce}\r\n`);
  };
  assert.deepEqual(bootstrap.parseBootFailure(frame('host_port_unavailable: No free port.'), nonce), {
    code: 'host_port_unavailable',
    message: 'No free port.',
  });
  assert.deepEqual(bootstrap.parseBootFailure(frame('Access denied'), nonce), {
    code: 'host_boot_failed',
    message: 'Access denied',
  });
  assert.equal(bootstrap.parseBootFailure(frame('x'), 'c'.repeat(32)), null);
});

test('result frames decode as before and reject invalid encodings', () => {
  const nonce = 'd'.repeat(32);
  const encoded = Buffer.from(JSON.stringify({ ok: true, result: { protocol: 2 } })).toString('base64');
  const compact = bootstrap.compactTerminalText(`LSWB_RESULT:${nonce}:${encoded}\r\nLSWB_END:${nonce}`);
  assert.deepEqual(bootstrap.parseResultFrame(compact, nonce), { ok: true, result: { protocol: 2 } });
  assert.equal(bootstrap.parseResultFrame(`LSWB_RESULT:${nonce}:abcd`, nonce), null);
  assert.throws(() => bootstrap.parseResultFrame(`LSWB_RESULT:${nonce}:abc*LSWB_END:${nonce}`, nonce), /encoding/u);
});
