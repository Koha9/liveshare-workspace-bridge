# IPC access and migration

**English** | [简体中文](IPC-SECURITY.zh-CN.md) | [繁體中文](IPC-SECURITY.zh-TW.md) | [日本語](IPC-SECURITY.ja.md)


Configure English User settings through **Live Share Workspace Bridge: Configure IPC Access**. Only explicit User values control trust; workspace settings and contributed defaults cannot expand it.

| Mode | Access beyond the bridge owner |
|---|---|
| ownerOnly | None; release default. |
| allLocalUsers | Current machine-local SAM users, including disabled accounts with existing processes. Not Everyone, groups or all domain users. |
| selectedUsers | Current local users matching saved ipc.selectedUserSids. |

The owner is retained even if it is a domain user; additional grants are local only. Remote connections are rejected and all clients must share the bridge's Windows session ID. Domain controllers are refused for additional-account enumeration. All-local membership is refreshed at bridge startup, not by creating or watching accounts.

Trust covers all processes of an allowed account, not one Codex task. Bridge calls are outside Codex filesystem sandbox boundaries and still obey agent/operation permissions. Host access is independent; when enabled and otherwise usable it can permit Host commands. The picker warns before broader access. Never enable a broader mode as an automatic error workaround.

The picker shows current names but stores SIDs. Renames keep access; deleted/recreated accounts do not inherit selection by name. Unavailable/invalid/non-local SIDs are reported and not granted. Cancel leaves settings unchanged.

## Compatibility migration

When ipc.accessMode has no explicit User value and legacy ipc.allowCodexSandboxClients is true, initial migration resolves only existing CodexSandboxOffline/Online identities, caches their SIDs, saves ipc.selectedUserSids and selectedUsers. It never selects allLocalUsers. Cached SIDs are not re-resolved by name; missing accounts add no access. A boolean cannot recover a historical SID deleted/recreated before the first snapshot: review identities if uncertain.

An explicit mode overrides the legacy flag. False/unset stays ownerOnly. Ambiguous hand-edited selections or observed concurrent changes are not overwritten. The old flag remains compatible but new versions ignore it once mode is explicit; old running windows require updating/reloading to honor the modes.

Operation permission switches update subsequent requests live. IPC trust changes and migration write User settings and restart the bridge, changing instance/epoch. Obtain any required deployment approval, pause dependent work and rediscover. No Host permission, account, credential, ACL policy or execution policy is changed by this workflow; dispatched effects are not undone.

## Design boundaries

The native pipe uses explicit SID grants, remote rejection, same-session checks, one persistent server instance and bounded input/reply handling. Local SAM enumeration refuses domain controllers. These are current constraints, not a guarantee that every Windows policy, remote host or account type was tested. See [startup diagnostics](STARTUP-DIAGNOSTICS.md) for access/error triage.
