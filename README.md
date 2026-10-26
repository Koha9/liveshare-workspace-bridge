# Live Share Workspace Bridge

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md)

Let Codex work with a connected VS Code Live Share workspace through a local Windows bridge. v0.2 combines target-document editing with an optional verified Host read/write PowerShell channel. No HTTP port or copied token is needed.

## Features

- Buffered text/range reads, batch edits and target-only saves with explicit results.
- Host ripgrep search and path enumeration with completion, exit codes and truncation flags.
- Bounded Host commands with stdout/stderr cursors, owned-process timeout and cancellation.
- Checked Host Git text patches, references, text-only symbol renames and provider formatting.
- Byte-preserving reads/writes, file copies, new-directory copies and chunked large uploads with SHA-256.
- English permission settings: master access, individual operations and a linked terminal switch.

Recursive deletion and cross-file all-or-nothing saves are not provided. Host search covers saved files, not dirty editor buffers. The explicit editor snapshot APIs remain incomplete.

## Requirements and installation

Guest: Windows, VS Code/Live Share and Node.js. Host features: a Windows Host with a shared read/write PowerShell terminal; Git and ripgrep are needed for their respective operations. The bridge can discover ripgrep from a Host VS Code installation. No permanent Host agent installation is required; binding loads an in-memory session helper.

Build with a confirmed Python 3 executable (standard library only):

```powershell
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py
$vsix = Get-ChildItem .\dist\liveshare-workspace-bridge-*.vsix |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
code --install-extension $vsix.FullName
```

Use the Guest window's Profile, reload when prompted and restore the Live Share connection. Copy `skills/liveshare-workspace-bridge/` to the Codex skills directory after reviewing any existing local customization. Invoke `$liveshare-workspace-bridge`.

## Permissions

Run **Live Share Workspace Bridge: Configure Agent Permissions**, or search VS Code Settings for `@ext:Koha9-Lee.liveshare-workspace-bridge`.

- **Allow Agent Access** is the master switch (default on).
- **Allow Shared Host Terminal Access** defaults off. Enabling it permits the Host-backed features, subject to their individual switches.
- Individual English controls cover reads, edits, saves, file operations, search, language tools, patches, bytes, transfers and Host commands.
- Turning terminal access off disables every Host-backed operation while retaining configured operation preferences. Guest document features retain their own permissions.
- Raw Host commands require all operation permissions enabled because arbitrary code could bypass individual file restrictions.

The status bar shows **Agent off**, **Guest only**, or **Host allowed**. Host allowed describes permission, not a verified connection. Changes take effect on requests without restarting. Already-dispatched work is not rolled back; child commands retain their timeout.

If the Host RW terminal is missing, the skill asks the user once to have the Host open/share it, then waits. It does not create a Guest terminal, guess a substitute or silently switch execution routes. Permission denials are reported rather than bypassed by changing settings.

For an unsupported requested step, the skill asks the user to assist with exact paths and the intended result, then waits before continuing dependent work. This covers large downloads, recursive deletion, required atomic saves, missing language providers and unresolved editor conflicts. It does not silently skip the step or bypass the restriction with a raw command.

## CLI

```powershell
node .\extension\cli.cjs instances
node .\extension\cli.cjs --instance '<id>' --epoch '<epoch>' --workspace 'vsls:/' --request '<request.json>'
node .\extension\cli.cjs upload --instance '<id>' --epoch '<epoch>' --workspace 'vsls:/' --input '<local.bin>' --path 'assets/file.bin'
```

Choose the project once and retain its instance/epoch/root. No extra info pings are sent on pinned requests. Read the [usage guide](docs/USAGE.md) and [API reference](docs/API.md).

## Design and limits

Ordinary text edits reuse document versions, apply one related batch and save only targets. Successful saves do not trigger default provider rereads or full-file hashes. Host byte operations avoid the Live Share provider's lossy binary path. Affected open text buffers are checked against targeted Host text digests so a version bump alone cannot expose stale content. No global editor revert is used.

Document EOL is not raw Host byte fidelity. Git patches follow Host Git configuration. Search uses saved files and rg ignore rules, not a full replica of every VS Code conditional exclude. Directory copy can partially fail; it requires a new destination and does not merge/recursively replace an existing one.

The local pipe is restricted to the current Windows user. Operation permissions are not an OS sandbox for arbitrary Host code. Host jobs use owned Windows Job Objects; child process trees are bounded and isolated from the shared PowerShell. Large transfers have idle expiry and explicit integrity checks.

## Development

```powershell
npm test
npm run check
& $pythonExe .\scripts\build.py --check
& $pythonExe .\scripts\build.py --verify
```

No npm dependencies are required. Source and skill are maintained together; the build synchronizes the self-contained client. See [development](docs/DEVELOPMENT.md), [architecture](docs/ARCHITECTURE.md) and [documentation](docs/README.md). License: [MIT](LICENSE).

Large downloads (`transferOpenRead`/`transferRead`, including CLI download) return `feature_unavailable` before sending Host commands in v0.2. A 1.1 MB live download repeatedly stalled the shared terminal; it is deferred pending a reliable output transport. Do not bypass this by looping small byte reads. Small bounded byte reads and large uploads remain available.
