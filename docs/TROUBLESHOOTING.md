# Troubleshooting

**English** | [简体中文](TROUBLESHOOTING.zh-CN.md) | [繁體中文](TROUBLESHOOTING.zh-TW.md) | [日本語](TROUBLESHOOTING.ja.md)

[Documentation](README.md) | [API](API.md)

## Connection and permissions

Install the extension in the Live Share Guest window's Profile. After an update reload that window, reconnect to the intended session, and run CLI instances. Choose the project by root name and complete vsls URI, then retain instance/epoch/workspace. A binding error after reload requires rediscovery. The extension Output channel reports pipe startup errors.

Open **Live Share Workspace Bridge: Configure Agent Permissions**. Agent access defaults on; Host access (`host.enabled`) defaults off. Inspect configured and effective permissions. The user controls these settings; agents must not enable them to bypass a denial. Permission changes block new work, without undoing dispatched effects.

## Runtime disconnects and recovery

Version 0.2.4 fixes broken-pipe cleanup: after a client timeout, a failed late reply could make IsConnected false, skipping Disconnect and leaving the listener spinning. Writer cleanup errors are contained, broken connections are disconnected, and listener failures exit instead of spinning. A real Windows pipe test covers this; loss of window focus has not been established as the cause.

A previously ready IPC helper that exits is restarted after 1/2/4 seconds, at most three unstable restarts; one minute of ready runtime resets the budget. No focus event or Host polling is required. Startup/policy/access failures and an explicit Stop do not auto-restart. Transport recovery retains instance/epoch, Host jobs and uncertainty, serializes in-flight work and never replays sent operations.

If still disconnected, run diagnose once. For task-authorized recovery the agent may invoke **Live Share Workspace Bridge: Restart Connection** (`liveshareWorkspaceBridge.restart`) in the intended Guest window through the Command Palette: Ctrl+Shift+P, or Ctrl+P then `>`. Without a supported UI tool, ask the user once. Manual restart changes instance/epoch and invalidates Host job/transfer handles; rediscover once by root name and full URI. Host uncertainty remains: confirm Host recovery before acknowledgement. Do not bypass denied access, policy failures or an intentional Stop, or replay unknown mutations. IPC recovery does not rejoin Live Share or repair a missing Host terminal.

## Missing or unresponsive Host terminal

Host features require one connected shared Windows PowerShell terminal with read/write access; it starts the Host helper once, and the Host then shares the helper port with "Live Share: Share Server". Ordinary Guest terminals are excluded. If absent, the agent asks the user once for Host setup and waits. Multiple candidates need the exact configured name. No repeated prompts, guessed terminals, or alternate execution routes.

Binding verifies the shared root using an owned temporary bootstrap file. While `lswb_host_status` shows `handshake.state: "waitingForward"`, ask the Host to share the shown port and poll status; other Host tools return `host_handshake_pending`. If the handshake failed or was cancelled, ask the Host to press Ctrl+C on any previous helper before binding again. A sent mutation whose outcome is unknown quarantines the channel; do not replay mutations. Preserve the receipt, inspect affected targets, and wait until the user confirms the Host is idle or the helper restarted before explicit acknowledgeRecovery binding. Timeout details contain counters, not captured file contents.

## Editing and Host changes

Use current document versions for guarded edits. Dirty buffers are protected; include them only when preserving/saving their content is in scope. After an applied edit with a failed target save, retry save with its returned version instead of reapplying text. Batch saves are per-file, not transactional.

Host writes can leave an existing Guest buffer stale or dirty. editor_refresh_pending/external_change_dirty_document preserve it instead of globally reverting user editors. Resolve the affected buffer with the user or reopen it safely; an explicit hostStat withTextHash refreshes the expected normalized digest, not the editor itself. Guest text/EOL is distinct from Host raw bytes. Host Git configuration can convert patch output to CRLF.

## Search and language tools

Host rg searches saved files; complete is false on limits/failures, and no-match exit 1 is normal. Dirty buffers are listed separately and never auto-saved. Snapshot queries remain explicitly incomplete. Language operations need providers; unavailable providers are errors, and empty diagnostics do not prove a build or test passed.

## File operations and limits

Byte overwrite needs the current raw Host SHA-256. Directory copy requires a new destination and can partially fail. Recursive deletion and cross-file atomic saves are not implemented. For response_limit, request relevant ranges/fewer results. Provider partial text responses do not establish streaming reads.

Large downloads (`transferOpenRead`/`transferRead`) return `feature_unavailable`. Ask the user for an accessible copy and local path; do not bypass the limit with repeated byte reads or raw commands. Small byte reads and large uploads remain available.
