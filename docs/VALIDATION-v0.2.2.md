# v0.2.2 candidate validation

**English** | [简体中文](VALIDATION-v0.2.2.zh-CN.md) | [繁體中文](VALIDATION-v0.2.2.zh-TW.md) | [日本語](VALIDATION-v0.2.2.ja.md)


This is source/package validation, not an installed v0.2.2 production acceptance. Existing v0.2.1 WIP was retained; no installed extension, local skill or User setting was updated during this change. Installation and live migration await separate deployment approval because the active bridge/window may need restarting.

| Evidence | Result |
|---|---|
| Local suite | 53 tests passed on Windows, no skips. Syntax/build/skill/package checks passed. |
| Native policy simulation | ownerOnly ignores extra SID selections; allLocalUsers maps only the supplied local catalog; selectedUsers matches exact SIDs. Rename keeps the grant; deletion and same-name recreation do not transfer it. Invalid/group/foreign SIDs are rejected. |
| Actual local APIs | Existing machine-local SAM enumeration succeeded. Native selected-user DACL excludes broad groups; second live server creation and other-session logic were rejected. Domain-controller refusal is a role/policy test, not a test on a real DC. |
| Migration/UI mocks | Legacy true pins only the existing two SIDs into selectedUsers, never allLocalUsers; false does not migrate. Cached SIDs are not re-resolved by name. Explicit User modes win; workspace/default injections cannot broaden trust. Cancelled pickers do not write. Confirmed selection saves SIDs without changing terminal permissions. |
| Actual cross-account echo | Existing CodexSandboxOffline and CodexSandboxOnline were denied before send in ownerOnly, and completed Unicode echo in selectedUsers using the captured SID selection. This used a standalone owned temporary pipe, not the installed Live Share extension. |
| Not performed | No allLocalUsers policy deployed to the current environment; no accounts created/renamed/deleted; no production/Host commands or database operations; no machine/domain policy repair. No installed v0.2.2 migration or Live Share file-write test yet. |

The previous v0.2.1 actual Live Share acceptance remains historical evidence, not a substitute for post-install v0.2.2 acceptance. Actual account renaming, foreign-domain logins, a second Windows session and a remote-host penetration test were not performed. The UI workflow was tested with mocks, not by applying it in the user's current VS Code. All-local trust is a catalog/ACL construction policy here, not an assertion that every local account has been logged in and tested.

The local deployment plan records the two current legacy SIDs and a User-settings hash for review. Before applying migration, recheck that those identities/configuration have not changed. An old boolean alone cannot recover a SID deleted/recreated before its first snapshot. After approval, install v0.2.2, reload the affected extension/window if needed, verify selectedUsers and exact SID membership, reconnect the intended Live Share session if necessary, then run owned-fixture acceptance with no new Host permission.

A later focused regression also passed for Unicode account names split across process-output chunks.
