# Changelog

**English** | [简体中文](CHANGELOG.zh-CN.md) | [繁體中文](CHANGELOG.zh-TW.md) | [日本語](CHANGELOG.ja.md)

[Documentation](README.md)

- 0.3.0
  - Upgrade notes: the `terminal.*` settings are now `host.*`; old User values are still read for one version while the new key is unset, and nothing is rewritten, so rename them yourself. A stored `allLocalUsers` IPC mode runs as ownerOnly with one notice. The Codex skill is gone: add the MCP server to your agent with **Copy MCP Server Configuration**. Host features now need the Host to run "Live Share: Share Server" once for the helper port the bridge shows. VS Code 1.101 or later is required.
  - Added: an MCP stdio server with 36 `lswb_` tools, shipped in the VSIX (`mcp-server.cjs`, `mcp-tools.cjs`), a stable launcher at `~/.liveshare-local/mcp-server.cjs` that follows the running extension version, and the **Copy MCP Server Configuration** command. Copied configuration uses forward-slash paths. The build fails if a packaged module requires a file that is not packaged. New [MCP guide](MCP.md).
  - Added: the extension registers its MCP server with VS Code through `vscode.lm.registerMcpServerDefinitionProvider`, so the built-in agent discovers it.
  - Added: Host channel over a Live Share forwarded port. The shared terminal starts a foreground in-memory Host helper once, and requests use the forwarded loopback port with a per-helper token. New settings `host.guestPort`, `host.idleTimeoutMinutes` and `host.handshakeTimeoutMinutes`. New error codes `host_transport_unavailable`, `host_request_too_large`, `host_bind_cancelled`, `host_port_forward_required` and `host_port_unavailable`.
  - Added: `hostBind` returns `waitingForward` (with `hostPort` and `next`) as soon as the Host helper listens, and the forwarded-port handshake finishes in the background. `hostStatus` bypasses the dispatch queue like `info` and reports `handshake.state` and `handshake.code`. Other Host requests return the new `host_handshake_pending` until the handshake completes.
  - Added: on activation the extension removes discovery records left by exited windows (matching name, id, pid and pipe name; links and other files are left alone).
  - Added: info and lswb_status report ipc.requestedMode and ipc.deprecatedModeIgnored.
  - Changed: the minimum VS Code version is 1.101.
  - Changed: activation is limited to `onFileSystem:vsls` and `onStartupFinished` instead of `*`.
  - Changed: the `terminal.*` settings were renamed to `host.enabled`, `host.terminalName`, `host.workspacePath`, `host.commandTimeoutMs` and `host.maxOutputCharacters`; the old User values are still read for one version while the new key is unset, and settings are never rewritten. Error code `terminal_access_disabled` became `host_access_disabled`, and info.permissions reports `hostEnabled` instead of `terminalEnabled`.
  - Removed: the shared-terminal data transport. The shared Host terminal only starts the Host helper once, and every Host request uses the Live Share forwarded port. The `host.transport` setting was removed; a stored `sharedTerminal` value runs as portForward with one output-channel line.
  - Removed: the Codex skill; agents connect through the MCP server. The CLI keeps instances/diagnose/raw requests for troubleshooting.
  - Removed: the allLocalUsers IPC access mode; only ownerOnly and selectedUsers remain. A stored allLocalUsers value runs as ownerOnly, shows one notice per window session, and is not rewritten. See [IPC access](IPC-SECURITY.md).
  - Fixed: read and readMany report a file that does not exist as `not_found` instead of the generic `vscode_error`; in readMany only that entry fails and the other files are still returned.
  - Fixed: discovery records left by a reloaded or crashed window no longer make discovery `partial`. A missing pipe whose owner process has exited is reported as a `stale` probe with `ownerProcess: "exited"` (CLI discovery also counts it in `staleRecordCount`); if only such records remain, the status is `no_records`.

- 0.2.4 — Broken-pipe cleanup, bounded runtime reconnection, preserved Host uncertainty, concurrent discovery and agent restart guidance.

- 0.2.3 — Local startup summaries, safe shell metadata and current/history separation.

- 0.2.2 — Owner/local/selected-SID IPC modes and legacy-setting migration.

- 0.2.1 — Explicit discovery errors and hardened local IPC framing.

- 0.2 — Optional Host search, jobs, text patches, bytes and uploads.
