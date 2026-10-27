# Development

**English** | [简体中文](DEVELOPMENT.zh-CN.md) | [繁體中文](DEVELOPMENT.zh-TW.md) | [日本語](DEVELOPMENT.ja.md)

Windows, Node.js and confirmed Python 3 are required. Runtime uses built-in modules, Windows PowerShell and the bundled C# sources; packaging uses Python standard library only. No dependency installation is required.

```text
extension/                         Runtime, CLI and tests
skills/liveshare-workspace-bridge/  Skill and self-contained client
scripts/build.py                   Packaging and source checks
docs/                              Current product/contributor guides
dist/                              Ignored generated packages
.local/                            Ignored local working files
```

extension/cli.cjs is canonical; build synchronizes its skill copy. Keep source and skill versions, API fields and translations aligned. Skill instructions/references remain English-only.

```powershell
npm test
npm run check
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py
& $pythonExe .\scripts\build.py --check
& $pythonExe .\scripts\build.py --verify
```

Normal tests cover document/save/permission/IPC contracts without changing a connected project. A passing local suite is not proof that every Host, account, policy, remote session or language provider works.

The build creates VSIX/skill ZIP and SHA-256 files. --check validates layout/version/client sync; --verify compares current packages to exact source members. The explicit reader whitelist excludes historical acceptance documents, issues, .local and private memo.

Live tests require explicit scope, unique owned fixtures and cleanup. extension/test/live-v01.cjs requires LIVESHARE_RUN_LIVE=1 and changes the Search View. live-sandbox.cjs uses existing local accounts, can initialize ACLs in its owned temporary workspace and sends no Host commands. These scripts are not normal CI tests.

```powershell
$env:LIVESHARE_RUN_SANDBOX = '1'
$env:LIVESHARE_CODEX_EXE = '<absolute-path-to-codex.exe>'
node .\extension\test\live-sandbox.cjs
```

For Host tests use the intended RW shared PowerShell, pin root/epoch and restore leased settings without overwriting concurrent user edits. Disabled terminal access must deny Host work, never fall back to Guest. No implicit stage/commit/push.

Reader docs use four locale variants with matching links/commands/limits. After edits check references and packages. Keep machine receipts, credentials, raw Host paths and investigation narratives out of public docs and artifacts. Generated/local files are ignored; the Windows CI checks/builds without publishing.
