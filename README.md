# Live Share Workspace Bridge

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md)

Work in a connected VS Code Live Share Guest workspace through local Windows IPC, without HTTP ports or copied tokens.

## Features

- Document/range reads, version-guarded batch edits and target-only saves.
- Optional Host channel: saved-file search, bounded commands, checked text patches, byte-preserving copies and large uploads.
- Language-provider symbols, definitions, references, renames and formatting. English operation and IPC-access controls.

Recursive deletion and cross-file atomic saves are unavailable. Large downloads (`transferOpenRead`/`transferRead`, including CLI download) return `feature_unavailable`. Ask the user for an accessible copy and local path; do not bypass the limit with repeated byte reads or raw commands. Small byte reads and large uploads remain available.

## Get started

Windows, VS Code with Live Share, and Node.js are required.

1. Install the [extension](https://marketplace.visualstudio.com/items?itemName=Koha9-Lee.liveshare-workspace-bridge) in your Live Share Guest window and connect to the shared project.
2. Ask your agent to install the skill matching your extension version from [Releases](https://github.com/Koha9/liveshare-workspace-bridge/releases).
3. Ask the agent to use `$liveshare-workspace-bridge` and start working.

Host features need a connected shared RW Windows PowerShell and the relevant permissions; search/patches also need Host ripgrep/Git. Terminal access defaults off. See [settings](docs/SETTINGS.md).

## Guides

[Settings](docs/SETTINGS.md) | [Usage](docs/USAGE.md) | [API](docs/API.md) | [IPC access](docs/IPC-SECURITY.md) | [Startup diagnostics](docs/STARTUP-DIAGNOSTICS.md) | [Development](docs/DEVELOPMENT.md) | [Changelog](docs/CHANGELOG.md)

[MIT](LICENSE)
