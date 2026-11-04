# Live Share Workspace Bridge

[English](README.md) | **简体中文** | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md)

让 AI agent 在已连接的 VS Code Live Share Guest 工作区中工作。agent 通过本机 MCP server 和本机 Windows 命名管道连接扩展，不开放网络端口。可选的 Host 通道使用 Live Share 转发的 loopback 端口，并带有每个 helper 独立的 token。

## 功能

- 文档／范围读取、受版本保护的批量编辑、只保存目标文件。
- 可选 Host 通道：已保存文件搜索、有界命令、检查后应用文本补丁、保持字节的复制及大文件上传。
- 语言服务符号、定义、引用、重命名和格式化；英文操作与 IPC 接入设置。

不提供递归删除和跨文件原子保存。大文件下载（`transferOpenRead`／`transferRead`）返回 `feature_unavailable`。请用户提供可访问的副本和本地路径，不要用重复的字节读取或原始命令绕过限制；小文件字节读取和大文件上传仍可用。

## 前置条件

- Windows、VS Code 1.101 或更高版本，以及 Live Share 扩展。
- 运行 agent 和 VS Code 的 Windows 账户的 `PATH` 中有 Node.js。MCP server 通过 `node` 命令启动。
- 本扩展只安装在 **Guest** 窗口，即加入 Live Share 会话的 VS Code 窗口。Host 端什么都不用安装。
- 支持 MCP stdio server 的 agent，例如 Claude Code、Codex 或 VS Code 内置 agent。

## 1. 安装与连接

