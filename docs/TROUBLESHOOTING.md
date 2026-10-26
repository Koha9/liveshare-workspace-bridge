# Troubleshooting v0.2

**English** | [简体中文](TROUBLESHOOTING.zh-CN.md) | [繁體中文](TROUBLESHOOTING.zh-TW.md) | [日本語](TROUBLESHOOTING.ja.md)

v0.2.2: **Configure IPC Access** provides ownerOnly (default), allLocalUsers and selectedUsers with stable local SIDs. Legacy true migrates only to the existing selected accounts, never all users. See [IPC access modes](IPC-SECURITY.md). Host permissions remain independent.

[Documentation](README.md) | [API](API.md)

## Connection and permissions

Install the extension in the Live Share Guest window's Profile. After an update reload that window, reconnect to the intended session, and run CLI instances. Choose the project by root name and complete vsls URI, then retain instance/epoch/workspace. A binding error after reload requires rediscovery. The extension Output channel reports pipe startup errors.

Open **Live Share Workspace Bridge: Configure Agent Permissions**. Agent access defaults on; shared terminal access defaults off. Inspect configured and effective permissions. The user controls these settings; agents must not enable them to bypass a denial. Permission changes block new work, without undoing dispatched effects.

## Missing or unresponsive Host terminal

Host features require one connected shared Windows PowerShell terminal with read/write access. Ordinary Guest terminals are excluded. If absent, the skill asks the user once for Host setup and waits. Multiple candidates need the exact configured name. No repeated prompts, guessed terminals, or alternate execution routes.

Binding verifies the shared root using an owned temporary bootstrap file. A sent request that times out quarantines the channel; do not replay mutations. Preserve the receipt, inspect affected targets, and wait until the user confirms the terminal is idle or restarted before explicit acknowledgeRecovery binding. Timeout details contain counters, not captured file contents.

Large downloads are disabled in this release after real shared-terminal stalls. Do not simulate them with repeated byte reads. Large uploads and bounded byte APIs passed live validation. Output pacing is included, but has not been validated as a fix for sustained large downloads.

## Editing and Host changes

Use current document versions for guarded edits. Dirty buffers are protected; include them only when preserving/saving their content is in scope. After an applied edit with a failed target save, retry save with its returned version instead of reapplying text. Batch saves are per-file, not transactional.

Host writes can leave an existing Guest buffer stale or dirty. editor_refresh_pending/external_change_dirty_document preserve it instead of globally reverting user editors. Resolve the affected buffer with the user or reopen it safely; an explicit hostStat withTextHash refreshes the expected normalized digest, not the editor itself. Guest text/EOL is distinct from Host raw bytes. Host Git configuration can convert patch output to CRLF.

## Search and language tools

Host rg searches saved files; complete is false on limits/failures, and no-match exit 1 is normal. Dirty buffers are listed separately and never auto-saved. Snapshot queries remain explicitly incomplete. Language operations need providers; unavailable providers are errors, and empty diagnostics do not prove a build or test passed.

## File operations and limits

Byte overwrite needs the current raw Host SHA-256. Directory copy requires a new destination and can partially fail. Recursive deletion and cross-file atomic saves are not implemented. For response_limit, request relevant ranges/fewer results. Provider partial text responses do not establish streaming reads.
