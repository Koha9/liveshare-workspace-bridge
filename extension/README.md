# Live Share Workspace Tools

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md)

Use Codex or the bundled CLI to read, edit, and save files in a connected Live Share Guest workspace through a Windows named pipe.

- No HTTP listener, token copying, npm runtime dependencies, or Host-side installation.
- Supports buffered reads, multi-file edits, target-document saves, file operations, diagnostics, and language queries.
- Native content search returns a snapshot; file-name search can omit new files.

Install in the Profile used by the Guest window. Follow VS Code's reload prompt when updating.

Commands:

- `Live Share Workspace Tools: Restart Connection`
- `Live Share Workspace Tools: Stop Connection`

See the [usage guide](../docs/USAGE.md), [API reference](../docs/API.md), and [troubleshooting guide](../docs/TROUBLESHOOTING.md).

The pipe is available to programs running as the same Windows user. It does not provide a Host shell or isolate same-user programs.

Licensed under the MIT License. See [LICENSE](../LICENSE).
