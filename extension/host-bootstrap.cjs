'use strict';
// Host bootstrap: renders the single-file Host helper, writes the one-time
// bootstrap file into the shared workspace, builds the shared-terminal launch
// command and reads the helper's listening or boot-failure frame. Workspace files are only
// touched through vscode.workspace.fs, never through Node fs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LEGACY_NAMESPACE = 'LswbHostV020';
const IMPORT_BEGIN = '#__LSWB_IMPORT_CORE_BEGIN__#';
const IMPORT_END = '#__LSWB_IMPORT_CORE_END__#';
const RUNTIME_PLACEHOLDER = '__RUNTIME_BASE64__';
const LISTENING_TAG = 'LSWB_LISTENING:';
const RAW_LIMIT = 12 * 1024 * 1024;
const RAW_KEEP = 8 * 1024 * 1024;
// PowerShell's newline escape: a backtick followed by n.
const PS_NEWLINE = String.fromCharCode(0x60) + 'n';

const SERVER_PARAMETERS = [
  { name: 'Token', key: 'token', type: 'string' },
  { name: 'Port', key: 'port', type: 'int', min: 1, max: 65535 },
  { name: 'PortAttempts', key: 'portAttempts', type: 'int', min: 1, max: 100, fallback: 5 },
  { name: 'IdleTimeoutMs', key: 'idleTimeoutMs', type: 'int', min: 1000, max: 86400000, fallback: 1800000 },
  { name: 'DefaultTimeout', key: 'defaultTimeout', type: 'int', min: 1000, max: 3600000, fallback: 120000 },
  { name: 'OutputLimit', key: 'outputLimit', type: 'int', min: 1024, max: 262144, fallback: 65536 },
  { name: 'TransferTtl', key: 'transferTtl', type: 'int', min: 10000, max: 900000, fallback: 120000 },
  { name: 'ChunkBytes', key: 'chunkBytes', type: 'int', min: 1024, max: 65536, fallback: 32768 },
];

