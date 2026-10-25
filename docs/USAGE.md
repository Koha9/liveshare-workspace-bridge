# Usage guide

**English** | [简体中文](USAGE.zh-CN.md) | [繁體中文](USAGE.zh-TW.md) | [日本語](USAGE.ja.md)

[Documentation](README.md)

## Install

Build the packages with a confirmed Python 3 executable:

```powershell
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py
```

Install the VSIX from `dist/` in the Profile used by the Live Share Guest window. Copy `skills/liveshare-workspace-bridge/` to your Codex skills directory. Reload VS Code when prompted and connect the Guest window to the shared project.

## Select a workspace

```powershell
node .\extension\cli.cjs instances
```

Choose the entry whose `roots[].name` and complete `roots[].uri` match the intended project. Keep its `id`, `epoch`, and root URI. If several windows are available, select one explicitly rather than relying on the current editor focus.

```powershell
node .\extension\cli.cjs --instance '<id>' --epoch '<epoch>' `
    --workspace 'vsls:/' --request '<request.json>'
```

The CLI also accepts a JSON object on stdin. Launch it from a usable local directory. A `vsls:` URI is not a local filesystem path.

## Read and edit

Use `read` for relevant lines or `readMany` for several files. Reads return current buffer text and a document `version`; reuse that version in later edits.

```json
{"op":"edit","files":[{"path":"src/main.ts","expectedVersion":4,"changes":[{"oldText":"return oldValue;","newText":"return newValue;"}]}]}
```

An `oldText` match must be unique unless `all:true` is explicitly requested. Prefer one `edit` request for related changes across several files. Use `create` for new text files and guarded `write` for complete replacements.

New files infer LF or CRLF from their content; set `eol` to choose explicitly. Existing documents retain their line-ending style. Creation, copying, and moving create missing parents by default; use `parents:false` when a previous result already established the parent directory.

## Check save results

Inspect `applied`, `saved`, and the per-file `dirty` state. Normal successful writes do not require another read or a Host-side confirmation. If saving fails after an edit is applied, keep the buffer and use `save` with the returned version when retrying the save. Do not reapply the whole batch.

Dirty documents are protected by default. Set `allowDirty:true` only when you intend to include and save their existing unsaved edits.

## Search and navigation

`search` uses VS Code's Search View and returns a snapshot; `searchResults` reads that view without starting another search. Neither guarantees that a search has finished. `findFiles` can miss new files, so use a known path directly instead of requiring it to appear in search first.

Use `symbols`, `workspaceSymbols`, and `definition` for language-aware navigation. Their results depend on the language providers available to the project.

## Manage the connection

The service follows the VS Code window lifecycle. Use `Live Share Workspace Bridge: Restart Connection` or `Live Share Workspace Bridge: Stop Connection` from the Command Palette when needed.

A new window or a reload changes the instance ID. Workspace changes update the epoch. Rediscover and confirm the project after an `instance_mismatch`, `workspace_changed`, or unavailable-instance error.
