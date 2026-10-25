# API reference

**English** | [简体中文](API.zh-CN.md) | [繁體中文](API.zh-TW.md) | [日本語](API.ja.md)

[Documentation](README.md)

## Protocol

Requests are JSON objects. Shared fields `instance`, `epoch`, and `workspace` can be supplied through the corresponding CLI options. Take their values from `instances`; paths are relative to the selected root and use forward slashes.

- Maximum request: 2 MiB.
- Maximum response: 4 MiB.
- Maximum text returned by one read: 1 MiB.

Responses use `{"ok":true,"result":...}` or `{"ok":false,"error":{"code":"...","message":"..."}}`. A successful response envelope does not replace checking `applied`, `saved`, and per-file results. The CLI exits nonzero for failed application, failed saves, or partial read errors.

## Reads and edits

```json
{"op":"info"}
{"op":"list","path":"src"}
{"op":"read","path":"src/main.ts","startLine":20,"endLine":100}
{"op":"readMany","files":[{"path":"src/main.ts","startLine":20,"endLine":100},{"path":"package.json"}]}
{"op":"edit","files":[{"path":"src/main.ts","expectedVersion":4,"changes":[{"oldText":"return oldValue;","newText":"return newValue;"}]}]}
{"op":"edit","files":[{"path":"src/main.ts","expectedVersion":4,"changes":[{"startLine":20,"endLine":23,"newText":"replacement lines"}]}]}
{"op":"write","path":"config.json","expectedVersion":2,"text":"{}\n"}
{"op":"create","path":"src/new/module.ts","text":"export const value = 1;\n","eol":"LF"}
{"op":"save","path":"src/main.ts","expectedVersion":5}
```

`read` returns buffer text, `version`, `dirty`, `eol`, and `lineCount`. Line numbers are 1-based and inclusive. Optional `withHash:true` adds a SHA-256 of the current text, not a hash of raw file bytes. Partial output does not imply streaming access to the underlying provider.

`edit.files` accepts up to 100 distinct documents, each with up to 1000 changes. All positions refer to the original document; edits cannot overlap. Literal `oldText` must be nonempty and unique; `all:true` replaces all non-overlapping occurrences.

Line edits select the specified inclusive lines, excluding the final selected line's trailing separator. Optional `expectedText` checks the selected content. Native ranges use `range:{start:{line,character},end:{line,character}}`: lines are 0-based, the end is exclusive, and character offsets use UTF-16. Out-of-range positions are rejected. Position edits require `expectedVersion`, `expectedHash`, or `expectedText`.

`write` replaces an existing document and requires `expectedVersion` or `expectedHash`. Use `create` for a missing file. Creation and editing save their target documents. Existing files retain their EOL; creation infers the first newline, defaults to LF without one, or accepts explicit `LF` / `CRLF`.

`edit` returns `{applied,saved,files:[{uri,version,dirty,saved,changes,error?}]}`. One workspace edit is followed by per-file saves; failures do not trigger rollback or replay. `save` requires the current `expectedVersion`. Use `allowDirty:true` only to explicitly include existing unsaved content.

## File operations

```json
{"op":"mkdir","path":"new/nested"}
{"op":"stat","path":"src/main.ts"}
{"op":"copy","path":"src/main.ts","to":"backup/main.ts"}
{"op":"move","path":"backup/main.ts","to":"backup/renamed.ts"}
{"op":"delete","path":"backup/renamed.ts"}
```

Create, copy, and move create missing parents unless `parents:false`. Copy and move refuse to overwrite unless `overwrite:true`. Copy supports files; move supports files and directories. Delete supports files and empty directories, bypasses the recycle bin, and rejects `recursive:true`. Dirty source or destination documents block these operations.

`mkdir` delegates directly to the provider, including existing-directory behavior. Unknown `stat` sizes or timestamps remain `null`. A failed operation may have created parent directories; file operations are not rollback transactions.

## Search and code navigation

```json
{"op":"findFiles","pattern":"src/**/*.ts","limit":100}
{"op":"search","query":"handleRequest","include":"src/**/*.ts","regex":false,"caseSensitive":true,"waitMs":800}
{"op":"searchResults","searchId":1}
{"op":"diagnostics","path":"src/main.ts"}
{"op":"symbols","path":"src/main.ts"}
{"op":"workspaceSymbols","query":"Handler"}
{"op":"definition","path":"src/main.ts","line":20,"character":8}
```

`findFiles` returns up to 1000 results with `possiblyCapped` and `complete:null`. It respects excludes by default; use `exclude` or `useExcludes:false` when appropriate. New files may be omitted.

`search` requires one Live Share root and uses Search View. Options include `include`, `exclude`, `regex`, `caseSensitive`, and `useExcludes` (default true). `waitMs` is 0–5000, default 800; it controls sampling delay, not completion. Results contain `search.id`, `snapshot`, `truncated`, `complete:null`, and `correlation:"best_effort"`. `maxCharacters` defaults to 100000 and is capped at 1000000.

`searchResults` does not launch another search. Optional `searchId` detects another query started through this bridge; manual Search View changes cannot be detected.

`definition` takes a 1-based line and 0-based UTF-16 character offset. Returned locations preserve URI schemes and use native 0-based positions. Empty language results do not indicate a successful build.

`providerRead` returns provider UTF-8 text and byte count for troubleshooting or explicit verification. It is not part of normal successful writes.

## Errors

| Code / result | Meaning |
|---|---|
| `instance_mismatch`, `workspace_changed` | Rediscover and confirm the intended workspace. |
| `content_changed` | Refresh the affected text or version before editing. |
| `text_not_found`, `ambiguous_match` | Adjust the literal match or its scope. |
| `dirty_document` | Existing unsaved content is protected. |
| `saved:false` | Applied text may remain in the editor; retry the save rather than the edit. |
| `transport_outcome_unknown`, `requestSent:true` | Inspect affected state before retrying a mutation. |
