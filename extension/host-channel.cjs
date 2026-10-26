'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fail } = require('./core.cjs');
const psString = value => "'" + String(value).replaceAll("'", "''") + "'";
function renderBootstrap() {
  const runtime = fs.readFileSync(path.join(__dirname, 'host-runtime.cs'), 'utf8');
  const namespace = 'LswbHost' + crypto.createHash('sha256').update(runtime).digest('hex').slice(0, 12);
  const rewritten = runtime.replaceAll('LswbHostV020', namespace);
  return fs.readFileSync(path.join(__dirname, 'host-actions.ps1'), 'utf8').replaceAll('LswbHostV020', namespace).replace('__RUNTIME_BASE64__', Buffer.from(rewritten).toString('base64'));
}
function createHostChannel(vscode, identity, permissions) {
  let binding = null, queue = Promise.resolve(), pending = null, uncertain = false, disposed = false;
  const jobs = new Map(), transfers = new Map();
  const bindingKey = root => `${identity.epoch()}\n${root.toString()}`;
  function candidates() {
    if (!permissions.value('terminal.enabled', false) || !permissions.value('agent.enabled', true)) return [];
    const selected = permissions.value('terminal.name', '');
    return vscode.window.terminals.filter(terminal => {
      const pty = terminal.creationOptions?.pty;
      if (!pty || typeof pty.onDidWrite !== 'function' || typeof pty.handleInput !== 'function') return false;
      if (pty.isReadonly === true || pty.isReadOnly === true || pty.readOnly === true) return false;
      if (selected) return terminal.name === selected;
      return /\[(?:shared|共享|共用|共有)[^\]]*\]$/iu.test(terminal.name) && !/read.?only|只读|唯讀|読み取り専用/iu.test(terminal.name);
    });
  }
  function selectTerminal() {
    const matches = candidates();
    if (matches.length !== 1) fail(matches.length ? 'host_terminal_selection_required' : 'host_terminal_required', matches.length ? 'Choose the exact Host shared read/write PowerShell terminal name in settings.' : 'Ask the Host once to open and share a read/write PowerShell terminal, then wait. Do not run in a Guest terminal.', { needsUser: true, candidates: matches.map(x => x.name) });
    return matches[0];
  }
  function status(root) {
    const denial = permissions.reason('hostBind');
    if (denial) return { available: false, bound: false, reason: denial.code, message: denial.message, candidates: [] };
    const eligible = candidates();
    return { available: eligible.length === 1, bound: !!binding && binding.key === bindingKey(root) && vscode.window.terminals.includes(binding.terminal), uncertain, candidates: eligible.map(x => x.name), reason: eligible.length === 1 ? null : eligible.length ? 'host_terminal_selection_required' : 'host_terminal_required' };
  }
  function capture(terminal, op, nonce, command, timeoutMs, payload) {
    permissions.assert(op);
    return new Promise((resolve, reject) => {
      let raw = '', done = false, sent = false, payloadSent = false, scheduled = null, receivedCharacters=0, payloadCharactersSent=0;
      const pty = terminal.creationOptions.pty;
      let listener;
      const finish = (error, result) => {
        if (done) return; done = true; clearTimeout(timer); if (scheduled) clearTimeout(scheduled); listener?.dispose();
        if (pending?.nonce === nonce) pending = null;
        if (error) { error.details = { ...error.details, requestSent: sent }; if (sent) uncertain = true; reject(error); } else resolve(result);
      };
      const timer = setTimeout(() => finish(Object.assign(new Error(op === 'hostBind' ? 'No verified response from the Host RW PowerShell. Ask the Host once to open/share it in the project root, then wait.' : 'Host response timed out. Inspect the Host before retrying a mutation.'), { code: op === 'hostBind' ? 'host_terminal_required' : 'host_outcome_unknown', details:{receivedCharacters,payloadCharactersSent,frameStartSeen:raw.includes('LSWB_RESULT:'),frameEndSeen:raw.includes('LSWB_END:')} })), timeoutMs);
      function inspect() {
        scheduled = null;
        if (done) return;
        const text = raw.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
        const compact=text.replace(/\s/gu,'');
        if (payload && !payloadSent && compact.includes(`LSWB_READY:${nonce}`)) {
          payloadSent = true;
          (async () => { for (let offset=0;offset<payload.length;offset+=4096) { if(done)return;permissions.assert(op);const piece=payload.slice(offset,offset+4096);terminal.sendText(piece,offset+4096>=payload.length);payloadCharactersSent+=piece.length;await new Promise(resolve=>setTimeout(resolve,2)); } })().catch(error=>finish(error));
        }
        const startTag=`LSWB_RESULT:${nonce}:`,endTag=`LSWB_END:${nonce}`;
        const start=compact.indexOf(startTag),end=compact.indexOf(endTag,start+startTag.length);
        if (start>=0&&end>start) {
          try {
            const encoded=compact.slice(start+startTag.length,end);
            if(!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)||encoded.length%4)throw new Error('Invalid Host frame encoding.');
            const reply = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
            if (!reply || typeof reply.ok !== 'boolean') throw new Error('Invalid Host response.');
            finish(null, reply);
          } catch (error) { error.code = 'invalid_host_response'; finish(error); }
        }
      }
      listener = pty.onDidWrite(data => { raw += data;receivedCharacters+=data.length; if (raw.length > 12 * 1024 * 1024) raw = raw.slice(-8 * 1024 * 1024); if (!scheduled) scheduled = setTimeout(inspect, 5); });
      pending = { nonce, op, terminal, reject: reason => finish(Object.assign(new Error(reason.message), { code: 'host_access_revoked', details: reason })) };
      try { sent = true; terminal.sendText(command, true); } catch (error) { finish(error); }
    });
  }
  async function bind(root, options = {}) {
    permissions.assert('hostBind');
    const expectedEpoch = identity.epoch();
    if (uncertain && options.acknowledgeRecovery !== true) fail('host_channel_uncertain', 'Inspect the shared Host terminal and explicitly rebind with acknowledgeRecovery:true once idle. No command was replayed.');
    const terminal = selectTerminal(), nonce = crypto.randomUUID().replaceAll('-', '');
    const functionName = 'Invoke_Lswb_' + crypto.randomUUID().replaceAll('-', '');
    const filename = '.lswb-bootstrap-' + crypto.randomUUID() + '.txt';
    const uri = vscode.Uri.joinPath(root, filename), script = renderBootstrap();
    const sha256 = crypto.createHash('sha256').update(script).digest('hex');
    const timeout = permissions.value('terminal.commandTimeoutMs', 120000), output = permissions.value('terminal.maxOutputCharacters', 65536), ttl = permissions.value('transfer.idleTimeoutMs', 120000), chunkBytes = permissions.value('transfer.chunkBytes', 32768);
    for (const [value, min, max] of [[timeout,1000,3600000],[output,1024,262144],[ttl,10000,900000],[chunkBytes,1024,65536]]) if (!Number.isInteger(value) || value < min || value > max) fail('invalid_configuration', 'Host timeout, output or transfer limit is outside its supported range.');
    const chosenRoot = options.hostWorkspacePath || permissions.value('terminal.hostWorkspacePath', '');
    const payload = Buffer.from(JSON.stringify({ action: 'hello', requestNonce: nonce })).toString('base64');
    const rootExpression = chosenRoot ? psString(chosenRoot) : '(Get-Location).ProviderPath';
    const errorFrame = `$response=@{ok=$false;error=@{code='host_binding_failed';message=$_.Exception.Message}};$encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($response|ConvertTo-Json -Compress)));[Console]::WriteLine("\u0060n"+'LSWB_RESULT:'+${psString(nonce)}+':'+$encoded);[Console]::WriteLine('LSWB_END:'+${psString(nonce)})`;
    const command = `& {try{$ErrorActionPreference='Stop';$root=${rootExpression};$filename=Join-Path $root ${psString(filename)};$bytes=[IO.File]::ReadAllBytes($filename);$sha=[Security.Cryptography.SHA256]::Create();try{$digest=[BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()};if($digest -ne ${psString(sha256)}){throw 'Host and Guest workspace binding mismatch.'};& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($bytes))) -FunctionName ${psString(functionName)} -WorkspaceRoot $root -DefaultTimeout ${timeout} -OutputLimit ${output} -TransferTtl ${ttl} -ChunkBytes ${chunkBytes};& ${psString(functionName)} -Payload ${psString(payload)} -Nonce ${psString(nonce)}}catch{${errorFrame}}}`;
    try {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(script, 'utf8'));
      if (identity.epoch() !== expectedEpoch) fail('workspace_changed', 'Workspace changed during Host binding.');
      permissions.assert('hostBind');
      const response = await capture(terminal, 'hostBind', nonce, command, 30000);
      if (!response.ok) fail(response.error.code, response.error.message);
      if (identity.epoch() !== expectedEpoch) fail('workspace_changed', 'Workspace changed during Host binding.');
      if (response.result.protocol !== 2) fail('host_protocol_mismatch', 'Unexpected Host helper protocol.');
      binding = { key: bindingKey(root), root: root.toString(), terminal, functionName, noEchoInput: response.result.noEchoInput === true, chunkBytes: response.result.chunkBytes };
      jobs.clear(); transfers.clear();
      uncertain = false;
      return { bound: true, workspace: root.toString(), terminal: terminal.name, protocol: 2, noEchoInput: binding.noEchoInput, chunkBytes: binding.chunkBytes };
    } finally {
      // Owned handshake cleanup is not an agent delete request. It never traverses directories.
      if (identity.epoch() === expectedEpoch) try { await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false }); } catch {}
    }
  }
  async function perform(root, op, action, options = {}) {
    permissions.assert(op);
    if (!binding || binding.key !== bindingKey(root) || !vscode.window.terminals.includes(binding.terminal)) await bind(root);
    if (uncertain) fail('host_channel_uncertain', 'Host command outcome is unknown. Inspect the Host and explicitly recover the binding.');
    permissions.assert(op);
    if (action.parents === true) permissions.assert('mkdir');
    if (action.overwrite === true) permissions.assert('write');
    if (['readBytes','openRead','readChunk'].includes(action.action)) permissions.assert('readBytes');
    if (['writeBytes','beginWrite','writeChunk','commitWrite'].includes(action.action)) permissions.assert('writeBytes');
    if (action.action === 'applyPatch') for (const permission of ['edit','create','move','delete']) permissions.assert(permission);
    const nonce = crypto.randomUUID().replaceAll('-', '');
    const payload = Buffer.from(JSON.stringify({ ...action, requestNonce: nonce })).toString('base64');
    const useInput = binding.noEchoInput && payload.length > 2048;
    const command = `& ${psString(binding.functionName)} -Nonce ${psString(nonce)} ` + (useInput ? '-ReadInput' : `-Payload ${psString(payload)}`);
    const response = await capture(binding.terminal, op, nonce, command, options.timeoutMs || 45000, useInput ? payload : null);
    if (!response.ok) fail(response.error.code || 'host_error', response.error.message, { action: action.action, mutationMayHaveOccurred: ['copyFile','copyDirectory','writeBytes','commitWrite','applyPatch','startJob'].includes(action.action) });
    return response.result;
  }
  function enqueue(task) {
    const result = queue.then(() => { if (disposed) fail('host_channel_closed', 'Host channel is closed.'); return task(); });
    queue = result.catch(() => {}); return result;
  }
  function request(root, op, action, options) { const epoch=identity.epoch();return enqueue(() => {if(identity.epoch()!==epoch)fail('workspace_changed','Workspace changed while the Host request was queued.');return perform(root, op, action, options);}); }
  function changed(workspaceChanged = false) {
    const denied = pending && permissions.reason(pending.op);
    if (denied) pending.reject(denied);
    if (workspaceChanged) { pending?.reject({code:'workspace_changed',message:'Host context changed while a request was in flight.'});binding = null; jobs.clear(); transfers.clear(); }
  }
  function resource(map, id, root) {
    const entry = map.get(id); if (!entry || entry.key !== bindingKey(root)) fail('host_resource_not_found', 'The job or transfer does not belong to this workspace binding.'); return entry;
  }
  return {
    status, bind: (root, options) => enqueue(() => bind(root, options)), request,
    jobs, transfers, resource, key: bindingKey,
    terminalClosed(terminal) { if (binding?.terminal===terminal || pending?.terminal===terminal) changed(true); },
    changed,
    dispose() { disposed = true; pending?.reject({ code: 'host_channel_closed', message: 'Host channel closed; already-dispatched work may continue until its bounded timeout.' }); binding = null; jobs.clear(); transfers.clear(); }
  };
}
module.exports = { createHostChannel, renderBootstrap, psString };
