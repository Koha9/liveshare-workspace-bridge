# IPC access modes v0.2.2

**English** | [简体中文](IPC-SECURITY.zh-CN.md) | [繁體中文](IPC-SECURITY.zh-TW.md) | [日本語](IPC-SECURITY.ja.md)


## Modes and scope

Use **Live Share Workspace Bridge: Configure IPC Access**, or the English User setting `liveshareWorkspaceBridge.ipc.accessMode`. Only an explicit User value is trusted; workspace settings and contributed defaults cannot broaden access.

| Mode | Additional access beyond the bridge owner |
|---|---|
| ownerOnly | None. This is the release default. |
| allLocalUsers | All current machine-local SAM user accounts, including disabled accounts; their existing processes may still exist. Not Everyone, Authenticated Users, local groups or domain users. |
| selectedUsers | Only current machine-local users whose exact SIDs are saved in ipc.selectedUserSids. |

The owner is always retained, including when VS Code itself runs as a domain user. Additional accounts are machine-local only. All modes reject remote clients and require the same Windows session. This is a Windows session-ID check, not a promise that separate run-as logon tokens have the same logon SID. On domain controllers, additional local-user enumeration is refused rather than treating domain SAM users as local accounts.

Trust applies to every process under an allowed account, not only Codex or one task. Calls use bridge permissions outside Codex filesystem sandbox boundaries. Agent and operation switches still apply. Host/terminal permission is independent and is never enabled by access configuration. If terminal.enabled is already true and other Host requirements are met, allowed accounts may run Host commands. The mode picker displays that warning before applying broader access.

The account picker displays current names and SID details, but stores SID strings rather than names. Renaming an account preserves access. Deleted local SIDs are retained as unavailable references and never granted; a recreated account with the same name has a different SID and must be explicitly selected. Invalid SIDs, well-known groups and non-local SIDs are reported in ipc.selectionIssues and never granted. Opening the picker does not edit settings; cancelling changes nothing.

allLocalUsers enumerates the local SAM at bridge startup. New accounts are included after a bridge restart; no accounts are created, enabled or renamed. No machine/domain policy, credentials or network mappings are changed.

## Legacy migration

If the new mode is unset and the deprecated v0.2.1 ipc.allowCodexSandboxClients is true, first startup resolves only the two existing legacy names, caches their SIDs, writes ipc.selectedUserSids and sets selectedUsers. It never selects allLocalUsers. Once pinned, restarts no longer resolve those names. Missing legacy accounts are not replaced with other names; an empty result grants no additional account. A boolean contains no historic SID, so deletion/recreation before the first snapshot cannot be reconstructed; review the migration plan/current identities if that history is uncertain.

An explicitly set mode, including ownerOnly, overrides the old boolean. Legacy false/unset remains ownerOnly with no migration. Ambiguous pre-edited SID lists and observed concurrent configuration changes are not overwritten. The old boolean is retained for compatibility, but is ignored by v0.2.2 after an explicit mode exists. Older running extension windows still use their old rules until reloaded; a new mode is not a control for an unupgraded window.

Migration writes User settings. Policy changes restart the local bridge and change its instance/epoch; rediscover afterward. They do not intentionally reload VS Code or enable Host access, and do not undo dispatched operations. Never replay an unknown sent mutation. Installing an update may separately require reloading the extension host/window and reconnecting Live Share. Obtain the required deployment approval before disrupting an existing connection.

## Diagnostics and implementation

```powershell
node "<client>" diagnose
node "<client>" instances
```

diagnose is read-only registry inspection and info probing, with no Host binding or shared-file writes. It distinguishes ready, partial, no_records, no_shared_workspace, access_denied, unavailable and invalid_registry. A healthy matching project may be usable alongside stale/denied unrelated records. EPERM/EACCES is not evidence that the extension is disabled. Review the configured mode and SID issues; do not silently broaden access, disable sandboxing or choose allLocalUsers as an automatic repair.

Native local SAM enumeration uses local-only NetUserEnum/NetUserGetInfo, guarded by the machine role. The pipe keeps an explicit protected DACL, remote rejection, same-session checks, one persistent FIRST_PIPE_INSTANCE handle, bounded UTF-8 requests and bounded reply drain. It does not impersonate clients, open HTTP ports or copy tokens. [v0.2.2 validation](VALIDATION-v0.2.2.md) distinguishes policy tests from actual cross-account checks and pending deployment.
