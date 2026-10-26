# API reference v0.2

**English** | [简体中文](API.zh-CN.md) | [繁體中文](API.zh-TW.md) | [日本語](API.ja.md)

v0.2.2: **Configure IPC Access** provides ownerOnly (default), allLocalUsers and selectedUsers with stable local SIDs. Legacy true migrates only to the existing selected accounts, never all users. See [IPC access modes](IPC-SECURITY.md). Host permissions remain independent.

[Documentation](README.md)


Requests use op, instance, epoch and exact workspace URI. CLI flags can supply the binding fields. Shared paths are relative to the selected root. Replies are `{ok:true,result:...}` or `{ok:false,error:{code,message,details?}}`; still inspect applied/saved, per-file results, complete, truncation, state and exit codes.

## Permissions and Host binding

All settings are English, under `liveshareWorkspaceBridge.*`, with machine scope (User/Remote settings; no workspace override).

| Setting | Meaning |
|---|---|
| agent.enabled | Master access switch; default true. Info/status remain inspectable. |
| terminal.enabled | Shared Host terminal access; default false. All Host-backed capabilities are effectively disabled while off. |
| permissions.OPERATION | Individual switches; aliases inherit their base operation. Inspect info.permissions.configured/effective. |
| terminal.name | Exact shared RW terminal name, or one uniquely eligible shared terminal. Guest terminals are excluded. |
| terminal.hostWorkspacePath | Optional explicit Host root; otherwise verify the shared PowerShell current directory. |
| terminal.commandTimeoutMs | 120000 by default, range 1000..3600000. |
| terminal.maxOutputCharacters | Retained characters per stdout/stderr stream, default 65536, range 1024..262144. |
| transfer.chunkBytes | Raw bytes/chunk, default 32768, range 1024..65536. |
| transfer.idleTimeoutMs | Handle/staging idle lifetime, default 120000, range 10000..900000. |

Raw Host commands require every operation permission to be enabled: arbitrary code cannot enforce individual operation restrictions. Document mutations require save permission; parent creation requires mkdir; byte overwrite requires write. These controls authorize operations, not an OS filesystem sandbox.

```json
{"op":"hostStatus"}
{"op":"hostBind"}
```

Status sends no command. Binding verifies an owned temporary Guest bootstrap file, loads a session helper into Host PowerShell and removes the file. It does not install a Host agent or change authentication. Current Host support is Windows PowerShell on Windows. Revoking terminal access stops new requests, not already-dispatched effects.

## Text, files and language

```json
{"op":"list","path":"src"}
{"op":"read","path":"src/main.ts","startLine":1,"endLine":80}
{"op":"readMany","files":[{"path":"a.txt"},{"path":"b.txt","startLine":1,"endLine":40}]}
{"op":"edit","files":[{"path":"a.txt","expectedVersion":3,"changes":[{"oldText":"old","newText":"new"}]}]}
{"op":"write","path":"a.txt","expectedVersion":4,"text":"replacement\n"}
{"op":"create","path":"new/a.txt","text":"hello\n","eol":"LF"}
{"op":"save","path":"a.txt","expectedVersion":5}
{"op":"mkdir","path":"new/nested"}
{"op":"stat","path":"a.txt"}
{"op":"move","path":"old.txt","to":"new.txt","parents":false}
{"op":"delete","path":"empty-directory"}
{"op":"references","path":"src/a.ts","line":12,"character":8}
{"op":"renameSymbol","path":"src/a.ts","line":12,"character":8,"newName":"newValue","preview":true}
{"op":"format","path":"src/a.ts","tabSize":2,"insertSpaces":true}
```

Reads return buffered text/version/dirty/EOL/lineCount. Lines are 1-based and inclusive. withHash:true adds a document text hash, not raw Host bytes. Single text return limit is 1 MiB; opening can still access a complete provider resource.

edit.files allows 100 distinct targets, 1000 changes/file. oldText must be unique unless all:true. All positions reference original content, without overlap. Line edits use startLine/endLine/newText/expectedText?, selecting lines without the last separator. Native range fields use 0-based lines and UTF-16 characters, end-exclusive, with version/hash/expectedText protection. Full write requires expectedVersion or expectedHash.

Text normalizes to Guest document EOL. Host coediting may choose different disk newlines. Saves are target-only and nontransactional; partial failures remain explicit. allowDirty:true includes preserving/saving existing unsaved content.

Existing symbols, workspaceSymbols, definition and diagnostics remain. Language query inputs use 1-based line and 0-based UTF-16 character. Renames/format check scope and dirty buffers and save targets; rename reconstructs text edits only, not provider file operations. preview:true returns a plan without applying. Formatting needs a provider.

