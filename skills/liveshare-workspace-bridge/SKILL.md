---
name: liveshare-workspace-bridge
description: "Read, edit, search, and save a Windows VS Code Live Share Guest workspace through Live Share Workspace Bridge. Diagnose local IPC access and use its verified Host RW PowerShell channel for saved-file search, commands, patches, bytes, and large uploads."
metadata:
  version: "0.2.2"
---

# Live Share Workspace Bridge

Use this skill's `scripts/liveshare.cjs` with extension v0.2.2. The local connection is a Windows named pipe, owner-only by default with explicit local-account access modes available; no HTTP port or token is required. Host access is optional and controlled by the user's extension settings.

## Connect once

Run from a usable local directory using a confirmed Node executable:

```powershell
node "<skill-dir>/scripts/liveshare.cjs" instances
node "<skill-dir>/scripts/liveshare.cjs" --instance "<id>" --epoch "<epoch>" --workspace "vsls:/" --request "<local-request.json>"
```

Match the intended project by root name and complete URI; retain its ID, epoch and root. Reuse that selection rather than rediscovering or listing the root every time. Shared paths are workspace-relative with forward slashes; local shell/rg/apply_patch cannot operate on `vsls:`.

Inspect version and effective permissions. A v0.1 extension does not provide the v0.2 Host APIs. Permission changes take effect without restart. Identify disabled settings and wait for the user to enable them; never edit permission settings or switch routes to bypass a denied operation.

## Diagnose local discovery before changing the connection

With v0.2.2, use `node "<skill-dir>/scripts/liveshare.cjs" diagnose` if discovery fails, returns no intended root, or reports EPERM/EACCES. This is read-only: registry inspection and info requests only, with no Host binding, terminal command or shared-file write. Inspect registry status, probes, transportCode and requestSent. Only no_records is verified absence of records; access_denied, stale/unreachable probes and no_shared_workspace have different remedies. Do not tell the user to enable/reinstall an already-running extension solely because discovery did not return the project.

Legacy Windows Codex sandboxes can use another local Windows identity. For EPERM/EACCES, inspect ipc.mode, allowedUsers and selectionIssues from diagnostics/info and ask the user once to review **Configure IPC Access**. ownerOnly is the release default; selectedUsers saves machine-local SIDs and is the narrow option for named accounts. allLocalUsers trusts all current local SAM users and must never be an automatic repair. Both additional-user modes reject remote/domain users and require the same Windows session; the owner is always retained. Trust applies to every process of allowed accounts, outside Codex filesystem sandbox limits, subject to bridge permissions. If terminal access is enabled and Host requirements are met, it may also permit Host commands. Never enable Host access as part of IPC setup.

The account picker shows names but persists ipc.selectedUserSids. Renaming preserves the SID; deleted/recreated or foreign/invalid identities are not substituted. Ask the user to resolve unavailable selections. An enabled legacy boolean with no new mode migrates once to selectedUsers and pins only existing legacy account SIDs; it never migrates to allLocalUsers. Do not infer a historical SID from a boolean if the account was already deleted/recreated. Old running versions do not honor the new modes until updated/reloaded.

User setting changes/migration restart the bridge and change its instance/epoch. Explain the effect and obtain any required deployment approval before installing/reloading an active environment. Wait for the user's confirmation, rediscover once and bind the intended root. Unknown sent mutations still require inspection before retry. Never automatically widen ACLs, disable sandboxing, select allLocalUsers or use an unapproved route. Computer Use helper setup failures are separate from bridge IPC failures.

## Missing Host RW terminal: ask once and wait

**On `host_terminal_required`, immediately ask the user once, in their language, to have the Host open and share a read/write PowerShell terminal and connect to it from this Guest window. Stop dependent Host work and wait for their response.** Keep an unresolved-request flag for the task; do not repeat the question or poll while waiting.

- Never create an ordinary Guest terminal, select a substitute by guess, or silently use another execution channel.
- Multiple eligible shared terminals require one request for the exact intended name, not trying candidates.
- After the user confirms setup changed, verify `hostStatus`/`hostBind` once. If still unavailable, report the verification failure and keep waiting without another request/retry loop.
- If the user has restarted the terminal after an uncertain outcome, `hostStatus.uncertain` may require `hostBind` with acknowledgeRecovery:true. Use that acknowledgement only after the user confirms it is idle/restarted.
- Disabled terminal access is different from a missing terminal. Request the manual setting change when needed; do not ask the Host to open another terminal for a permission denial.
- Independent non-Host work, such as reading known files, may continue.

`hostBind` verifies the selected shared root using an owned random bootstrap file and loads an in-memory helper in the shared PowerShell. A local terminal with Shell Integration does not prove Host access.

## Unsupported operations: request user assistance

