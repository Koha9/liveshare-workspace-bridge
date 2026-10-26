# v0.2 validation and delivery limits

**English** | [简体中文](VALIDATION-v0.2.zh-CN.md) | [繁體中文](VALIDATION-v0.2.zh-TW.md) | [日本語](VALIDATION-v0.2.ja.md)

[Documentation](README.md)

The extension and bundled skill are versioned together. This record distinguishes local automated checks from observations in a real Windows Live Share Guest/Host session. It contains no connection tokens, raw Host paths or business-project contents.

## Automated checks

- 37 Node tests passed, with no skipped tests on the Windows validation machine.
- Node syntax checks passed for the runtime and canonical skill client.
- Skill frontmatter/layout validation passed.
- VSIX and skill ZIP builds passed exact-member/source and SHA-256 verification. The skill package includes both API and recovery references.
- Tests cover current-user named pipes, lifecycle, edit preflight, target-only saves, partial save failures, permissions, patch-path validation, stale-buffer protection, language renames, Host byte primitives, bounded child-process output, exit status, timeout and cancellation.

## Live observations

All Live Share mutations used uniquely named owned fixtures. Retained detailed receipts are local-only; no business source was edited. Temporary permission settings were restored, and owned fixture absence was checked.

| Capability | Evidence and result |
|---|---|
| Host binding | Verified a shared RW PowerShell against an owned bootstrap file. An ordinary Guest terminal was not selected. Missing-terminal errors were explicit. |
| Saved-file search and enumeration | Positive matches, no-match exit 1 and newly created paths were returned through Host ripgrep. Completeness is conditional on output/result limits. |
| Host jobs | Native exit 7 and PowerShell failure 1 were preserved. stdout/stderr were bounded at 65,536 characters per stream and truncation was reported. Owned-process timeout and cancellation passed. |
| Bytes and copies | A 4,096-byte binary round trip, file copy, directory copy and guarded overwrite passed Host SHA-256 comparison. |
| Text patches | Git check/apply passed. Host Git produced CRLF in this fixture; text equivalence passed. An existing Guest model could remain dirty/stale and was rejected explicitly instead of overwritten. |
| Language tools | Four reference locations, a saved two-file symbol rename and provider formatting passed in the tested JavaScript fixture. Other projects need their own language providers. |
| Large upload | A 1,100,123-byte upload passed chunk acknowledgements and SHA-256 checks. |
| Permissions | Live settings changes immediately blocked text reads, raw-command bypass, all terminal-dependent operations and all agent operations. Test settings were restored. |
| Large download | Failed in repeated real terminal transfers. A later transfer reached about 450 KB before timeout, and the terminal stopped responding to a read-only recovery handshake. The root cause is unresolved. |

There was no single fully successful end-to-end Host suite: failed download runs interrupted it. The rows above describe separately observed checks. Later output pacing and improved timeout diagnostics passed local tests but were not verified as a cure for sustained terminal output. Do not treat local transfer primitives as live download acceptance.

## Deferred and conditional behavior

- Large downloads are blocked with feature_unavailable before Host dispatch. Do not emulate them by looping byte reads or inventing a new transport. Ask the user for an accessible copy and its path.
- Recursive deletion and cross-file atomic disk saves are intentionally unavailable. Ask the user for the required manual step, or explicit acceptance of per-file saves where appropriate.
- Host search covers saved files; it does not save or merge dirty editor buffers. Editor snapshots retain unknown completeness.
- Host mutations can precede Guest buffer refresh. Preserve dirty buffers and report editor_refresh_pending/external_change_dirty_document. User assistance may be needed to resolve/reopen them safely.
- Directory copy requires a new destination and may leave a partial destination after failure. Git patch newline behavior follows Host Git configuration.
- Host capabilities currently require Windows Host PowerShell plus a connected RW shared terminal. Terminal permission defaults off. Permissions do not provide an OS sandbox for arbitrary Host commands.
- Permission revocation blocks new work without undoing dispatched effects. Unknown sent mutations are never automatically replayed.

The skill requires one assistance request per unresolved step, waits for a user response before dependent work, and distinguishes user-assisted completion from bridge operations. Builds and repository changes do not imply publication, staging, commit or push.
