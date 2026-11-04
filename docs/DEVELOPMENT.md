# Development

**English** | [简体中文](DEVELOPMENT.zh-CN.md) | [繁體中文](DEVELOPMENT.zh-TW.md) | [日本語](DEVELOPMENT.ja.md)

[Documentation](README.md)

Windows, Node.js and confirmed Python 3 are required. Runtime uses built-in modules, Windows PowerShell and the bundled C# sources, with no npm dependencies; packaging uses Python standard library only. Tests use the devDependencies declared in `extension/package.json` (the MCP SDK interop test): run `npm ci` inside `extension/` once before `npm test`.

```text
extension/                         Runtime, CLI and tests
scripts/build.py                   Packaging and source checks
docs/                              Current product/contributor guides
dist/                              Ignored generated packages
.local/                            Ignored local working files
```

The MCP server (extension/mcp-server.cjs and mcp-tools.cjs) is the only agent interface. extension/cli.cjs is a troubleshooting CLI and the local transport library the MCP server uses; keep the exports mcp-tools.cjs relies on. Keep versions, API fields and translations aligned.

```powershell
npm test
npm run check
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py
& $pythonExe .\scripts\build.py --check
& $pythonExe .\scripts\build.py --verify
```

Packaging shortcuts at the repository root: `./build.ps1` or `build.bat` on Windows; `sh ./build.sh` on Unix or Git Bash. With no arguments they build and verify the VSIX and its SHA-256 file in `dist/`; `--check`, `--verify` and `--help` are forwarded to `scripts/build.py`. Set `LSWB_PYTHON` to a full Python 3 executable path when needed. Windows detects active Conda, user Anaconda or the Python Launcher; Unix uses active Conda or Python 3. These entrypoints also work from another current directory.

Normal tests cover document/save/permission/IPC contracts without changing a connected project. A passing local suite is not proof that every Host, account, policy, remote session or language provider works.

The build creates the VSIX and its SHA-256 file. --check validates layout and versions; --verify compares current packages to exact source members. The explicit reader whitelist excludes historical acceptance documents, issues, .local and private memo.

Live tests require explicit scope, unique owned fixtures and cleanup. extension/test/live-v01.cjs requires LIVESHARE_RUN_LIVE=1 and changes the Search View. live-sandbox.cjs uses existing local accounts, can initialize ACLs in its owned temporary workspace and sends no Host commands; it uses a Codex executable as the sandboxed client (`LIVESHARE_CODEX_EXE`). These scripts are not normal CI tests.

```powershell
$env:LIVESHARE_RUN_SANDBOX = '1'
$env:LIVESHARE_CODEX_EXE = '<absolute-path-to-codex.exe>'
node .\extension\test\live-sandbox.cjs
```

For Host tests use the intended RW shared PowerShell, pin root/epoch and restore leased settings without overwriting concurrent user edits. Disabled Host access (`host.enabled`) must deny Host work, never fall back to Guest. No implicit stage/commit/push.

Reader docs use four locale variants with matching links/commands/limits. After edits check references and packages. Keep machine receipts, credentials, raw Host paths and investigation narratives out of public docs and artifacts. Generated/local files are ignored; the Windows CI checks/builds without publishing.

## Marketplace publishing

`publish-marketplace.yml` publishes stable releases using GitHub Actions OIDC and `@vscode/vsce` 4.1.0; no PAT secret is needed. In the Marketplace publisher `Koha9-Lee`, create a Trusted Publishing policy for owner `Koha9`, repository `liveshare-workspace-bridge`, workflow `publish-marketplace.yml`, with Environment empty. See the [official setup](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing).

Publishing a stable GitHub Release triggers the workflow. To publish an already-created release, run **Publish Marketplace** from the Actions tab on `main` and enter its existing tag, such as `v0.3.0`. It checks out that tag, checks its package version, runs tests and package checks, then builds/verifies and publishes the VSIX. Only this job grants `id-token: write`. A failed token exchange does not fall back to PAT authentication. Check the run and public Marketplace version before retrying a failed publish; do not change an existing version's tag to replace its contents.
