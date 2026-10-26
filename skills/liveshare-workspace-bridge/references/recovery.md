# Recovery

For a requested step that the bridge cannot perform, explain the limitation and request user assistance with exact paths and the desired result. Wait for their response before dependent work. Keep one unresolved request per step; do not repeat prompts, infer success from silence, or bypass the limit with raw commands or repeated small operations. See the unsupported-operations section in SKILL.md for large downloads, recursive deletion, atomic saves, unavailable language providers and buffer conflicts.

- **host_terminal_required:** Ask the user once to have the Host open/share a RW PowerShell terminal; wait. No Guest terminal, substitute, repeated prompt or polling.
- **host_terminal_selection_required:** Request the exact shared terminal name once; do not try candidates.
- **terminal_access_disabled / agent_access_disabled / operation_disabled:** Identify the setting. Do not enable permissions or change routes yourself.
- **raw_commands_restricted:** Raw commands cannot honor restricted operation permissions. Use a permitted narrow API if it meets the task; otherwise wait for user configuration.
- **host_binding_failed:** Have the user correct the Host root/current directory or helper failure once, then verify after their response. Do not guess paths.
- **host_channel_uncertain / host_outcome_unknown / invalid_host_response:** A sent action may have completed. Inspect affected state and Host terminal; rebind with acknowledgeRecovery:true only once it is confirmed idle. No blind mutation replay.
- **workspace_changed / unavailable instance:** Rediscover the intended project. Reusing vsls:/ alone is insufficient.
- **content_changed / text mismatch:** Refresh only affected content and revise the plan, preserving other edits.
- **saved:false:** Preserve applied buffers; resolve the cause and retry save with its receipt version, not the edit batch.
- **editor_refresh_pending:** Host changed the file but the Guest model has not reloaded. Preserve it; use an explicit Host byte read or reopen the document. No global revert or stale save.
- **external_change_dirty_document:** Preserve the conflicting dirty buffer and resolve the conflict.
- **running job:** Poll with useful waitMs and output cursors; do not repeat hostExec.
- **timed_out/cancelled job:** Inspect bounded output and status. Only owned task processes are terminated.
- **truncated output/search:** Narrow scope or choose an explicit output strategy; do not claim complete results.
- **expired/closed transfer:** Close/abort if available and restart only when safe. A lost commit acknowledgement requires target inspection first.
- **feature_unavailable / not_supported / provider_unavailable:** Ask the user to perform or enable the smallest required manual step. Large downloads need a user-provided accessible copy; recursive deletion needs user-confirmed removal; atomic saves need suitable Host tooling or explicit acceptance of per-file semantics.

Maintain one unresolved Host-terminal request state per task. Independent non-Host work may continue while awaiting the user. Settings changes are not rollback: already-dispatched work can finish or time out. Transfers expire; abrupt Host termination releases owned handles. A failed directory copy can leave a partial new destination, and recursive deletion is not an automatic cleanup feature.