When a requested operation is unavailable, explain the specific limit in the user's language and ask them to help complete that step. Include the exact shared-relative path(s), intended result, and the confirmation or accessible local path needed to continue. Ask once per unresolved step and wait for their response before dependent work; independent supported work may continue. Do not treat a missing reply as completion or abandon the requested step silently.

- **Large download / feature_unavailable:** Ask the user to copy or export the requested Host file to a location accessible to Codex and provide its local path. Do not loop readBytes, use the lossy provider for binary data, start another transport, or run a raw command to bypass the unavailable download.
- **Recursive deletion:** Ask the user to remove the exact intended directory and confirm completion. Do not emulate recursive deletion through repeated file deletes or a raw Host command.
- **Cross-file all-or-nothing saves:** Explain that the bridge provides per-document saves. Ask the user to perform the transaction with suitable Host tooling, or explicitly accept per-file partial-save semantics before proceeding. Do not describe a batch edit as an atomic disk transaction.
- **Missing language provider or unresolved Guest/Host buffer conflict:** Ask the user to enable the needed provider or resolve/reopen the affected document while preserving unsaved work. Wait for their result; do not force a global revert or save stale content.
- For another not_supported/provider_unavailable result, request the smallest concrete manual step that achieves the user's intended outcome. Permission denials use the manual settings flow above; missing Host terminals use the ask-once setup flow.

After the user reports completion, use their provided path/result and only the targeted verification needed for the next step. Retain partial-save and unknown-outcome receipts. Report user-assisted completion separately from operations performed by the bridge.

## Daily text work

Read applicable instructions and relevant ranges using `read`/`readMany`; retain returned text and versions. Prefer one `edit` for related changes. Use unique `oldText` and expectedVersion when available; positions refer to original content. Use `all:true` only intentionally.

```json
{"op":"read","path":"src/main.ts","startLine":1,"endLine":80}
{"op":"edit","files":[{"path":"src/main.ts","expectedVersion":4,"changes":[{"oldText":"return oldValue;","newText":"return newValue;"}]}]}
```

After applied:true, saved:true and target dirty:false, continue without default provider rereads, hashes or Host confirmation. `create` makes new text files; guarded `write` replaces existing documents. Partial responses do not imply streaming provider reads. Guest EOL/text state is not independent proof of Host raw bytes.

Dirty buffers are protected. `allowDirty:true` is only for tasks including preserving and saving existing unsaved content. Batch saves are per-document, not a cross-file disk transaction. Resolve save failures and retry `save` with the receipt version rather than reapplying the batch.

Use mkdir, move and file/empty-directory delete as authorized. Recursive deletion is unavailable. Pass parents:false when parents are already known; do not issue an extra stat merely to decide this.

## Select capabilities

- `search`/`findFiles`: Host ripgrep. Inspect completeness, truncation and exit state; completed no-match uses exit code 1. Results cover saved Host files. Never saveAll to make search complete.
- `searchSnapshot`/`searchResults`/`findFilesSnapshot`: explicitly limited editor/provider queries. They are not automatic substitutes for missing Host access and cannot prove exhaustive absence.
- Language work: symbols, workspaceSymbols, definition, references, renameSymbol and format. Renames apply text edits only; provider file-operation edits are not applied. Missing providers are reported, not interpreted as a successful empty refactor.
- `copy`/`copyDirectory`: Host byte-preserving copies. Directory copies require a new destination. Do not use the Live Share text provider as a binary channel.
- `hostExec`: authorized Host child commands. Raw commands require all operation permissions to avoid bypassing disabled file operations. Declare affectedPaths for known file mutations; arbitrary effects are otherwise untracked. For running jobs, use hostJobPoll with useful waitMs and returned output cursors; no hot-polling or command replay. Cancel affects only the owned process tree.
- `applyPatch`: checked Host Git text patches. checkOnly:true previews applicability. No stage, commit or push is implied.
- `readBytes`/`writeBytes`: byte-exact Host data. Existing overwrite needs a raw expectedCurrentSha256; document text hashes are different. Use hostStat withHash:true only when that guard is needed.
- Large files: CLI `upload --input LOCAL --path SHARED`, with the same binding arguments. Chunks and SHA-256 are handled by the client; do not encode an entire large file into one JSON request.

Read [API](references/api.md) for fields and [recovery](references/recovery.md) for errors. Report actual saves, Host exit status and limitations affecting the task. Empty diagnostics do not prove tests passed. Keep commands within user scope and default to no stage/commit/push unless requested. Keep the working bridge available afterward.

Large downloads (`transferOpenRead`/`transferRead`, including CLI download) return `feature_unavailable` before sending Host commands in v0.2. A 1.1 MB live download repeatedly stalled the shared terminal; it is deferred pending a reliable output transport. Do not bypass this by looping small byte reads. Small bounded byte reads and large uploads remain available.
