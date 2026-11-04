# Live Share Workspace Bridge

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md)

Let AI agents work in a connected VS Code Live Share Guest workspace. Agents reach the extension through a local MCP server and a local Windows named pipe, which opens no network ports. The optional Host channel uses a Live Share forwarded loopback port with a per-helper token.

## Features

- Document/range reads, version-guarded batch edits and target-only saves.
- Optional Host channel: saved-file search, bounded commands, checked text patches, byte-preserving copies and large uploads.
- Language-provider symbols, definitions, references, renames and formatting. English operation and IPC-access controls.

Recursive deletion and cross-file atomic saves are unavailable. Large downloads (`transferOpenRead`/`transferRead`) return `feature_unavailable`. Ask the user for an accessible copy and local path; do not bypass the limit with repeated byte reads or raw commands. Small byte reads and large uploads remain available.

## Requirements

- Windows, VS Code 1.101 or later, and the Live Share extension.
- Node.js on `PATH` for the Windows account that runs your agent and VS Code. The MCP server is started with the `node` command.
- Install this extension in the **Guest** window only, the VS Code window that joins the Live Share session. The Host installs nothing.
- An agent that supports MCP stdio servers, for example Claude Code, Codex or the VS Code built-in agent.

## 1. Install and connect

1. In the Guest VS Code window, install [Live Share Workspace Bridge](https://marketplace.visualstudio.com/items?itemName=Koha9-Lee.liveshare-workspace-bridge) from the Marketplace, or install a VSIX with **Extensions: Install from VSIX...**.
2. Join the Host's Live Share session in that window.

## 2. Configure MCP

Run **Live Share Workspace Bridge: Copy MCP Server Configuration** from the Command Palette. It copies ready-to-paste snippets for Claude Code, Codex and VS Code to the clipboard and also prints them in the "Live Share Workspace Bridge" output channel. The copied snippets contain your real path; the examples below use the placeholder `<home>` for your user profile folder.

All configurations point at the launcher `<home>/.liveshare-local/mcp-server.cjs`. The extension installs and updates this file when it activates. The launcher always starts the MCP server of the extension version that is currently running, so you do not need to change your agent configuration after an extension upgrade.

### Claude Code

```text
claude mcp add lswb -- node "<home>/.liveshare-local/mcp-server.cjs"
```

Add `--scope user` after `add` to make the server available in every project.

### Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.lswb]
command = "node"
args = ["<home>/.liveshare-local/mcp-server.cjs"]
```

### VS Code built-in agent

No configuration is needed: the extension registers the server with VS Code as "Live Share Workspace Bridge", and it appears in VS Code's MCP server list. If you prefer an explicit entry instead, add this to `.vscode/mcp.json` or your user `mcp.json`:

```json
{
  "servers": {
    "lswb": {
      "type": "stdio",
      "command": "node",
      "args": ["<home>/.liveshare-local/mcp-server.cjs"]
    }
  }
}
```

### Other MCP clients

Any client that can start a stdio server works. Use command `node` with one argument, the launcher path `<home>/.liveshare-local/mcp-server.cjs`. No environment variables are needed.

After adding the server, restart or reload your agent so that it starts the server: start a new Claude Code session, restart Codex, or start the server from VS Code's MCP server list.

## 3. First call

Ask the agent to call `lswb_list_workspaces` first. It returns the shared roots; every other tool takes the exact root `uri` (a `vsls:` URI) as its `workspace` argument. Example prompt:

> Use the lswb tools. Call lswb_list_workspaces, pick the shared project, then read README.md from it.

The full tool list and result semantics are in the [MCP guide](docs/MCP.md). MCP is the only agent interface.

## 4. Optional: Host channel

Search, commands, patches, byte copies and uploads run on the Host. To use them:

1. **Guest:** run **Live Share Workspace Bridge: Configure Agent Permissions**. It opens the extension's settings; turn on **Allow Host Access** (`host.enabled`, off by default). The individual operation switches are on by default; raw commands (`lswb_host_exec`) need all of them.
2. **Host:** share a Windows PowerShell terminal in Live Share with read/write access. **Guest:** open that shared terminal. If several shared terminals exist, set `host.terminalName` to the exact name.
3. **Agent:** call `lswb_host_bind`. The bridge types one launch line into the shared terminal to start the Host helper, which runs in the foreground in memory and installs nothing. The call returns `handshake.state: "waitingForward"` with the `hostPort`, and the Guest window shows the same port in a notification.
4. **Host:** run **Live Share: Share Server** and enter that port.
5. **Agent:** call `lswb_host_status` until it reports `bound: true`. Host tools work from then on.

To stop the Host helper, press Ctrl+C in the shared terminal. It also exits when the terminal closes, the session ends, or after `host.idleTimeoutMinutes` (30 by default) without a request. Search needs ripgrep (`rg`) and patches need Git on the Host. See [Settings](docs/SETTINGS.md).

## Troubleshooting quick reference

- **`lswb_list_workspaces` finds nothing (`no_records`), or the launcher reports that no running instance was found:** make sure the Guest window is open with the extension enabled and has joined the session, and that the agent runs under the same Windows account as VS Code (IPC access is owner-only by default). Reload the Guest window if needed. See [Troubleshooting](docs/TROUBLESHOOTING.md) and [IPC access](docs/IPC-SECURITY.md).
- **The agent cannot start the server, or `node` is not recognized:** install Node.js or add it to `PATH`, then restart the agent and VS Code. You can also replace `node` with the full path to `node.exe` in the configuration.
- **The Host channel stays at `waitingForward`:** the Host has not shared the port yet. Run **Live Share: Share Server** on the Host with the exact `hostPort`. If Live Share forwarded it to a different local port on the Guest, set `host.guestPort`. The wait ends after `host.handshakeTimeoutMinutes`. See [Settings](docs/SETTINGS.md).
- **After an extension upgrade:** reload the Guest window and restart the agent so that it starts the server of the new version. The launcher path stays the same, so no configuration change is needed.
- **The status bar shows "LSWB: IPC failed":** run **Live Share Workspace Bridge: Show Startup Diagnostics**. See [Startup diagnostics](docs/STARTUP-DIAGNOSTICS.md).

## Guides

[MCP](docs/MCP.md) | [Settings](docs/SETTINGS.md) | [Usage](docs/USAGE.md) | [API](docs/API.md) | [IPC access](docs/IPC-SECURITY.md) | [Startup diagnostics](docs/STARTUP-DIAGNOSTICS.md) | [Troubleshooting](docs/TROUBLESHOOTING.md) | [Development](docs/DEVELOPMENT.md) | [Changelog](docs/CHANGELOG.md)

[MIT](LICENSE)
