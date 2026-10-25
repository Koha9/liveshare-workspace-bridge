---
name: liveshare-workspace-bridge
description: "Read, edit, and save files in a Windows VS Code Live Share Guest workspace through Live Share Workspace Tools. Use for shared-project tasks involving vsls: URIs, multi-file edits, file operations, or native editor search."
metadata:
  version: "0.1.1"
---

# Live Share Workspace Bridge

Requires Windows, Node.js, and Live Share Workspace Tools in the connected VS Code Guest window. Operate the shared project through the bundled `scripts/liveshare.cjs` client, which uses a current-user Windows named pipe; no HTTP endpoint, MCP configuration, or access token is needed.

## Select the workspace once

Resolve the client path relative to this skill's directory. Run Node from a usable local directory, not a virtual workspace path.

```powershell
node "<skill-dir>/scripts/liveshare.cjs" instances
```

Match the intended project using `roots[].name` and its complete `roots[].uri`. Keep the selected `id`, `epoch`, and root URI for subsequent requests. With multiple windows, choose explicitly. Reuse an already verified selection instead of rediscovering, listing the root, or checking health on every operation.

Write a UTF-8 JSON request to a local file and send it with the pinned selection:

```powershell
node "<skill-dir>/scripts/liveshare.cjs" --instance "<id>" --epoch "<epoch>" --workspace "vsls:/" --request "<local-request.json>"
```

All shared-file paths are relative to that root and use forward slashes. Keep `vsls:` access inside the bridge; local filesystem tools cannot operate on those URIs.

## Read, edit, and save

1. Read applicable project instructions and relevant text with `read` or `readMany`. Prefer useful ranges for large files. Keep the returned text and `version`; a small response does not imply streaming provider access.
2. Prefer one `edit` request for related changes across files. Use unique `oldText` matches and include `expectedVersion` when available. All changes in a file refer to its original content. Use `all:true` only when every occurrence should change.
3. Inspect `applied`, `saved`, and each target's `dirty` state. After a successful save, continue without automatic provider rereads, full-text hashes, repeated reads, or Host confirmation.

```json
{"op":"read","path":"src/main.ts","startLine":1,"endLine":80}
{"op":"edit","files":[{"path":"src/main.ts","expectedVersion":4,"changes":[{"oldText":"return oldValue;","newText":"return newValue;"}]}]}
```

Use `create` for new files and guarded `write` for complete replacements. Use `mkdir`, file `copy`, file/directory `move`, and file/empty-directory `delete` as the task requires. Overwrite is off by default. If a parent is already known to exist, pass `parents:false` rather than issuing another directory check or creation.

Dirty documents are protected by default. Set `allowDirty:true` only when the task includes saving their existing unsaved content; preserve that content. Batch saves are not a cross-file disk transaction.

Read [references/api.md](references/api.md) when you need operation fields, line/range semantics, file-management options, language queries, or request limits.

## Search without extra scanning

- Use `search` with a relevant `include` scope. It returns a Search View snapshot and changes that view. `complete:null` means completeness is unknown; repeated or stable snapshots do not prove completion.
- Use `searchResults` only when another snapshot is useful, not as a default polling loop. Use `findFiles` for path discovery, but read a known path directly: new files can be missing from its results.
- Do not emulate global search by traversing the workspace and reading every file. Use `symbols`, `workspaceSymbols`, or `definition` when a language-aware query fits the task.

## Recover from the actual failure

- On a version or text mismatch, refresh only the affected content and revise the edit.
- If text was applied but `saved:false`, preserve the buffer and retry `save` with its returned version after resolving the cause; do not reapply the batch.
- If a request timed out or disconnected after `requestSent:true`, its outcome is unknown. Inspect the affected state before retrying a mutation.
- Rediscover after an unavailable instance or changed workspace binding. The same `vsls:/` string can refer to a different project after reconnection.

For connection failures, read [Connection and component names](references/api.md#connection-and-component-names). Use the rules above for edit, save, and transport failures.

This bridge does not supply a Host shell, remote build/Git execution, recursive deletion, directory copying, binary writes, or unified-diff parsing. Do not treat a Guest terminal or local test as Host execution. Report saved changes and any limitation that affects the requested outcome; keep a working connection available for later tasks.