function psString(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

function newNonce() {
  return crypto.randomUUID().replaceAll('-', '');
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readExtensionFile(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8');
}

// The C# runtime is renamed to a content-hashed namespace so a changed
// runtime never collides with a type already loaded in the Host session.
function runtimeParts() {
  const runtime = readExtensionFile('host-runtime.cs');
  const namespace = 'LswbHost' + sha256Hex(runtime).slice(0, 12);
  const rewritten = runtime.replaceAll(LEGACY_NAMESPACE, namespace);
  return { namespace, base64: Buffer.from(rewritten).toString('base64') };
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function replaceImportBody(server, body) {
  if (countOccurrences(server, IMPORT_BEGIN) !== 1 || countOccurrences(server, IMPORT_END) !== 1) {
    throw new Error('host-server.ps1 must contain each Import-HostCore marker exactly once.');
  }
  const begin = server.indexOf(IMPORT_BEGIN);
  const lineStart = server.lastIndexOf('\n', begin) + 1;
  const end = server.indexOf(IMPORT_END) + IMPORT_END.length;
  if (end <= begin) {
    throw new Error('host-server.ps1 Import-HostCore markers are out of order.');
  }
  return server.slice(0, lineStart) + body + server.slice(end);
}

function embeddedCoreBody() {
  const core = readExtensionFile('host-core.ps1');
  const loader = [
    "if (-not ('" + LEGACY_NAMESPACE + ".Job' -as [type])) {",
    "    $runtimeSource = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + RUNTIME_PLACEHOLDER + "'))",
    '    Add-Type -TypeDefinition $runtimeSource -Language CSharp',
    '}',
  ];
  return loader.join('\n') + '\n' + core;
}

function validateServerOptions(options) {
  const values = {};
  for (const parameter of SERVER_PARAMETERS) {
    const raw = options?.[parameter.key];
    const value = raw === undefined ? parameter.fallback : raw;
    if (parameter.type === 'string') {
      if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/u.test(value)) {
        throw new Error('The Host helper token must be 16..128 letters, digits, - or _.');
      }
    } else if (!Number.isInteger(value) || value < parameter.min || value > parameter.max) {
      throw new Error(`Host helper option ${parameter.key} is outside ${parameter.min}..${parameter.max}.`);
    }
    values[parameter.key] = value;
  }
  return values;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

// Each parameter declaration must match exactly once, so a drifting
// host-server.ps1 fails rendering instead of producing a half-configured script.
function setParameterDefault(text, parameter, value) {
  const pattern = '^([ \\t]*)(?:\\[Parameter\\(Mandatory = \\$true\\)\\])?\\[' + parameter.type + '\\]\\$'
    + escapeRegExp(parameter.name) + '(?: = [^,\\r\\n]+)?(,?)[ \\t]*$';
  const matches = text.match(new RegExp(pattern, 'gmu')) || [];
  if (matches.length !== 1) {
    throw new Error(`host-server.ps1 parameter ${parameter.name} must be declared exactly once.`);
  }
  const literal = parameter.type === 'string' ? psString(value) : String(value);
  const replacement = (match, indent, comma) => `${indent}[${parameter.type}]$${parameter.name} = ${literal}${comma}`;
  return text.replace(new RegExp(pattern, 'mu'), replacement);
}

function renderServerBootstrap(options) {
  const values = validateServerOptions(options);
  const { namespace, base64 } = runtimeParts();
  let text = replaceImportBody(readExtensionFile('host-server.ps1'), embeddedCoreBody());
  for (const parameter of SERVER_PARAMETERS) {
    text = setParameterDefault(text, parameter, values[parameter.key]);
  }
  text = text.replaceAll(LEGACY_NAMESPACE, namespace);
  return text.replace(RUNTIME_PLACEHOLDER, () => base64);
}

function prepareBootstrapFile(vscode, root, script) {
  const filename = '.lswb-bootstrap-' + crypto.randomUUID() + '.txt';
  const uri = vscode.Uri.joinPath(root, filename);
  return { filename, uri, sha256: sha256Hex(script) };
}

async function writeBootstrapFile(vscode, file, script) {
  await vscode.workspace.fs.writeFile(file.uri, Buffer.from(script, 'utf8'));
}

// Owned handshake cleanup is not an agent delete request. It never traverses directories.
async function deleteBootstrapFile(vscode, file) {
  try {
    await vscode.workspace.fs.delete(file.uri, { recursive: false, useTrash: false });
    return true;
  } catch {
    return false;
  }
}

function rootExpressionFor(hostWorkspacePath) {
  return hostWorkspacePath ? psString(hostWorkspacePath) : '(Get-Location).ProviderPath';
}

// Reads the bootstrap from the workspace and checks its SHA-256, which also
// proves the Host root is the directory that the Guest root maps to.
function verifiedBootstrapRead(rootExpression, filename, sha256) {
  return `$ErrorActionPreference='Stop';$root=${rootExpression};$filename=Join-Path $root ${psString(filename)};`
    + `$bytes=[IO.File]::ReadAllBytes($filename);$sha=[Security.Cryptography.SHA256]::Create();`
    + `try{$digest=[BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()};`
    + `if($digest -ne ${psString(sha256)}){throw 'Host and Guest workspace binding mismatch.'};`;
}

// Tags are split into quoted pieces so the echoed command never contains a
// contiguous frame tag that the output reader could mistake for a reply.
function errorFrameStatement(tag, nonce, response) {
  return `$response=${response};`
    + '$encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($response|ConvertTo-Json -Compress)));'
    + `[Console]::WriteLine("${PS_NEWLINE}"+'${tag}:'+${psString(nonce)}+':'+$encoded);[Console]::WriteLine('LSWB_END:'+${psString(nonce)})`;
}

// The token lives only in the rendered bootstrap file, never on this line,
// because the shared terminal scrollback is visible on the Host.
function buildServerLaunchCommand(options) {
  const { rootExpression, filename, sha256, nonce } = options;
  const errorFrame = errorFrameStatement('LSWB_BOOT_FAILED', nonce, '@{message=$_.Exception.Message}');
  const run = '& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($bytes))) -WorkspaceRoot $root';
  return `& {try{${verifiedBootstrapRead(rootExpression, filename, sha256)}${run}}catch{${errorFrame}}}`;
}

// Terminal output is wrapped and decorated by the pty; frames are matched
// after removing escape sequences and all whitespace.
function compactTerminalText(raw) {
  const text = raw
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  return text.replace(/\s/gu, '');
}

function findTaggedPayload(compact, startTag, endTag) {
  const start = compact.indexOf(startTag);
  if (start < 0) {
    return null;
  }
  const end = compact.indexOf(endTag, start + startTag.length);
  if (end < 0) {
    return null;
  }
  return compact.slice(start + startTag.length, end);
}

function decodeFramePayload(encoded) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded) || encoded.length % 4) {
    throw new Error('Invalid Host frame encoding.');
  }
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
}

