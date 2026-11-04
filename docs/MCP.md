# MCP server

**English** | [简体中文](MCP.zh-CN.md) | [繁體中文](MCP.zh-TW.md) | [日本語](MCP.ja.md)

[Documentation](README.md)

Live Share Workspace Bridge ships a Model Context Protocol (MCP) server. Your agent starts it as a local stdio process on the Guest machine. The server reaches the running VS Code extension through the bridge's local Windows named pipe and opens no network ports.

MCP is the only agent interface. Any MCP client that can start a stdio server can use it, for example Claude Code, Codex or the VS Code built-in agent.

## Setup

Requirements: Windows, VS Code 1.101 or later with Live Share, Node.js on `PATH`, and the extension installed in the Live Share Guest window.

1. Open the Guest window and connect to the shared project.
2. Run **Live Share Workspace Bridge: Copy MCP Server Configuration** from the Command Palette. This copies ready-to-paste snippets to the clipboard and also prints them in the "Live Share Workspace Bridge" output channel.
3. Add the server to your agent using one of the options below.

When the extension activates, it installs a small launcher at `<home>/.liveshare-local/mcp-server.cjs`. The launcher always starts the server from the extension version that is currently running, so your agent configuration does not need to change after an extension upgrade. The copied snippets contain your real path. The examples below use the placeholder `<home>`.

### Claude Code

```text
claude mcp add lswb -- node "<home>/.liveshare-local/mcp-server.cjs"
```

### Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.lswb]
command = "node"
args = ["<home>/.liveshare-local/mcp-server.cjs"]
```

### VS Code built-in agent

The extension registers the server with VS Code under the name "Live Share Workspace Bridge", so the built-in agent discovers it without any configuration. If you prefer an explicit entry, add this to `.vscode/mcp.json` or your user `mcp.json`:

```json
{
  "servers": {
    "lswb": {
      "type": "stdio",
      "command": "node",
      "args": ["<home>/.liveshare-local/mcp-server.cjs"]
    }
  }
}
```

### First call

Ask the agent to call `lswb_list_workspaces`. It returns the shared roots. Every other tool takes the exact root `uri` (a `vsls:` URI) as its `workspace` argument.

### Discovery results

`lswb_list_workspaces` returns `status`, `workspaces`, `probes` and `issues`. `status` is one of:

- `ready`: shared roots were found and every record answered;
- `partial`: shared roots were found, but some records or probes failed;
- `no_shared_workspace`: a bridge answered but shares no root;
- `no_records`: no live bridge instance was found.

Discovery failures (`discovery_access_denied`, `discovery_unavailable`, `discovery_invalid_registry`) are returned as tool errors.

A reloaded or crashed VS Code window can leave its discovery record behind. When its pipe is missing and its owner process has exited, the probe is reported with `status: "stale"` and `ownerProcess: "exited"`. It does not make discovery `partial`, and the extension removes such records the next time it activates.

## Tools

The table lists the 36 tools in v0.3.0. Each tool's MCP description holds the full contract. Every tool is still subject to the bridge permission settings.

- **Modifies files**: whether the tool can change workspace files.
- **Host channel**: whether the tool needs the optional Host channel described in [Host tools](#host-tools).

| Tool | Purpose | Modifies files | Host channel |
|---|---|---|---|
| `lswb_list_workspaces` | List the Live Share Guest workspaces reachable through the local bridge. | no | no |
| `lswb_status` | Report bridge status for a workspace: instance identity, epoch, roots, permissions, dirty documents and MCP server identity. | no | no |
| `lswb_list_dir` | List the entries of a shared directory (name and file type). | no | no |
| `lswb_read_file` | Read a text document from its editor buffer, optionally a 1-based inclusive line range. | no | no |
| `lswb_read_many` | Read up to 50 text documents in one request. | no | no |
| `lswb_create_file` | Create a new text file and save it; fails if the file exists. | yes | no |
| `lswb_write_file` | Replace the whole text of an existing document and save it. | yes | no |
| `lswb_edit_file` | Apply text replacements to up to 100 documents as one workspace edit, then save each target. | yes | no |
| `lswb_save_file` | Save one document that has unsaved editor changes. | yes | no |
| `lswb_mkdir` | Create a directory, including missing parents. | yes | no |
| `lswb_stat` | Return provider metadata for a path: type, size, mtime, ctime. | no | no |
| `lswb_move` | Move or rename a file or directory within the workspace. | yes | no |
| `lswb_delete` | Delete a single file or an empty directory (no trash). | yes | no |
| `lswb_diagnostics` | Return language diagnostics for a document, or for the whole root. | no | no |
| `lswb_document_symbols` | Return the symbol outline of a document. | no | no |
| `lswb_workspace_symbols` | Search symbols across the workspace by name. | no | no |
| `lswb_definition` | Find the definition locations of the symbol at a position. | no | no |
| `lswb_references` | Find reference locations of the symbol at a position. | no | no |
| `lswb_rename_symbol` | Rename a symbol through the language service, then save each changed document. | yes | no |
| `lswb_format` | Format a document with its language formatter, then save it. | yes | no |
| `lswb_host_status` | Report whether the Host channel is available and bound, plus eligible shared terminals and the Host helper handshake state. | no | status only |
| `lswb_host_bind` | Start the Host helper through the shared Host terminal, verified by a random handshake file. Returns `waitingForward` once the helper listens; see [Binding the Host channel](#binding-the-host-channel). | no (temporary handshake file only) | yes |
| `lswb_search` | Search the text of saved files on the Host, with include/exclude globs. | no | yes |
| `lswb_find_files` | Find saved Host file paths matching glob patterns. | no | yes |
| `lswb_host_stat` | Return Host disk metadata for a path, optionally the raw-byte SHA-256 and editor text states. | no | yes |
| `lswb_copy` | Copy a single file byte-for-byte on the Host. | yes | yes |
| `lswb_copy_dir` | Copy a directory tree on the Host. | yes | yes |
| `lswb_read_bytes` | Read a saved Host file as base64 with its size and SHA-256. | no | yes |
| `lswb_write_bytes` | Write base64 bytes to a Host file in one request (at most `transfer.chunkBytes`). | yes | yes |
| `lswb_host_exec` | Start a command in a bounded Host PowerShell child process. | may (any command) | yes |
| `lswb_host_job_poll` | Poll a Host job for state, exit code and output. | no | yes |
| `lswb_host_job_cancel` | Cancel a running Host job; only the bridge-owned process tree is terminated. | no | yes |
| `lswb_host_job_forget` | Release a finished Host job and its retained output. | no | yes |
| `lswb_apply_patch` | Apply a Git unified-diff text patch (1..100 files, at most 1 MiB) on the Host. | yes | yes |
| `lswb_apply_patch_file` | Apply a Git unified-diff patch read from a local file (at most 1 MiB) on the Host. | yes | yes |
| `lswb_upload_file` | Upload a local file to a Host workspace path in chunks, verified by SHA-256. | yes | yes |

## Result semantics

Successful results come back as structured content. Failures set `isError` and carry a `code` and a `message`.

- **Applied versus saved.** Edit tools report `applied` (VS Code accepted the edit into the document) separately from per-document save results (`saved`, `dirty`). A result can be applied but not saved. Normal edits save only their targets.
- **`transport_outcome_unknown`.** The request reached the bridge, but its outcome was not confirmed. A mutation may already have happened. Inspect the target before you retry, for example with `lswb_read_file`, `lswb_stat` or `lswb_host_stat`. The server never replays a mutation automatically. `transport_unavailable` means the request was not sent.
- **`workspace_changed`** (also `workspace_mismatch`, `instance_mismatch`, `epoch_mismatch`). The workspace binding is stale: the shared session, VS Code instance or bridge epoch changed. Call `lswb_list_workspaces` again and use the new root `uri`. If the failed call was a mutation, inspect the target first.
- **`not_found`.** `lswb_read_file` fails with `not_found` when the file does not exist. In `lswb_read_many`, only that entry fails and the other files are still returned.
- **Search is incomplete by design.** Host search and find cover saved Host files only. Check `complete`, `truncated` and `unsavedDocuments` before you rely on a result.

### Host tools

Tools in the Host channel column run on the Live Share Host. They require all of the following:

- the Host shares a read/write Windows PowerShell terminal;
- `host.enabled` is on in the bridge settings, together with the operation's own permission (the deprecated `terminal.enabled` is still read for one version);
- a bound channel: check with `lswb_host_status` and bind with `lswb_host_bind`.

Search and patches also need ripgrep and Git on the Host. The shared terminal only starts a foreground Host helper once; requests then go over a Live Share forwarded port. See [Settings](SETTINGS.md).

#### Binding the Host channel

Binding takes two steps, because the Host user has to share the helper port by hand:

1. Call `lswb_host_bind`. Once the Host helper is listening, it returns `bound: false` with `handshake.state: "waitingForward"`, the `hostPort` to share, and a `next` hint. It does not wait for the Host.
2. Ask the Host to run **Live Share: Share Server** and enter that port. Then call `lswb_host_status` until it reports `bound: true`. `lswb_host_status` answers immediately, even while the handshake is still running.

While the handshake runs:

- Calling `lswb_host_bind` again only reports the same handshake. It does not start a second helper.
- Other Host tools return `host_handshake_pending` with `hostPort` and send nothing. Do not retry them to wait for the handshake; poll `lswb_host_status` instead.
- The handshake waits for up to `host.handshakeTimeoutMinutes`. Cancel in the notification, a workspace change or closing the window also stops it.

If the handshake fails or is cancelled, `lswb_host_status` shows `handshake.state` `failed` or `cancelled`, with `handshake.code` and `handshake.message`. Before binding again, ask the Host to press Ctrl+C in the shared terminal if the previous helper is still running. The next `lswb_host_bind` starts a new helper.

The Guest IPC helper forwards one request at a time. That is why `lswb_host_bind` returns before the Host acts instead of holding the connection for minutes.

## MCP and the CLI

- The MCP server is the only agent interface. The former Codex skill was removed in 0.3.0.
- `cli.cjs` is a troubleshooting tool for people. It keeps `instances`, `diagnose` and pinned raw JSON requests. Its upload, download and apply-patch commands were removed; use `lswb_upload_file` and `lswb_apply_patch_file`.
- The MCP server reuses the `cli.cjs` local transport internally.

Both talk to the same extension over the same local pipe and follow the same permissions.

## Known limitations

- **No large-file download.** Large downloads return `feature_unavailable`. Ask the user for an accessible copy and its local path instead. Do not work around the limit with repeated byte reads or raw commands. Small byte reads and large uploads remain available.
- **Local paths.** `lswb_upload_file` and `lswb_apply_patch_file` read `localPath` on the machine that runs the MCP server. The path must be absolute.
- **Pipe access.** The IPC access mode (owner only by default) decides which local Windows accounts can reach the pipe, and therefore which accounts can run the MCP server. See [IPC access](IPC-SECURITY.md).
- **No recursive delete** and no multi-file disk transaction.
- **Windows only.**
