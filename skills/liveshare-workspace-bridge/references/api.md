# Request reference

Use the selected instance, epoch, and exact root URI through the CLI options described in `SKILL.md`. The JSON file contains the operation body. Paths are workspace-relative; document positions use UTF-16 character offsets.

## Responses and limits

- Success envelope: `{"ok":true,"result":...}`. Check operation-level `applied`, `saved`, and per-file results as well.
- Failure envelope: `{"ok":false,"error":{"code":"...","message":"..."}}`.
- Nonzero CLI exit: request/application/save failure, or partial failure in `readMany`.
- Request limit: 2 MiB. Response limit: 4 MiB. Text returned by one read: 1 MiB.

## Read and inspect

| Operation | Fields | Result / behavior |
|---|---|---|
| `info` | None | Instance, epoch, roots, supported operations, and dirty documents |
| `list` | `path` (empty for root) | Nonrecursive directory entries |
| `read` | `path`; optional `startLine`, `endLine`, `withHash` | Current buffer text, version, dirty state, EOL, and line count |
| `readMany` | `files`: up to 50 read specifications | Per-file success or error |
| `stat` | `path` | Type, size, and timestamps; unavailable values remain `null` |
| `providerRead` | `path` | UTF-8 provider text and byte count; use for explicit verification or diagnosis |

Read line numbers are 1-based and inclusive. `withHash:true` adds a current-text SHA-256, not a raw file-byte hash. No provider reread or hash is required for normal saved edits.

## Edit documents

```json
{"op":"create","path":"src/new.ts","text":"export const value = 1;\n","eol":"LF"}
{"op":"write","path":"config.json","expectedVersion":2,"text":"{}\n"}
{"op":"edit","files":[{"path":"src/main.ts","expectedVersion":4,"changes":[{"oldText":"oldValue","newText":"newValue"}]}]}
{"op":"save","path":"src/main.ts","expectedVersion":5}
```

- `create` refuses existing targets, creates missing parents, and saves the new document. Set `parents:false` when appropriate. EOL is inferred from the first newline, defaults to LF, or can be explicitly `LF` / `CRLF`.
- `write` replaces an existing document and requires `expectedVersion` or `expectedHash`. An empty `text` clears it. Existing EOL is preserved.
- `edit.files` accepts up to 100 distinct documents with up to 1000 changes each. Edits are preflighted together, submitted once, then saved per document.
- `oldText` must be nonempty and unique. Set `all:true` for all non-overlapping matches. All ranges refer to the original document; overlapping edits are rejected.
- A file can include `expectedVersion`, `expectedHash`, or explicit `allowDirty:true`. That last option includes saving existing unsaved content.
- `save` saves the current buffer without reapplying edits and requires its current `expectedVersion`.

For positional edits, use either form:

```json
{"startLine":20,"endLine":23,"expectedText":"original lines","newText":"replacement lines"}
{"range":{"start":{"line":19,"character":0},"end":{"line":20,"character":0}},"newText":"replacement\n"}
```

Line ranges are 1-based and inclusive, excluding the final selected line's trailing separator. Native ranges are 0-based with an exclusive end and UTF-16 character offsets. Positions are rejected rather than clamped. Positional edits need `expectedVersion`, `expectedHash`, or a matching `expectedText`.

Batch results are `{applied,saved,files:[{uri,version,dirty,saved,changes,error?}]}`. Inspect each file after a partial save; use the recovery rules in `SKILL.md`.

## Manage files

```json
{"op":"mkdir","path":"new/nested"}
{"op":"copy","path":"src/main.ts","to":"backup/main.ts"}
{"op":"move","path":"backup/main.ts","to":"backup/renamed.ts"}
{"op":"delete","path":"backup/renamed.ts"}
```

`copy` supports files; `move` supports files and directories. Both refuse overwrite unless `overwrite:true` and create missing parents unless `parents:false`. Dirty source or destination documents are protected. `delete` supports files and empty directories, bypasses the recycle bin, and rejects `recursive:true`.

`mkdir` delegates existing-directory behavior to the provider. Failed file operations can leave newly created parents; they do not promise rollback.

## Search and navigate

```json
{"op":"findFiles","pattern":"src/**/*.ts","limit":100}
{"op":"search","query":"handleRequest","include":"src/**/*.ts","regex":false,"caseSensitive":true}
{"op":"searchResults","searchId":1}
{"op":"symbols","path":"src/main.ts"}
{"op":"workspaceSymbols","query":"Handler"}
{"op":"definition","path":"src/main.ts","line":20,"character":8}
{"op":"diagnostics","path":"src/main.ts"}
```

- `findFiles`: `limit` defaults to 100 and accepts 1..1000; returns `possiblyCapped` and `complete:null`. Excludes apply by default; use `exclude` or `useExcludes:false` when needed. New files may be omitted.
- `search`: one Live Share root only. Options include `include`, `exclude`, `regex`, `caseSensitive`, and `useExcludes` (default true). `waitMs` defaults to 800 and accepts 0..5000; it is a sampling delay, not a completion signal.
- Search returns `search.id`, `snapshot`, `truncated`, `complete:null`, and `correlation:"best_effort"`. `maxCharacters` defaults to 100000, with a maximum of 1000000.
- `searchResults` reads the current view without restarting search. `searchId` can detect another bridge query, but not manual Search View changes.
- `definition` input uses a 1-based line and 0-based UTF-16 character. Returned positions are 0-based and retain full URIs.
- Language results depend on available providers. Empty diagnostics do not establish a successful build or test.

## Connection and component names

`liveshare-workspace-bridge` is the skill name. The VS Code extension is a separate component; its verified identifiers are:

| Component | Identifier |
|---|---|
| VS Code extension ID | `Koha9-Lee.liveshare-workspace-tools` |
| Extension display name | `Live Share Workspace Tools` |
| Restart command ID | `liveshareWorkspace.restart` |
| Command Palette entry | `Live Share Workspace Tools: Restart Connection` |
| Output channel | `Live Share Workspace Tools` |

If `instances` finds no usable workspace, check the Guest connection and the extension's installation in that window's Profile. Restart a stopped service with the command above, or follow VS Code's reload prompt after an update. Inspect the output channel only for an actual startup failure. Then rediscover and confirm the project once.

These checks are conditional recovery, not a setup sequence to repeat before every task. A missing Node executable is a prerequisite issue; use a confirmed installed executable without automatically changing PATH or installing software.