function parseBootFailure(compact, nonce) {
  const encoded = findTaggedPayload(compact, `LSWB_BOOT_FAILED:${nonce}:`, `LSWB_END:${nonce}`);
  if (encoded === null) {
    return null;
  }
  let message = 'The Host helper failed to start.';
  try {
    const decoded = decodeFramePayload(encoded);
    if (typeof decoded?.message === 'string') {
      message = decoded.message;
    }
  } catch {
    message = 'The Host helper failed to start; its error frame was unreadable.';
  }
  const prefixed = /^([a-z][a-z0-9_]*): ([\s\S]*)$/u.exec(message);
  if (prefixed) {
    return { code: prefixed[1], message: prefixed[2] };
  }
  return { code: 'host_boot_failed', message };
}

function decodeListening(json) {
  try {
    const banner = JSON.parse(json);
    if (!Number.isInteger(banner?.port) || banner.port < 1 || banner.port > 65535) {
      return null;
    }
    return { port: banner.port, protocol: banner.protocol, token: banner.token };
  } catch {
    return null;
  }
}

// Only a banner carrying this binding's token prefix counts, so output of an
// older helper in the same terminal is ignored.
function parseListeningFrame(compact, tokenPrefix) {
  const pattern = /LSWB_LISTENING:(\{[^{}]*\})/gu;
  for (const match of compact.matchAll(pattern)) {
    const banner = decodeListening(match[1]);
    if (banner && banner.token === tokenPrefix) {
      return banner;
    }
  }
  return null;
}

function listeningTimeoutError(progress) {
  const message = 'No Host helper banner arrived from the shared terminal in time. A helper may still start there; '
    + 'inspect the Host terminal and rebind with acknowledgeRecovery:true once it is idle. No command was replayed.';
  return Object.assign(new Error(message), {
    code: 'host_terminal_required',
    details: { receivedCharacters: progress.receivedCharacters, bannerSeen: progress.raw.includes(LISTENING_TAG) },
  });
}

function bootFailureError(failure) {
  return Object.assign(new Error(failure.message), { code: failure.code, details: { bootFailed: true } });
}

// Sends the launch command and waits for one LSWB_LISTENING banner (or a
// boot-failure frame). The terminal state is unknown after a timeout or a
// revocation, so those mark the channel uncertain; a reported boot failure or
// a closed terminal does not.
function awaitListening(options) {
  const { terminal, permissions, state, op, nonce, tokenPrefix, command, timeoutMs } = options;
  permissions.assert(op);
  return new Promise((resolve, reject) => {
    const pty = terminal.creationOptions.pty;
    const progress = { raw: '', receivedCharacters: 0 };
    let done = false;
    let sent = false;
    let scheduled = null;
    let listener;
    const finish = (error, result, markUncertain) => {
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
      if (sent && markUncertain) {
        state.uncertain = true;
      }
      reject(error);
    };
    const timer = setTimeout(() => finish(listeningTimeoutError(progress), null, true), timeoutMs);
    function inspect() {
      scheduled = null;
      if (done) {
        return;
      }
      const compact = compactTerminalText(progress.raw);
      const failure = parseBootFailure(compact, nonce);
      if (failure) {
        finish(bootFailureError(failure), null, false);
        return;
      }
      const banner = parseListeningFrame(compact, tokenPrefix);
      if (banner) {
        finish(null, banner, false);
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
    const revoke = (reason, markUncertain = true) => {
      const code = ['workspace_changed', 'host_channel_closed'].includes(reason.code) ? reason.code : 'host_access_revoked';
      const error = Object.assign(new Error(reason.message), { code, details: reason });
      finish(error, null, markUncertain);
    };
    state.pending = { nonce, op, terminal, kind: 'banner', reject: revoke };
    try {
      sent = true;
      terminal.sendText(command, true);
    } catch (error) {
      finish(error, null, true);
    }
  });
}

module.exports = {
  psString,
  newNonce,
  renderServerBootstrap,
  prepareBootstrapFile,
  writeBootstrapFile,
  deleteBootstrapFile,
  rootExpressionFor,
  buildServerLaunchCommand,
  compactTerminalText,
  parseBootFailure,
  parseListeningFrame,
  awaitListening,
  IMPORT_BEGIN,
  IMPORT_END,
};
