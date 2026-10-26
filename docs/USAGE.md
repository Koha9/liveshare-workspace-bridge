# Usage guide v0.2

**English** | [简体中文](USAGE.zh-CN.md) | [繁體中文](USAGE.zh-TW.md) | [日本語](USAGE.ja.md)

[Documentation](README.md)

1. Install the VSIX in the connected Guest window's Profile and install the matching skill.
2. Discover once, choose the intended root, and pin instance/epoch/workspace on subsequent requests.
3. Open **Live Share Workspace Bridge: Configure Agent Permissions**. Agent access defaults on; terminal access defaults off. Adjust the English operation switches manually.
4. For Host capabilities, have the Host share a Windows PowerShell terminal in read/write mode. Connect to it in the Guest. Set the exact terminal name when multiple shared terminals exist. An optional explicit Host root can be configured; paths are not guessed.
5. Run hostStatus and hostBind in the authorized task. If the terminal is missing, Codex asks once and waits. It never starts work in an ordinary Guest terminal or bypasses settings.

## Text work

Use read/readMany and retain versions. Submit related changes as one edit request; inspect applied, saved and each target's dirty state. Continue after success without extra full-file verification. Create for new text, guarded write for a complete replacement, and save for retrying a failed save without reapplying text.

Dirty buffers are protected; allowDirty:true must include preserving/saving those existing edits. Normal document EOL reflects Guest state; raw Host bytes are a separate contract.

## Search, commands and patches

search and findFiles use Host rg and report completeness, limits and exit codes. No-match exit 1 is valid. Saved-file searches do not cover dirty buffers; no automatic saveAll. Editor snapshots remain explicit limited operations.

hostExec returns a job with bounded output. Poll with useful waitMs and output cursors, not hot loops; cancel only the owned task tree. Report actual exit codes. Raw commands need every operation permission; when permissions are restricted use a narrow allowed API instead of bypassing the restriction.

applyPatch checks paths and runs Host Git preflight before applying a text patch. checkOnly:true performs the check only. Git configuration controls patch newline behavior. No commit/push is implied.

## Bytes and large files

Use readBytes/writeBytes for small raw data. Copies use the Host, because the Live Share text provider cannot preserve arbitrary binary content. Directory copies need a new destination. Use CLI upload for larger files; do not place a whole file into one JSON request. Uploads verify transfer SHA-256. Overwriting an existing byte file requires its current raw hash.

## Errors and controls

The master and terminal switches take effect on requests without restart. They do not undo dispatched work. Disabled permissions are reported, not changed by the agent. Already-sent mutations with uncertain outcomes are inspected before retry, never blindly replayed.

Host writes can precede Guest model reload. The bridge verifies affected open buffers against targeted normalized Host hashes; it never globally reverts the editor. If editor_refresh_pending is returned, preserve buffers and use an explicit Host byte read or reopen the document.

The API still rejects recursive deletion and does not guarantee cross-file atomic saves. Detailed fields, limits and recovery are in [API](API.md) and the bundled skill.

When a task needs an unavailable operation, the skill requests user assistance: it identifies exact paths and the required manual result, then waits before dependent work. Large downloads require an accessible copy supplied by the user; recursive deletion requires their confirmed removal. Required atomic saves need suitable Host tooling or explicit acceptance of per-file saves. Missing providers and unresolved buffer conflicts also require assistance, without forced reverts or raw-command bypasses.

Large downloads (`transferOpenRead`/`transferRead`, including CLI download) return `feature_unavailable` before sending Host commands in v0.2. A 1.1 MB live download repeatedly stalled the shared terminal; it is deferred pending a reliable output transport. Do not bypass this by looping small byte reads. Small bounded byte reads and large uploads remain available.
