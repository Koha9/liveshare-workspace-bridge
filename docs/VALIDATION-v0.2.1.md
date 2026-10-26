# v0.2.1 sandbox IPC acceptance

**English** | [简体中文](VALIDATION-v0.2.1.zh-CN.md) | [繁體中文](VALIDATION-v0.2.1.zh-TW.md) | [日本語](VALIDATION-v0.2.1.ja.md)


This patch repairs the confirmed Windows-user boundary failure and discovery error masking. It does not change the deferred Host large-download feature or the separate Computer Use sandbox setup failure.

| Check | Result |
|---|---|
| Local regression | 44 tests passed, none skipped on Windows; syntax and package/source/SHA-256 checks passed. |
| Real legacy sandbox, owner-only | Both CodexSandboxOffline and CodexSandboxOnline were denied before sending (EPERM, requestSent:false). |
| Real legacy sandbox, opt-in | Both accounts completed Unicode echo requests using the same-session trusted pipe. |
| Installed extension, trust off | Discovery reported access_denied / discovery_access_denied with explicit denied probes instead of []. |
| Installed extension, trust on | The intended Live Share test root was discoverable; unrelated stale/old-window records remained explicitly reported as partial. |
| Installed Live Share, both sandbox identities | Each created and saved two owned text files, applied a version-guarded two-file edit, verified current document text and explicit provider text, rejected a stale version and removed the fixture. |
| Operation permissions in sandbox | Read permission, agent master switch and disabled Host access were enforced. No Host command was dispatched. |
| Lifecycle and framing | Trust changes restarted only the bridge and revoked the old identity. Rapid replies, oversized/no-newline frames and malformed UTF-8 were tested; rejected frames did not reach dispatch. |
| Cleanup | Both test directories were absent, no dirty documents remained, temporary operation settings were restored without concurrent-user changes. Local sandbox trust was retained by the user's explicit choice. |

The fixture used a test Live Share session, not production. Detailed receipts are ignored local evidence, not published user/Host data. The patch keeps owner-only as the release default and requires explicit user trust for sandbox accounts. That trusts all processes of those accounts within the Windows session, not one task, and does not enforce Codex filesystem sandbox boundaries. See [IPC security](IPC-SECURITY.md).

Static session policy and DACL tests do not constitute an actual second-session or remote-host penetration test. MXC and every language/project combination were not revalidated. The old v0.2 Host feature observations remain historical evidence; no new Host build/test, raw-byte or download claim is made by this IPC acceptance.
