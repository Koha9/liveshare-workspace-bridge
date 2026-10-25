# Live Share Workspace Bridge

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md)

Let Codex work with a VS Code Live Share workspace through a local Windows bridge. Read shared files, edit multiple documents, and save changes through the existing Live Share connection.

## Features

- Read directories, selected lines, multiple files, and unsaved editor buffers.
- Apply text replacements, line edits, and changes across multiple documents.
- Save only the documents you change, with per-file results.
- Create files and directories, copy files, move or rename paths, and delete files or empty directories.
- Query diagnostics, document symbols, workspace symbols, and definitions.
- Use VS Code's native search view and file-name search.
- Connect through a Windows named pipe restricted to the current user.

## Requirements

- Windows with VS Code and Live Share.
- A Live Share Guest window connected to the shared project.
- Node.js for the CLI and Codex skill.
- Python 3 for building packages. The build uses only the standard library.

The extension uses Windows PowerShell, which ships with Windows. No npm dependencies or Host-side installation are required.

## Getting started

### Build and install the extension

```powershell
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py

$vsix = Get-ChildItem .\dist\liveshare-workspace-bridge-*.vsix |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
code --install-extension $vsix.FullName
```

Install in the VS Code Profile used by the Guest window. Add `--profile '<profile-name>'` when needed. Follow VS Code's reload prompt after installation or updates, then reconnect to Live Share if necessary.

### Add the Codex skill

Copy `skills/liveshare-workspace-bridge/` to your Codex skills directory, such as `$env:USERPROFILE\.codex\skills\liveshare-workspace-bridge`. If the directory already exists, review local changes before replacing it. The ZIP in `dist/` contains the same self-contained skill.

Invoke `$liveshare-workspace-bridge` in Codex and describe the task you want to perform in the shared project.

### Use the CLI

```powershell
node .\extension\cli.cjs instances

node .\extension\cli.cjs --instance '<id>' --epoch '<epoch>' `
    --workspace 'vsls:/' --request '<request.json>'
```

Example `request.json`:

```json
{"op":"read","path":"README.md","startLine":1,"endLine":20}
```

Select the intended window once and reuse its instance ID, epoch, and root URI. Shared paths are relative to that root. See the [usage guide](docs/USAGE.md) and [API reference](docs/API.md).

## How it works

```text
Codex skill / CLI → current-user Windows named pipe
                 → VS Code APIs → Live Share → shared files
```

The bridge preserves `vsls:` URIs and edits the current document buffer. Batch edits are checked together, applied in one workspace edit, and saved per document. Successful saves do not trigger automatic provider rereads or full-document hashes.

## Limitations

- Content search returns the current Search View snapshot, without a completion signal. File-name search may omit newly created files.
- Batch saves are not a cross-file disk transaction. Check each file's result if a save fails.
- The bridge does not provide a Host shell, remote build or Git execution, recursive deletion, directory copying, binary writes, or general unified-diff parsing.
- The pipe is a same-user automation interface, not an isolation boundary against other programs running as that Windows user.

## Documentation

Read the [documentation index](docs/README.md) for setup, API details, architecture, development, and troubleshooting.

## Development

```powershell
npm test
npm run check
& $pythonExe .\scripts\build.py --check
& $pythonExe .\scripts\build.py --verify
```

Build outputs go to `dist/`. See the [development guide](docs/DEVELOPMENT.md) for the source layout and packaging workflow.

## License

MIT License. See [LICENSE](LICENSE).
