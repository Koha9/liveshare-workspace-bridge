# Live Share Workspace Bridge

[English](README.md) | **简体中文** | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md)

让 AI agent 在已连接的 VS Code Live Share Guest 工作区中工作。agent 通过本机 MCP server 和本机 Windows 命名管道连接扩展，不开放网络端口。可选的 Host 通道使用 Live Share 转发的 loopback 端口，并带有每个 helper 独立的 token。

## 功能

- 文档／范围读取、受版本保护的批量编辑、只保存目标文件。
- 可选 Host 通道：已保存文件搜索、有界命令、检查后应用文本补丁、保持字节的复制及大文件上传。
- 语言服务符号、定义、引用、重命名和格式化；英文操作与 IPC 接入设置。

不提供递归删除和跨文件原子保存。大文件下载（`transferOpenRead`／`transferRead`）返回 `feature_unavailable`。请用户提供可访问的副本和本地路径，不要用重复的字节读取或原始命令绕过限制；小文件字节读取和大文件上传仍可用。

## 开始使用

需要 Windows、带 Live Share 的 VS Code 1.101+ 和 Node.js。任何支持 MCP stdio server 的 agent 都可以使用本桥接，例如 Claude Code、Codex 或 VS Code 内置 agent。

1. 在 Live Share Guest 窗口安装[扩展](https://marketplace.visualstudio.com/items?itemName=Koha9-Lee.liveshare-workspace-bridge)，并连接共享项目。
2. 运行 **Live Share Workspace Bridge: Copy MCP Server Configuration**，把复制的条目添加到你的 agent。VS Code 内置 agent 会自动发现该 server。
3. 让 agent 调用 `lswb_list_workspaces`，然后开始工作。

[MCP 指南](docs/MCP.zh-CN.md)介绍各 agent 的接入方法、工具列表和结果语义。MCP 是唯一的 agent 接口。

Host 功能需要已连接的共享 RW Windows PowerShell、Host 权限（`host.enabled`，默认关闭）和相应的操作权限；搜索／补丁还需要 Host 上的 ripgrep／Git。共享终端启动一次 Host helper，随后 Host 用桥接显示的端口运行一次 "Live Share: Share Server"。详见[设置说明](docs/SETTINGS.zh-CN.md)。

## 指南

[MCP](docs/MCP.zh-CN.md) | [设置说明](docs/SETTINGS.zh-CN.md) | [使用](docs/USAGE.zh-CN.md) | [API](docs/API.zh-CN.md) | [IPC 接入](docs/IPC-SECURITY.zh-CN.md) | [启动诊断](docs/STARTUP-DIAGNOSTICS.zh-CN.md) | [开发](docs/DEVELOPMENT.zh-CN.md) | [更新记录](docs/CHANGELOG.zh-CN.md)

[MIT](LICENSE)
