# MCP server

[English](MCP.md) | **简体中文** | [繁體中文](MCP.zh-TW.md) | [日本語](MCP.ja.md)

[文档](README.zh-CN.md)

Live Share Workspace Bridge 自带一个 Model Context Protocol（MCP）server。agent 在 Guest 机器上把它作为本机 stdio 进程启动。该 server 通过桥接的本机 Windows 命名管道连接正在运行的 VS Code 扩展，不开放任何网络端口。

MCP 是唯一的 agent 接口。任何能启动 stdio server 的 MCP 客户端都可以使用它，例如 Claude Code、Codex 或 VS Code 内置 agent。

## 接入

要求：Windows、带 Live Share 的 VS Code 1.101 或更高版本、`PATH` 中可用的 Node.js，并在 Live Share Guest 窗口安装本扩展。

1. 打开 Guest 窗口并连接共享项目。
2. 在命令面板运行 **Live Share Workspace Bridge: Copy MCP Server Configuration**。它会把可直接粘贴的配置片段复制到剪贴板，同时输出到 "Live Share Workspace Bridge" 输出通道。
3. 按下面任一方式把 server 添加到你的 agent。

扩展激活时会在 `<home>/.liveshare-local/mcp-server.cjs` 安装一个小型启动器。启动器总是从当前正在运行的扩展版本启动 server，因此扩展升级后不需要修改 agent 配置。复制的片段包含你的真实路径，下面的示例使用占位符 `<home>`。

### Claude Code

```text
claude mcp add lswb -- node "<home>/.liveshare-local/mcp-server.cjs"
```

### Codex

在 `~/.codex/config.toml` 中添加：

```toml
[mcp_servers.lswb]
command = "node"
args = ["<home>/.liveshare-local/mcp-server.cjs"]
```

### VS Code 内置 agent

扩展会以 "Live Share Workspace Bridge" 的名称向 VS Code 注册该 server，因此内置 agent 无需任何配置即可发现它。如果你希望写明配置，可在 `.vscode/mcp.json` 或用户 `mcp.json` 中添加：

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

### 第一次调用

让 agent 调用 `lswb_list_workspaces`。它返回共享根目录。其他所有工具都以准确的根 `uri`（`vsls:` URI）作为 `workspace` 参数。

### 发现结果

`lswb_list_workspaces` 返回 `status`、`workspaces`、`probes` 和 `issues`。`status` 为以下之一：

- `ready`：找到共享根目录，且每条记录都有响应；
- `partial`：找到共享根目录，但部分记录或探测失败；
- `no_shared_workspace`：有桥接响应，但没有共享根目录；
- `no_records`：没有找到存活的桥接实例。

发现失败（`discovery_access_denied`、`discovery_unavailable`、`discovery_invalid_registry`）以工具错误返回。

重载或崩溃的 VS Code 窗口可能留下发现记录。当其管道已不存在且所属进程已退出时，该探测以 `status: "stale"` 和 `ownerProcess: "exited"` 报告。它不会让发现结果变为 `partial`，扩展下次激活时会删除这类记录。

## 工具

下表列出 v0.3.0 的 36 个工具。每个工具的 MCP 描述包含完整约定。所有工具仍受桥接权限设置约束。

