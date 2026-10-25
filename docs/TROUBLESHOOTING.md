# Troubleshooting

**English** | [简体中文](TROUBLESHOOTING.zh-CN.md) | [繁體中文](TROUBLESHOOTING.zh-TW.md) | [日本語](TROUBLESHOOTING.ja.md)

[Documentation](README.md)

## No instance or no shared root

Install the extension in the Profile used by the Live Share Guest window. Reload that window after an update, connect to the intended session, and run the CLI `instances` command. A local VS Code window can have an instance with an empty `roots` list. Select the connected Guest entry by its project name and complete `vsls:` URI. Use **Live Share Workspace Bridge: Restart Connection** if its connection was stopped. The Output channel with the same name reports pipe startup errors.

When migrating from an earlier local package, uninstall `ucuni-local.liveshare-workspace-tools` or `Koha9-Lee.liveshare-workspace-tools`, then install `Koha9-Lee.liveshare-workspace-bridge` and reload each affected window. VS Code treats the renamed extension as a separate installation; do not keep both running. If you configured a PowerShell override, transfer it to `liveshareWorkspaceBridge.powershell`.

## Binding, editing, and saving

A reload changes the instance ID; a workspace change updates its epoch. Rediscover the intended project after a binding error. For `content_changed`, read only the affected text and revise the edit with its current version. Dirty documents are protected; include their unsaved changes only when explicitly intended.

An applied edit can still fail to save. Inspect each file's save result and dirty state; retry only `save` with the returned version. A transport failure with `requestSent:true` leaves the outcome unknown. Inspect the affected target before any further mutation; never blindly replay the edit.

## Search and language results

Content search returns a Search View snapshot with `complete:null`; it has no completion signal. File-name search can omit newly created files. An empty result does not prove absence. Read a known path directly. Language queries depend on the project's language providers; empty diagnostics do not establish that a build or test passed.

## Text, bytes, and size limits

Document edits preserve the Guest buffer's line-ending style. Live Share may normalize line endings when saving on the Host, so Guest text or `providerRead` is not proof of exact Host bytes, encoding, or line endings. This version does not offer general binary writes, directory copying, recursive deletion, or a Host shell.

For `response_limit`, request fewer lines or files. A partial response does not mean the underlying provider reads the file as a stream. See the [API limits](API.md) and [usage guide](USAGE.md).
