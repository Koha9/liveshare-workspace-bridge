# Repository guidance

This repository maintains the Windows VS Code extension and its MCP server.

- Runtime code lives in `extension/`.
- The MCP server (`extension/mcp-server.cjs` + `extension/mcp-tools.cjs`) is the only agent interface. Do not add a skill or another agent client.
- `extension/cli.cjs` is a troubleshooting tool for people (`instances`, `diagnose`, pinned raw requests) and the transport library the MCP server uses. Keep the exports `mcp-tools.cjs` and `startup-diagnostics.cjs` require; do not add agent workflows to the CLI.
- Preserve `vsls:` URI schemes and workspace/instance/epoch binding. Never route virtual paths through Node filesystem APIs.
- Preserve the difference between apply success, per-document save results, and unknown transport outcomes. Do not automatically replay a sent mutation.
- Normal edits save only their targets. Do not add default provider rereads, full-document hashes, saveAll, or directory scans as routine confirmation.
- Native search is explicitly incomplete in v0.1. Keep snapshot and new-file indexing limitations visible; do not replace it with workspace-wide per-file scans.
- Run `npm test`, `npm run check`, and the build checks after relevant changes. Runtime code has no npm dependencies and must stay that way; tests may use devDependencies declared in `extension/package.json` (run `npm ci` inside `extension/` once before `npm test` when a lockfile exists).
- `extension/test/live-v01.cjs` changes an actual Live Share workspace. It is opt-in and is not part of normal tests or CI. Run only within an authorized live-workspace test scope; preserve cleanup evidence locally.
- Use a confirmed Python executable for `scripts/build.py`. On the original Windows machine, use the Anaconda interpreter rather than the WindowsApps placeholder.
- Generated packages belong in ignored `dist/`; machine-specific receipts belong in ignored `.local/`. Keep credentials, user profiles, raw Host paths and unrelated upstream repositories out of commits.
- Repository organization does not by itself authorize installing extensions, changing user settings, making commits, or publishing. Follow the current user's task scope.
- Write readable multi-line code: one statement per line, functions that fit on one screen, named helpers instead of inline chains. Do not add dense single-line code. When you touch an existing dense file for another reason, reformat only the parts you change.
