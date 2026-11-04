# Changelog

**English** | [简体中文](CHANGELOG.zh-CN.md) | [繁體中文](CHANGELOG.zh-TW.md) | [日本語](CHANGELOG.ja.md)

- 0.3.0-pre — Removed the allLocalUsers IPC access mode; only ownerOnly and selectedUsers remain. A stored allLocalUsers value runs as ownerOnly, shows one notice per window session, and is not rewritten. info and lswb_status add ipc.requestedMode and ipc.deprecatedModeIgnored. See [IPC access](IPC-SECURITY.md).
- 0.3.0-pre — Activation is now limited to `onFileSystem:vsls` and `onStartupFinished` instead of `*`.

- 0.3.0-pre — The MCP server (`mcp-server.cjs`, `mcp-tools.cjs`) now ships in the VSIX, so the launcher and the VS Code registration work in the installed extension. The build fails if a packaged module requires a file that is not packaged. Copied MCP configuration uses forward-slash paths. New [MCP guide](MCP.md).
- 0.3.0-pre — The extension registers its MCP server with VS Code through `vscode.lm.registerMcpServerDefinitionProvider`, which raises the minimum VS Code version to 1.101.
- 0.3.0-pre — Optional `host.transport: portForward`: the shared terminal starts a foreground in-memory Host helper once and requests use a Live Share forwarded loopback port (settings `host.transport`, `host.guestPort`, `host.idleTimeoutMinutes`, `host.handshakeTimeoutMinutes`; default `sharedTerminal` is unchanged). New error codes: `host_transport_unavailable`, `host_request_too_large`, `host_bind_cancelled`, `host_port_forward_required`, `host_port_unavailable`.

- 0.2.4 — Broken-pipe cleanup, bounded runtime reconnection, preserved Host uncertainty, concurrent discovery and agent restart guidance.

- 0.2.3 — Local startup summaries, safe shell metadata and current/history separation.

- 0.2.2 — Owner/local/selected-SID IPC modes and legacy-setting migration.

- 0.2.1 — Explicit discovery errors and hardened local IPC framing.

- 0.2 — Optional Host search, jobs, text patches, bytes and uploads.