1. 在 Guest 的 VS Code 窗口中，从 Marketplace 安装 [Live Share Workspace Bridge](https://marketplace.visualstudio.com/items?itemName=Koha9-Lee.liveshare-workspace-bridge)，或用 **Extensions: Install from VSIX...** 安装 VSIX。
2. 在该窗口中加入 Host 的 Live Share 会话。

## 2. 配置 MCP

在命令面板运行 **Live Share Workspace Bridge: Copy MCP Server Configuration**。它会把 Claude Code、Codex 和 VS Code 可直接粘贴的配置片段复制到剪贴板，同时输出到 "Live Share Workspace Bridge" 输出通道。复制的片段包含你的真实路径；下面的示例用占位符 `<home>` 表示你的用户目录。

所有配置都指向启动器 `<home>/.liveshare-local/mcp-server.cjs`。扩展激活时会安装并更新这个文件。启动器总是启动当前正在运行的扩展版本的 MCP server，因此扩展升级后不需要修改 agent 配置。

### Claude Code

```text
claude mcp add lswb -- node "<home>/.liveshare-local/mcp-server.cjs"
```

在 `add` 后加上 `--scope user`，可让所有项目都能使用该 server。

### Codex

在 `~/.codex/config.toml` 中添加：

```toml
[mcp_servers.lswb]
command = "node"
args = ["<home>/.liveshare-local/mcp-server.cjs"]
```

### VS Code 内置 agent

无需配置：扩展会以 "Live Share Workspace Bridge" 的名称向 VS Code 注册该 server，它会出现在 VS Code 的 MCP server 列表中。如果你更想写明配置，可改为在 `.vscode/mcp.json` 或用户 `mcp.json` 中添加：

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

### 其他 MCP 客户端

任何能启动 stdio server 的客户端都可以使用。command 填 `node`，参数只有一个，即启动器路径 `<home>/.liveshare-local/mcp-server.cjs`。不需要环境变量。

添加 server 后，请重启或重新加载 agent，让它启动该 server：开启新的 Claude Code 会话、重启 Codex，或在 VS Code 的 MCP server 列表中启动它。

## 3. 第一次调用

让 agent 先调用 `lswb_list_workspaces`。它返回共享根目录；其他所有工具都以准确的根 `uri`（`vsls:` URI）作为 `workspace` 参数。示例提示词：

> 使用 lswb 工具。先调用 lswb_list_workspaces，选择共享项目，然后读取其中的 README.md。

完整工具列表和结果语义见 [MCP 指南](docs/MCP.zh-CN.md)。MCP 是唯一的 agent 接口。

## 4. 可选：Host 通道

搜索、命令、补丁、字节复制和上传在 Host 上运行。使用方法：

1. **Guest：** 运行 **Live Share Workspace Bridge: Configure Agent Permissions**。它会打开本扩展的设置；开启 **Allow Host Access**（`host.enabled`，默认关闭）。各操作开关默认开启；原始命令（`lswb_host_exec`）需要全部开启。
2. **Host：** 在 Live Share 中以读写权限共享一个 Windows PowerShell 终端。**Guest：** 打开该共享终端。如果有多个共享终端，请把 `host.terminalName` 设为准确的名称。
3. **agent：** 调用 `lswb_host_bind`。桥接会向共享终端输入一行启动命令来启动 Host helper；helper 在前台、内存中运行，不安装任何东西。该调用返回 `handshake.state: "waitingForward"` 和 `hostPort`，Guest 窗口也会在通知中显示同一端口。
4. **Host：** 运行 **Live Share: Share Server** 并输入该端口。
5. **agent：** 调用 `lswb_host_status`，直到它报告 `bound: true`。之后即可使用 Host 工具。

要停止 Host helper，在共享终端中按 Ctrl+C。终端关闭、会话结束，或连续 `host.idleTimeoutMinutes`（默认 30）分钟没有请求时，它也会退出。搜索需要 Host 上有 ripgrep（`rg`），补丁需要 Git。参阅[设置说明](docs/SETTINGS.zh-CN.md)。

## 常见问题速查

- **`lswb_list_workspaces` 找不到工作区（`no_records`），或启动器报告找不到正在运行的实例：** 确认 Guest 窗口已打开、扩展已启用并已加入会话，且 agent 与 VS Code 运行在同一个 Windows 账户下（IPC 接入默认仅所属用户）。必要时重新加载 Guest 窗口。参阅[故障排查](docs/TROUBLESHOOTING.zh-CN.md)和 [IPC 接入](docs/IPC-SECURITY.zh-CN.md)。
- **agent 无法启动 server，或提示无法识别 `node`：** 安装 Node.js 或把它加入 `PATH`，然后重启 agent 和 VS Code。也可以在配置中把 `node` 换成 `node.exe` 的完整路径。
- **Host 通道一直停在 `waitingForward`：** Host 还没有共享端口。请在 Host 上用准确的 `hostPort` 运行 **Live Share: Share Server**。如果 Live Share 把它转发到了 Guest 上的其他本机端口，请设置 `host.guestPort`。等待在 `host.handshakeTimeoutMinutes` 后结束。参阅[设置说明](docs/SETTINGS.zh-CN.md)。
- **扩展升级后：** 重新加载 Guest 窗口并重启 agent，让它启动新版本的 server。启动器路径不变，无需修改配置。
- **状态栏显示 "LSWB: IPC failed"：** 运行 **Live Share Workspace Bridge: Show Startup Diagnostics**。参阅[启动诊断](docs/STARTUP-DIAGNOSTICS.zh-CN.md)。

## 指南

[MCP](docs/MCP.zh-CN.md) | [设置说明](docs/SETTINGS.zh-CN.md) | [使用](docs/USAGE.zh-CN.md) | [API](docs/API.zh-CN.md) | [IPC 接入](docs/IPC-SECURITY.zh-CN.md) | [启动诊断](docs/STARTUP-DIAGNOSTICS.zh-CN.md) | [故障排查](docs/TROUBLESHOOTING.zh-CN.md) | [开发](docs/DEVELOPMENT.zh-CN.md) | [更新记录](docs/CHANGELOG.zh-CN.md)

[MIT](LICENSE)
