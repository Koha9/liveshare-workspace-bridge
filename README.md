# Live Share Workspace Bridge

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md)

Work in a connected VS Code Live Share Guest workspace through local Windows IPC, without HTTP ports or copied tokens.

## Features

- Document/range reads, version-guarded batch edits and target-only saves.
- Optional Host channel: saved-file search, bounded commands, checked text patches, byte-preserving copies and large uploads.
- Language-provider symbols, definitions, references, renames and formatting. English operation and IPC-access controls.

Recursive deletion and cross-file atomic saves are unavailable. Large downloads (`transferOpenRead`/`transferRead`, including CLI download) return `feature_unavailable`. Ask the user for an accessible copy and local path; do not bypass the limit with repeated byte reads or raw commands. Small byte reads and large uploads remain available.

## Get started

Windows, VS Code 1.101+ with Live Share, and Node.js are required. Any agent that supports MCP stdio servers can use the bridge, for example Claude Code, Codex or the VS Code built-in agent.

1. Install the [extension](https://marketplace.visualstudio.com/items?itemName=Koha9-Lee.liveshare-workspace-bridge) in your Live Share Guest window and connect to the shared project.
2. Run **Live Share Workspace Bridge: Copy MCP Server Configuration** and add the copied entry to your agent. The VS Code built-in agent discovers the server automatically.
3. Ask the agent to call `lswb_list_workspaces` and start working.

The [MCP guide](docs/MCP.md) covers per-agent setup, the tool list and result semantics. The Codex skill from [Releases](https://github.com/Koha9/liveshare-workspace-bridge/releases) is the legacy interface; MCP will replace it.

Host features need a connected shared RW Windows PowerShell and the relevant permissions; search/patches also need Host ripgrep/Git. Terminal access defaults off. See [settings](docs/SETTINGS.md).

## Guides

[MCP](docs/MCP.md) | [Settings](docs/SETTINGS.md) | [Usage](docs/USAGE.md) | [API](docs/API.md) | [IPC access](docs/IPC-SECURITY.md) | [Startup diagnostics](docs/STARTUP-DIAGNOSTICS.md) | [Development](docs/DEVELOPMENT.md) | [Changelog](docs/CHANGELOG.md)

[MIT](LICENSE)
