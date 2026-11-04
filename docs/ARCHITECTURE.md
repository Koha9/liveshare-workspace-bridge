# Architecture

**English** | [简体中文](ARCHITECTURE.zh-CN.md) | [繁體中文](ARCHITECTURE.zh-TW.md) | [日本語](ARCHITECTURE.ja.md)

[Documentation](README.md)

- extension.cjs owns local IPC (owner-only by default), lifecycle and English permission status.
- permissions.cjs is the request authorization layer; it reads live User/machine settings before dispatch and Host send. Agent endpoints cannot update permissions.
- workspace.cjs owns document versions, dirty-buffer checks, text preflight, language edits and targeted saves. Host mutations keep affected model guards until normalized content matches.
- host-channel.cjs serializes Host requests, starts the Host helper once through the shared terminal (verified by a random bootstrap file), waits in the background for the forwarded port and sends each request over loopback TCP (host-transport-tcp.cjs) with a per-helper token and nonce. host-terminal.cjs selects the shared RW terminal; host-bootstrap.cjs renders the helper and reads its listening banner. No request is typed into the terminal.
- host-operations.cjs maps public APIs to narrow Host actions and binds jobs/transfers to root and epoch.
- host-server.ps1 is the foreground in-memory Host helper; it embeds host-core.ps1 (the Host actions). host-runtime.cs provides owned Windows Job Objects, bounded stream draining, chunked byte handles, SHA-256 and expiry. No permanent Host agent is installed; the helper listens on loopback only and exits on Ctrl+C, terminal close, session end or idle timeout.
- mcp-server.cjs is the stdio MCP protocol layer (initialize, tools/list, tools/call). It writes only protocol frames to stdout.
- mcp-tools.cjs defines the MCP tool table. It maps Guest, Host and local-file tools onto bridge operations through the cli.cjs transport and keeps the root-uri-to-instance/epoch bindings. Unknown transport outcomes are reported, never replayed.
- mcp-launcher.cjs is a self-contained launcher that the extension installs to `~/.liveshare-local/mcp-server.cjs` (via mcp-launcher-install.cjs, which also renders the Copy MCP Server Configuration snippets). It starts mcp-server.cjs from a live discovery record (newest server file first, then newest record), so agent configurations survive upgrades.
- mcp-definition-provider.cjs registers mcp-server.cjs with VS Code (`vscode.lm.registerMcpServerDefinitionProvider`) so that the built-in agent discovers it.
- cli.cjs is a troubleshooting CLI for people (instances, diagnose, pinned raw JSON requests) and the local transport library that mcp-tools.cjs uses for discovery, requests and chunked uploads. Agents do not call it directly.

The document path remains the default for text edits, without provider rereads after every save. The optional Host path handles complete saved-file search, commands, patches and byte/directory operations. Raw Host execution requires all operation permissions; narrow actions remain individually controllable. These checks are not an OS sandbox for arbitrary scripts.

Dispatched work is not rolled back on revocation. Child tasks retain a bounded timeout; synchronous filesystem actions may still complete after a Guest response timeout. Unknown outcomes are not retried. Transfers have idle expiry and owned temporary staging; directory copy can partially fail. No recursive delete or multi-file disk transaction is exposed.

`pipe-security.cs` / `pipe-host.ps1`: explicit owner/sandbox DACL, local/session gate, persistent single-instance pipe, bounded UTF-8 input and reply drain.

`local-accounts.cs` enumerates only local SAM users and selects stable SIDs; `ipc-access.cjs` owns User-only mode resolution, one-time legacy SID migration and the English account picker.

Large downloads (`transferOpenRead`/`transferRead`) return `feature_unavailable`. Ask the user for an accessible copy and local path; do not bypass the limit with repeated byte reads or raw commands. Small byte reads and large uploads remain available.
