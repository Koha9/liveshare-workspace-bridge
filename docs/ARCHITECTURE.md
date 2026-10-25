# Architecture

**English** | [简体中文](ARCHITECTURE.zh-CN.md) | [繁體中文](ARCHITECTURE.zh-TW.md) | [日本語](ARCHITECTURE.ja.md)

[Documentation](README.md)

## Request path

```text
Codex skill or CLI
    → current-user Windows named pipe
    → PowerShell transport process
    → VS Code extension APIs
    → Live Share file provider
```

## Components

| Component | Responsibility |
|---|---|
| `extension/extension.cjs` | Activation, transport lifecycle, instance discovery, and workspace epochs |
| `extension/pipe-host.ps1` | Current-user pipe permissions and JSON frame forwarding |
| `extension/workspace.cjs` | Fixed file, document, search, and language operations |
| `extension/core.cjs` | Path validation, content guards, EOL handling, and edit planning |
| `extension/cli.cjs` | Discovery, request transport, and CLI exit status |
| `skills/liveshare-workspace-bridge/` | Codex instructions and a self-contained client |

## Workspace binding

Each VS Code window has an instance ID. Workspace changes update an epoch. Requests bind the selected instance and epoch to an exact root URI. This prevents a stale selection from silently following a different workspace that also uses `vsls:/`.

Discovery records contain connection metadata under `~/.liveshare-local/instances/`; they are not access tokens. The extension starts the pipe helper without a visible console and stops it with the owning process.

## Document operations

Shared URIs retain their `vsls:` scheme. Reads use current editor buffers. Batch text edits are preflighted together, submitted as one WorkspaceEdit, and saved per document. Saving several files is not an atomic disk transaction.

Normal operations reuse document versions and save results. Provider rereads and text hashes are explicit, not automatic confirmation steps. A transport failure after sending a request leaves its outcome unknown and does not trigger replay.

## Access boundary

Windows PowerShell uses an explicit current-user pipe ACL; PowerShell 7 can use `CurrentUserOnly`. The bridge exposes a fixed operation set, not arbitrary shell or VS Code command execution. Other programs running as the same Windows user can access the interface.

Node filesystem APIs handle local request files and discovery records only. Virtual resources are resolved through VS Code and Live Share. The bridge does not provide a Host execution environment.
