# Architecture

**English** | [简体中文](ARCHITECTURE.zh-CN.md) | [繁體中文](ARCHITECTURE.zh-TW.md) | [日本語](ARCHITECTURE.ja.md)

[Documentation](README.md)

- extension.cjs owns local IPC (owner-only by default), lifecycle and English permission status.
- permissions.cjs is the request authorization layer; it reads live User/machine settings before dispatch and Host send. Agent endpoints cannot update permissions.
- workspace.cjs owns document versions, dirty-buffer checks, text preflight, language edits and targeted saves. Host mutations keep affected model guards until normalized content matches.
- host-channel.cjs serializes shared-terminal actions, verifies a random bootstrap file, binds the Host root and frames responses with nonces and explicit end markers. Large payloads use an acknowledged no-echo console input path.
- host-operations.cjs maps public APIs to narrow Host actions and binds jobs/transfers to root and epoch.
- host-actions.ps1 loads an in-memory Host helper. host-runtime.cs provides owned Windows Job Objects, bounded stream draining, chunked byte handles, SHA-256 and expiry. No permanent Host agent or HTTP service is installed.
- cli.cjs is canonical and copied into the skill at build time; it supports JSON, patches and chunked uploads. Its retained download entry point is denied by the server capability gate in this release.

The document path remains the default for text edits, without provider rereads after every save. The optional Host path handles complete saved-file search, commands, patches and byte/directory operations. Raw Host execution requires all operation permissions; narrow actions remain individually controllable. These checks are not an OS sandbox for arbitrary scripts.

Dispatched work is not rolled back on revocation. Child tasks retain a bounded timeout; synchronous filesystem actions may still complete after a Guest response timeout. Unknown outcomes are not retried. Transfers have idle expiry and owned temporary staging; directory copy can partially fail. No recursive delete or multi-file disk transaction is exposed.

`pipe-security.cs` / `pipe-host.ps1`: explicit owner/sandbox DACL, local/session gate, persistent single-instance pipe, bounded UTF-8 input and reply drain.

`local-accounts.cs` enumerates only local SAM users and selects stable SIDs; `ipc-access.cjs` owns User-only mode resolution, one-time legacy SID migration and the English account picker.

Large downloads (`transferOpenRead`/`transferRead`, including CLI download) return `feature_unavailable`. Ask the user for an accessible copy and local path; do not bypass the limit with repeated byte reads or raw commands. Small byte reads and large uploads remain available.
