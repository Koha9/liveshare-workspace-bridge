# Usage guide

**English** | [简体中文](USAGE.zh-CN.md) | [繁體中文](USAGE.zh-TW.md) | [日本語](USAGE.ja.md)

[Documentation](README.md)

Agents use the bridge through its MCP server. Setup, the full tool list and result semantics are in the [MCP guide](MCP.md).

1. Install the VSIX in the connected Guest window's Profile.
2. Run **Live Share Workspace Bridge: Copy MCP Server Configuration** and add the server to your agent as described in the [MCP guide](MCP.md). The VS Code built-in agent discovers it without configuration.
3. Have the agent call `lswb_list_workspaces` once and choose the intended root. Every other tool takes that exact root `uri` as its `workspace` argument.
4. Open **Live Share Workspace Bridge: Configure Agent Permissions**. Agent access defaults on; terminal access defaults off. Adjust the English operation switches manually.
5. For Host capabilities, have the Host share a Windows PowerShell terminal in read/write mode. Connect to it in the Guest. Set the exact terminal name when multiple shared terminals exist. An optional explicit Host root can be configured; paths are not guessed.
6. Have the agent call `lswb_host_status` and `lswb_host_bind` in the authorized task. If the terminal is missing, the agent asks once and waits. It never starts work in an ordinary Guest terminal or bypasses settings.

## Text work

Use `lswb_read_file` or `lswb_read_many` and retain versions. Submit related changes as one `lswb_edit_file` request; inspect `applied`, `saved` and each target's `dirty` state. Continue after success without extra full-file verification. Use `lswb_create_file` for new text, `lswb_write_file` for a guarded complete replacement, and `lswb_save_file` to retry a failed save without reapplying text.

Dirty buffers are protected; allowDirty:true must include preserving/saving those existing edits. Normal document EOL reflects Guest state; raw Host bytes are a separate contract.

## Search, commands and patches

`lswb_search` and `lswb_find_files` use Host rg and report completeness, limits and exit codes. No-match exit 1 is valid. Saved-file searches do not cover dirty buffers; no automatic saveAll. Editor snapshots remain explicit limited operations.

`lswb_host_exec` returns a job with bounded output. Poll with `lswb_host_job_poll` using useful waitMs and output cursors, not hot loops; cancel only the owned task tree with `lswb_host_job_cancel`. Report actual exit codes. Raw commands need every operation permission; when permissions are restricted use a narrow allowed tool instead of bypassing the restriction.

`lswb_apply_patch` (patch text) and `lswb_apply_patch_file` (a local patch file) check paths and run Host Git preflight before applying a text patch. checkOnly:true performs the check only. Git configuration controls patch newline behavior. No commit/push is implied.

## Bytes and large files

Use `lswb_read_bytes`/`lswb_write_bytes` for small raw data. `lswb_copy` and `lswb_copy_dir` use the Host, because the Live Share text provider cannot preserve arbitrary binary content. Directory copies need a new destination. Use `lswb_upload_file` for larger files; do not place a whole file into one request. Uploads verify transfer SHA-256. Overwriting an existing byte file requires its current raw hash.

## Errors and controls

The master and terminal switches take effect on requests without restart. They do not undo dispatched work. Disabled permissions are reported, not changed by the agent. Already-sent mutations with uncertain outcomes (`transport_outcome_unknown`) are inspected before retry, never blindly replayed.

Host writes can precede Guest model reload. The bridge verifies affected open buffers against targeted normalized Host hashes; it never globally reverts the editor. If editor_refresh_pending is returned, preserve buffers and use an explicit Host byte read or reopen the document.

The API still rejects recursive deletion and does not guarantee cross-file atomic saves. Detailed fields, limits and recovery are in [API](API.md) and the [MCP guide](MCP.md).

When a task needs an unavailable operation, the agent should request user assistance: identify exact paths and the required manual result, then wait before dependent work. Large downloads require an accessible copy supplied by the user; recursive deletion requires their confirmed removal. Required atomic saves need suitable Host tooling or explicit acceptance of per-file saves. Missing providers and unresolved buffer conflicts also require assistance, without forced reverts or raw-command bypasses.

Large downloads (`transferOpenRead`/`transferRead`) return `feature_unavailable`. Ask the user for an accessible copy and local path; do not bypass the limit with repeated byte reads or raw commands. Small byte reads and large uploads remain available.

## Troubleshooting CLI

`extension/cli.cjs` is for people diagnosing the bridge, not for agents. It supports `instances`, `diagnose` and one pinned raw JSON request (`--instance ID --epoch N --workspace URI [--request FILE]`). See [Troubleshooting](TROUBLESHOOTING.md).
