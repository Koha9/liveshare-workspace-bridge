# Live Share Workspace Bridge v0.2

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md)

Read/edit/save shared documents through current-user Windows IPC. Optional verified Host RW PowerShell adds complete saved-file search, bounded commands, checked text patches, byte-preserving copies and chunked transfers. No HTTP endpoint or token copying.

Open **Live Share Workspace Bridge: Configure Agent Permissions**. English User settings provide a master agent switch, operation permissions and a linked terminal switch (default off). The status bar shows effective access mode. Missing Host terminals cause the skill to ask the user once and wait; ordinary Guest terminals are never substitutes.

Recursive deletion and cross-file save transactions remain unavailable. Search covers saved Host files. Text document EOL is not independent Host byte fidelity. See [usage](../docs/USAGE.md), [API](../docs/API.md) and [development](../docs/DEVELOPMENT.md).

Large downloads (`transferOpenRead`/`transferRead`, including CLI download) return `feature_unavailable` before sending Host commands in v0.2. A 1.1 MB live download repeatedly stalled the shared terminal; it is deferred pending a reliable output transport. Do not bypass this by looping small byte reads. Small bounded byte reads and large uploads remain available.
