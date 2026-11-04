# Settings

**English** | [简体中文](SETTINGS.zh-CN.md) | [繁體中文](SETTINGS.zh-TW.md) | [日本語](SETTINGS.ja.md)

This reference describes the current repository schema; the installed release can expose fewer/different commands. Use its version, Settings UI and matching release assets as the authority. All keys below have prefix liveshareWorkspaceBridge. and schema scope machine (User/Remote settings as VS Code permits, not Workspace/Folder). The UI extension runs on the Windows Guest: changing Host machine settings is not the same. IPC trust reads explicit User global values and ignores workspace/contributed defaults.

## General, IPC and Host parameters

| Setting (prefix omitted) | Type / default / range | Purpose and safety | Effect |
|---|---|---|---|
| `agent.enabled` | `boolean` / `true` | Master switch for workspace operations. info/hostStatus and safe diagnostic metadata remain inspectable; turning off does not undo dispatched effects. | Next requests; Host binding/resources also invalidated. |
| `host.enabled` | `boolean` / `false` | Allows Host-dependent APIs, subject to operation switches and a verified shared RW terminal, which is used once to start the Host helper. Binding may create/remove owned temporary bootstrap files; it never makes an ordinary Guest shell a Host. Replaces `terminal.enabled`. | Next requests; Host binding/resources also invalidated. |
| `powershell` | `string` / `""` | Guest-local PowerShell executable override for IPC/account helpers. Empty uses built-in Windows PowerShell. This does not select the Host terminal shell or change execution policy. | Next local bridge start; no automatic switch of the running helper. |
| `ipc.accessMode` | `string` / `"ownerOnly"` | ownerOnly / selectedUsers. A stored allLocalUsers value (removed in 0.3.0) runs as ownerOnly; settings are not rewritten, and info reports it as ipc.requestedMode with ipc.deprecatedModeIgnored. Owner is always retained. Additional grants are only current local SAM users in the same Windows session ID, not Everyone/groups/all domain users; DC enumeration is refused. Trust covers all their processes outside any agent filesystem sandbox limits, under bridge permissions. | IPC bridge restart / new instance+epoch; rediscover. |
| `ipc.selectedUserSids` | `array` / `[]` | Stable SID selection used only by selectedUsers; ignored for grants in other modes. Unique list, at most 256 strings; UI validates the local-user SID pattern, runtime also limits each string to 184 characters and verifies local SAM membership. Names are display only; rename survives, deletion/recreation never substitutes identity. | IPC bridge restart / new instance+epoch; rediscover. |
| `ipc.allowCodexSandboxClients` | `boolean` / `false` | Deprecated compatibility flag. If no explicit User mode exists, true pins the two existing legacy sandbox identities to selectedUsers; false/unset stays ownerOnly. Explicit mode wins. It never enables Host access. Initial migration writes User settings; a boolean cannot restore pre-snapshot deleted/recreated SIDs. | IPC bridge restart / new instance+epoch; rediscover. |
| `host.terminalName` | `string` / `""` | Exact name of the shared terminal used to start the Host helper. Empty requires one eligible shared PTY candidate. Read-only hints and binding are still checked; terminal title is not actual shell/version proof. | Invalidate Host binding; next permitted Host call binds again. |
| `host.workspacePath` | `string` / `""` | Optional explicit Host root; empty verifies the shared PowerShell current directory with the Guest root. It is a Host path, not the local Guest path. The hostBind request argument may override it. | Invalidate Host binding; next permitted Host call binds again. |
| `host.commandTimeoutMs` | `integer` / `120000` / 1000..3600000 | Default Host child-command timeout in milliseconds. hostExec timeoutMs can override it within the supported range. Started jobs retain their original deadline; this is not a universal IPC/handshake timeout. | Invalidate Host binding; next permitted Host call binds again. |
| `host.maxOutputCharacters` | `integer` / `65536` / 1024..262144 | Retained characters per stdout and stderr stream separately. Excess is drained and marked truncated, not complete output. | Invalidate Host binding; next permitted Host call binds again. |
| `transfer.chunkBytes` | `integer` / `32768` / 1024..65536 | Maximum raw bytes per transfer chunk and small-byte API. Both Guest validation and Host session use it; changing it invalidates the binding before further Host work. Does not enable downloads. | Invalidate Host binding; next permitted Host call binds again. |
| `transfer.idleTimeoutMs` | `integer` / `120000` / 10000..900000 | Idle lifetime of Host transfer handles/staging in milliseconds. New binding uses this value; old resources retain their established expiry. | Invalidate Host binding; next permitted Host call binds again. |
| `host.guestPort` | `integer` / `0` / 0..65535 | Local port the Guest connects to; 0 means the same port as the Host helper. Set it only when Live Share forwarded the Host port to a different local port: when the Host helper port is already in use on the Guest, Live Share picks another local port and shows it only on the Guest, in the shared servers list of the Live Share view (or run "Live Share: Show Shared Servers"). Find the entry for the Host helper port and enter its local Guest port here. The bridge does not discover the remapped port automatically, because Live Share's forwarder runs inside VS Code processes that also host other local services and the bridge never probes them. | Read on every handshake attempt: a value entered while a bind is waiting is used on the next attempt (about 2 s) without rebinding; an established binding keeps its port. |
| `host.idleTimeoutMinutes` | `integer` / `30` / 1..1440 | The Host helper exits after this many minutes without a request. | Next helper started. |
| `host.handshakeTimeoutMinutes` | `integer` / `5` / 1..60 | How long the background handshake started by hostBind waits for the Host to share the helper port; hostBind itself returns before that. Afterwards hostStatus shows `handshake.state: "failed"` with `handshake.code: "host_port_forward_required"`. Timeout, Cancel or a foreign service on the port do not mark the channel uncertain. | Next Host bind. |