Delete rejects recursive:true. Stat is provider metadata with potentially unknown size/provider times; providerRead is explicit UTF-8 verification, not a binary read. Host writes compute normalized text digests only for affected open Guest documents (up to 16 MiB per file), within the same Host response. HostStat withTextHash:true can explicitly refresh that digest after an uncertain mutation. A clean Guest model must match the digest, not merely change version. Host writes may wait for its matching change event; editor_refresh_pending preserves it rather than globally reverting or returning known-stale text.

## Complete saved-file search

```json
{"op":"search","query":"handleRequest","include":["src/**/*.ts"],"exclude":["**/generated/**"],"caseSensitive":true,"limit":500}
{"op":"findFiles","pattern":["src/**/*.ts"],"limit":500}
```

Include/exclude is one glob or an array, not a comma-separated pattern language. regex/wholeWord/caseSensitive default false. useExcludes:false includes hidden/ignored files; .git administration paths remain excluded. Otherwise use rg ignore rules; conditional VS Code excludes are not fully replicated.

Inspect complete, state, exitCode, truncated and scope:saved_host_files. No-match exit 1 is valid. Output/result limits or parse errors make complete false. Limit defaults 500, max 10000. Matches include relative path, 1-based line, text and UTF-8 byte offsets; reread relevant text before constructing UTF-16 edits. Dirty buffers are reported separately, never automatically saved.

Explicit searchSnapshot/searchResults/findFilesSnapshot keep the limited old editor/provider route and unknown completeness; they do not require Host access and are not automatic fallbacks.

## Commands and patches

```json
{"op":"hostExec","command":"node --test","cwd":"","timeoutMs":120000,"waitMs":1000}
{"op":"hostJobPoll","jobId":"<id>","waitMs":5000,"stdoutOffset":0,"stderrOffset":0}
{"op":"hostJobCancel","jobId":"<id>"}
{"op":"hostJobForget","jobId":"<id>"}
{"op":"applyPatch","patch":"<Git-style unified text patch>","checkOnly":true}
```

For commands with known file mutations, supply affectedPaths (up to 100 relative paths). Only affected open buffers are checked against final Host text digests; arbitrary command effects are otherwise untracked.

Commands run in owned child processes with a Windows Job Object. Timeout/cancel targets their tree, never the shared PowerShell. Command length is 1..8000, waitMs 0..5000, timeout 1000..3600000. States: running/completed/timed_out/cancelled. Completed does not imply exit 0. Streams are bounded, drained and marked truncated; reuse returned cursors. Forget only completed jobs. At most 16 retained jobs/binding.

Patches are at most 1 MiB/100 files, use a/ and b/ paths, and cannot escape root, alter .git, or contain binary/symlink/submodule patches. Git apply --check precedes application. checkOnly:true does not apply; dirty targets are rejected. No staging/commit/push. Git must exist on Host. Patch line endings follow Host Git configuration; use byte APIs when raw-byte exactness is required.

## Raw bytes and large transfers

```json
{"op":"hostStat","path":"asset.bin","withHash":true}
{"op":"readBytes","path":"asset.bin"}
{"op":"writeBytes","path":"asset.bin","base64":"<canonical base64>","parents":false}
{"op":"writeBytes","path":"asset.bin","base64":"<base64>","overwrite":true,"expectedCurrentSha256":"<raw Host hash>"}
{"op":"copy","path":"assets/a.png","to":"backup/a.png"}
{"op":"copyDirectory","path":"template","to":"new-template"}
```

Small byte APIs are bounded by chunkBytes and check SHA-256. Directory copy requires a new destination and rejects reparse points/Git administration trees. Paths and ancestors stay inside verified Host root. Existing byte overwrite needs raw expectedCurrentSha256; text hashes differ. Normal writes do not trigger extra provider verification.

```powershell
node "<client>" upload --instance "<id>" --epoch "<epoch>" --workspace "vsls:/" --input "<local.bin>" --path "assets/file.bin"
node "<client>" apply-patch --instance "<id>" --epoch "<epoch>" --workspace "vsls:/" --input "<local.patch>" --check-only
```

Upload overwrite uses --overwrite and --expected-current-sha256 HASH. The enabled transfer protocol is transferBeginWrite, transferWrite(sequence/base64), transferCommit(sha256), transferAbort. Maximum frame sizes remain 2 MiB request/4 MiB response; uploads use many bounded chunks.

Uploads stage in owned Host temporary files, delete-on-close with idle expiry; destination is updated only at commit. Identical immediately repeated upload sequences are idempotent; ordinary mutations are never automatically replayed. A lost commit reply requires inspecting target state/hash before restarting. Unsupported steps require a concrete user-assistance request and a reply before dependent work, as described in the skill.

Large downloads (`transferOpenRead`/`transferRead`, including CLI download) return `feature_unavailable` before sending Host commands in v0.2. A 1.1 MB live download repeatedly stalled the shared terminal; it is deferred pending a reliable output transport. Do not bypass this by looping small byte reads. Small bounded byte reads and large uploads remain available.
