# Development

**English** | [简体中文](DEVELOPMENT.zh-CN.md) | [繁體中文](DEVELOPMENT.zh-TW.md) | [日本語](DEVELOPMENT.ja.md)

[Documentation](README.md)

## Requirements

Use Windows, Node.js, and a confirmed Python 3 executable. The extension uses built-in Node modules and Windows PowerShell; the in-memory Host runtime is C# compiled by the Host PowerShell session; package builds use Python's standard library. No dependency installation is required.

## Source layout

```text
extension/                    Extension, CLI, and tests
skills/liveshare-workspace-bridge/    Codex skill and self-contained client
scripts/build.py              Synchronization, packaging, and package checks
docs/                         User and contributor documentation
dist/                         Generated packages and SHA-256 files
.local/                       Local-only working files
```

`extension/cli.cjs` is the canonical client. The build synchronizes its copy in the skill. Keep interface changes reflected in the API reference and all translations.

## Run checks

```powershell
npm test
npm run check

$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py --check
```

Tests cover edit preflight, save failures, dirty-buffer protection, live permission dependencies, patch paths, stale-model content guards, real Windows IPC, Host byte transfers, bounded output, cancellation and process cleanup. Normal tests do not modify a connected Live Share project.

## Build packages

```powershell
& $pythonExe .\scripts\build.py
& $pythonExe .\scripts\build.py --verify
```

The build produces a VSIX, a self-contained skill ZIP, and SHA-256 files in `dist/`. `--check` checks layout, versions, and client synchronization without writing. `--verify` compares existing package members and checksums against the current source. Packages include the translated reader documentation.

## Live workspace tests

`extension/test/live-v01.cjs` is opt-in. With an appropriate connected workspace and explicit test scope, set `LIVESHARE_RUN_LIVE=1` before running it. It creates and removes a uniquely named directory and writes local receipts to `.local/evidence/`. It also changes the Search View query. Keep these tests out of normal CI runs.

## Documentation

English files have no locale suffix; translations use `.zh-CN`, `.zh-TW`, and `.ja`. Each page links to its translated counterparts. Keep commands, field names, limits, and behavior aligned across languages.

## Repository hygiene

`dist/`, `.local/`, dependency folders, and local configuration are ignored by Git. Keep access tokens, local receipts, and machine-specific paths out of committed files. The Windows workflow in `.github/workflows/ci.yml` runs checks and builds without publishing packages.

The skill instructions and references are English-only; do not add locale variants inside the skill directory.

## v0.2 Host testing

Host integration is opt-in and uses a dedicated RW shared PowerShell and unique fixtures. Permission changes made by a test must be leased and restored without overwriting concurrent user changes. Never stage/commit/push as part of tests. All Host features must be denied while terminal access is off. Normal tests must never fall back to a real Guest terminal.