How the Host channel works: the shared RW terminal starts a foreground Host helper once (it exits on Ctrl+C, terminal close, session end or idle timeout). The Host then runs "Live Share: Share Server" once with the port the bridge shows. hostBind returns as soon as the helper listens (`handshake.state: "waitingForward"`); the handshake finishes in the background and hostStatus reports it, while other Host requests return `host_handshake_pending`. Requests then use the forwarded loopback port with a per-helper token. No request is typed into the terminal.

## Deprecated keys (read for one version)

0.3.0 renamed the `terminal.*` keys. When a new key is not set explicitly, the bridge still reads the old key's User value, and writes one line per old key to the "Live Share Workspace Bridge Host" output channel. It never rewrites your settings; rename them yourself.

| Old key | New key |
|---|---|
| `terminal.enabled` | `host.enabled` |
| `terminal.name` | `host.terminalName` |
| `terminal.hostWorkspacePath` | `host.workspacePath` |
| `terminal.commandTimeoutMs` | `host.commandTimeoutMs` |
| `terminal.maxOutputCharacters` | `host.maxOutputCharacters` |

An explicitly set new key always wins, even when it is `false`. `host.transport` was removed: the Host channel always uses the forwarded port. A stored `sharedTerminal` value runs as portForward and logs one line to the same output channel; other values are ignored.

## Operation switches

Every row below is boolean, defaults true, scope machine, and applies to subsequent permission checks without restarting local IPC. These authorize APIs, not data types or an OS sandbox: for example, readBytes can read bytes of text even if text read is disabled; agents must not use an alternate route to bypass user intent.