- **修改文件**：该工具能否修改工作区文件。
- **Host 通道**：该工具是否需要[Host 工具](#host-工具)中所述的可选 Host 通道。

| 工具 | 用途 | 修改文件 | Host 通道 |
|---|---|---|---|
| `lswb_list_workspaces` | 列出通过本机桥接可访问的 Live Share Guest 工作区。 | 否 | 否 |
| `lswb_status` | 报告某工作区的桥接状态：实例身份、epoch、根目录、权限、未保存文档和 MCP server 身份。 | 否 | 否 |
| `lswb_list_dir` | 列出共享目录的条目（名称和文件类型）。 | 否 | 否 |
| `lswb_read_file` | 从编辑器缓冲区读取文本文档，可指定从 1 开始、包含首尾的行范围。 | 否 | 否 |
| `lswb_read_many` | 一次请求读取最多 50 个文本文档。 | 否 | 否 |
| `lswb_create_file` | 新建文本文件并保存；文件已存在时失败。 | 是 | 否 |
| `lswb_write_file` | 替换现有文档的全部文本并保存。 | 是 | 否 |
| `lswb_edit_file` | 把文本替换作为一次工作区编辑应用到最多 100 个文档，然后保存每个目标。 | 是 | 否 |
| `lswb_save_file` | 保存一个有未保存编辑的文档。 | 是 | 否 |
| `lswb_mkdir` | 创建目录，包括缺失的父目录。 | 是 | 否 |
| `lswb_stat` | 返回路径的提供者元数据：类型、大小、mtime、ctime。 | 否 | 否 |
| `lswb_move` | 在工作区内移动或重命名文件或目录。 | 是 | 否 |
| `lswb_delete` | 删除单个文件或空目录（不进回收站）。 | 是 | 否 |
| `lswb_diagnostics` | 返回某文档或整个根目录的语言诊断。 | 否 | 否 |
| `lswb_document_symbols` | 返回文档的符号大纲。 | 否 | 否 |
| `lswb_workspace_symbols` | 按名称在工作区中搜索符号。 | 否 | 否 |
| `lswb_definition` | 查找某位置符号的定义位置。 | 否 | 否 |
| `lswb_references` | 查找某位置符号的引用位置。 | 否 | 否 |
| `lswb_rename_symbol` | 通过语言服务重命名符号，然后保存每个被修改的文档。 | 是 | 否 |
| `lswb_format` | 用文档的语言格式化器格式化并保存。 | 是 | 否 |
| `lswb_host_status` | 报告 Host 通道是否可用和已绑定，以及合格的共享终端和 Host helper 握手状态。 | 否 | 仅状态 |
| `lswb_host_bind` | 通过共享 Host 终端启动 Host helper，并用随机握手文件验证。helper 开始监听后返回 `waitingForward`；见[绑定 Host 通道](#绑定-host-通道)。 | 否（仅临时握手文件） | 是 |
| `lswb_search` | 在 Host 上搜索已保存文件的文本，支持 include／exclude glob。 | 否 | 是 |
| `lswb_find_files` | 查找匹配 glob 模式的已保存 Host 文件路径。 | 否 | 是 |
| `lswb_host_stat` | 返回路径的 Host 磁盘元数据，可选原始字节 SHA-256 和编辑器文本状态。 | 否 | 是 |
| `lswb_copy` | 在 Host 上逐字节复制单个文件。 | 是 | 是 |
| `lswb_copy_dir` | 在 Host 上复制目录树。 | 是 | 是 |
| `lswb_read_bytes` | 以 base64 读取已保存的 Host 文件，附带大小和 SHA-256。 | 否 | 是 |
| `lswb_write_bytes` | 在一次请求中把 base64 字节写入 Host 文件（最多 `transfer.chunkBytes`）。 | 是 | 是 |
| `lswb_host_exec` | 在有界的 Host PowerShell 子进程中启动命令。 | 可能（任意命令） | 是 |
| `lswb_host_job_poll` | 轮询 Host 任务的状态、退出码和输出。 | 否 | 是 |
| `lswb_host_job_cancel` | 取消运行中的 Host 任务；只终止桥接自有的进程树。 | 否 | 是 |
| `lswb_host_job_forget` | 释放已结束的 Host 任务及其保留的输出。 | 否 | 是 |
| `lswb_apply_patch` | 在 Host 上应用 Git unified-diff 文本补丁（1..100 个文件，最多 1 MiB）。 | 是 | 是 |
| `lswb_apply_patch_file` | 在 Host 上应用从本地文件读取的 Git unified-diff 补丁（最多 1 MiB）。 | 是 | 是 |
| `lswb_upload_file` | 把本地文件分块上传到 Host 工作区路径，并用 SHA-256 校验。 | 是 | 是 |

## 结果语义

成功结果以结构化内容返回。失败时设置 `isError`，并带有 `code` 和 `message`。

- **已应用与已保存。** 编辑工具分别报告 `applied`（VS Code 已把编辑应用到文档）和每个文档的保存结果（`saved`、`dirty`）。结果可能已应用但未保存。普通编辑只保存其目标。
- **`transport_outcome_unknown`。** 请求已到达桥接，但结果未得到确认，修改可能已经发生。重试前先检查目标，例如用 `lswb_read_file`、`lswb_stat` 或 `lswb_host_stat`。server 绝不自动重放修改。`transport_unavailable` 表示请求未发送。
- **`workspace_changed`**（以及 `workspace_mismatch`、`instance_mismatch`、`epoch_mismatch`）。工作区绑定已过期：共享会话、VS Code 实例或桥接 epoch 已改变。请再次调用 `lswb_list_workspaces` 并使用新的根 `uri`。如果失败的调用是修改，先检查目标。
- **`not_found`。** 文件不存在时 `lswb_read_file` 以 `not_found` 失败。在 `lswb_read_many` 中只有该条目失败，其他文件仍会返回。
- **搜索按设计并不完整。** Host 搜索和查找只覆盖 Host 上已保存的文件。依赖结果前请检查 `complete`、`truncated` 和 `unsavedDocuments`。

### Host 工具

Host 通道列为"是"的工具在 Live Share Host 上运行。它们需要以下全部条件：

- Host 共享了一个可读写的 Windows PowerShell 终端；
- 桥接设置中开启了 `host.enabled` 以及该操作自身的权限（已弃用的 `terminal.enabled` 仍会读取一个版本）；
- 通道已绑定：用 `lswb_host_status` 检查，用 `lswb_host_bind` 绑定。

搜索和补丁还需要 Host 上的 ripgrep 和 Git。共享终端只用于启动一次前台 Host helper；之后的请求通过 Live Share 转发端口发送。参阅[设置说明](SETTINGS.zh-CN.md)。

#### 绑定 Host 通道

绑定分两步，因为 Host 用户必须手动共享 helper 端口：

1. 调用 `lswb_host_bind`。Host helper 开始监听后，它返回 `bound: false`、`handshake.state: "waitingForward"`、需要共享的 `hostPort` 和 `next` 提示。它不会等待 Host。
2. 请 Host 运行 **Live Share: Share Server** 并输入该端口。然后调用 `lswb_host_status`，直到它报告 `bound: true`。即使握手仍在进行，`lswb_host_status` 也会立即响应。

握手进行期间：

- 再次调用 `lswb_host_bind` 只会报告同一个握手，不会启动第二个 helper。
- 其他 Host 工具返回 `host_handshake_pending` 和 `hostPort`，并且不发送任何内容。不要靠重试这些工具来等待握手，请轮询 `lswb_host_status`。
- 握手最多等待 `host.handshakeTimeoutMinutes`。在通知中取消、工作区变化或关闭窗口也会停止握手。

如果握手失败或被取消，`lswb_host_status` 显示 `handshake.state` 为 `failed` 或 `cancelled`，并带有 `handshake.code` 和 `handshake.message`。再次绑定前，如果上一个 helper 仍在运行，请 Host 在共享终端中按 Ctrl+C。下一次 `lswb_host_bind` 会启动新的 helper。

Guest IPC 辅助进程一次只转发一个请求。因此 `lswb_host_bind` 会在 Host 操作之前返回，而不是把连接占用几分钟。

## MCP 与 CLI

- MCP server 是唯一的 agent 接口。原来的 Codex skill 已在 0.3.0 移除。
- `cli.cjs` 是给人用的排障工具，保留 `instances`、`diagnose` 和固定绑定的原始 JSON 请求。它的 upload、download 和 apply-patch 命令已移除；请使用 `lswb_upload_file` 和 `lswb_apply_patch_file`。
- MCP server 在内部复用 `cli.cjs` 的本机传输。

两者通过同一本机管道连接同一扩展，并遵守相同的权限。

## 已知限制

- **不支持大文件下载。** 大文件下载返回 `feature_unavailable`。请改为向用户索取可访问的副本及其本地路径。不要用重复的字节读取或原始命令绕过限制。小文件字节读取和大文件上传仍可用。
- **本地路径。** `lswb_upload_file` 和 `lswb_apply_patch_file` 读取运行 MCP server 的机器上的 `localPath`。该路径必须是绝对路径。
- **管道访问。** IPC 接入模式（默认仅所属用户）决定哪些本机 Windows 账户能访问管道，也就决定了哪些账户能运行 MCP server。参阅 [IPC 接入](IPC-SECURITY.zh-CN.md)。
- **不支持递归删除**，也没有多文件磁盘事务。
- **仅支持 Windows。**