| Setting (prefix omitted) | Purpose and safety | Host requirement |
|---|---|---|
| `permissions.list` | Directory listing. | No |
| `permissions.read` | Text, batch and explicit provider reads; not raw-byte control. | No |
| `permissions.create` | New text files; needs save, and mkdir for missing parents. | No |
| `permissions.write` | Guarded whole-document replacement; also required for byte/file overwrite. | No |
| `permissions.edit` | Text replacements/batches; also part of checked patch authorization. | No |
| `permissions.save` | Target saves; required by create/write/edit/renameSymbol/format. No cross-file transaction. | No |
| `permissions.mkdir` | Directories and implicit parent creation. | No |
| `permissions.copy` | Byte-preserving Host file copy; overwrite also needs write. | Yes |
| `permissions.copyDirectory` | Host copy to a new directory, no merge/recursive replacement. | Yes |
| `permissions.move` | Path moves/renames; overwrite needs write, missing parents need mkdir. | No |
| `permissions.delete` | Files and empty directories only. | No |
| `permissions.stat` | Provider metadata / Host stat; raw hash additionally needs readBytes. | Conditional |
| `permissions.diagnostics` | Language diagnostics; empty is not a test result. | No |
| `permissions.symbols` | Document symbols. | No |
| `permissions.workspaceSymbols` | Workspace language symbols, not exhaustive saved-file search. | No |
| `permissions.definition` | Language definitions. | No |
| `permissions.references` | Language references. | No |
| `permissions.renameSymbol` | Text-only language rename/preview; needs save and target protection. | No |
| `permissions.format` | Provider formatting and target save. | No |
| `permissions.search` | Host saved-file search; explicit snapshots are limited and do not need Host. | Conditional |
| `permissions.findFiles` | Host path enumeration; explicit provider snapshots are limited. | Conditional |
| `permissions.applyPatch` | Checked Host Git text patches; edit/create/move/delete are all checked. | Yes |
| `permissions.readBytes` | Host bytes/raw hashes and download-handle permission, subject to availability. | Yes |
| `permissions.writeBytes` | Host bytes/uploads; overwrite needs write and raw hash guard. | Yes |
| `permissions.largeTransfers` | Chunked uploads; writeBytes also applies. Does not enable unavailable downloads. | Yes |
| `permissions.hostExec` | Arbitrary Host commands plus poll/cancel/forget; all other 25 operation switches must also be true. | Yes |

## Special behavior and non-settings


- agent/host/transfer setting changes (and the deprecated terminal.* keys) invalidate Host binding and Guest job/transfer references; the next permitted Host call rebinds. This does not restart the local IPC instance/epoch, stop an already-dispatched child or alter its original deadline. Old jobs may require Host-side inspection; transfer resources retain their established expiry. IPC-key changes instead restart the bridge, including when a changed SID/legacy field is currently unused.
- Turning permissions off is not rollback. Raw hostExec and its job controls require host.enabled and all 26 operation permissions; disabling one can also make poll/cancel unavailable, while the child's bounded timeout remains. copy/write overwrite and implicit parents have their extra write/mkdir gates. applyPatch always checks edit/create/move/delete; direct Host disk operations do not use document save permission.
- readMany/providerRead share read; searchSnapshot/searchResults share search; findFilesSnapshot shares findFiles; hostStat shares stat (hash additionally readBytes); hostJobPoll/Cancel/Forget share hostExec; transfer APIs share largeTransfers plus readBytes/writeBytes by direction. Host search/copy/patch/bytes/jobs require host.enabled; snapshots/language/document APIs do not. largeTransfers cannot make unavailable large downloads available.
- No additional literal configuration key read by the current runtime was found outside this public manifest. ipc.legacySidSnapshot is internal globalState, **not a setting**. hostExec timeoutMs/waitMs and hostBind hostWorkspacePath are request arguments, not Settings UI entries. Startup snapshot limits and fixed local IPC/Host-response/handshake waits are fixed implementation limits, not invented settings.
- Policy flags do not open/share a terminal, prove Host RW authorization or resolve unknown sent mutations. Review [IPC access](IPC-SECURITY.md), [API](API.md) and [startup diagnostics](STARTUP-DIAGNOSTICS.md). Agents may explain a denied setting, but must not enable it or broaden trust without explicit authorization.
