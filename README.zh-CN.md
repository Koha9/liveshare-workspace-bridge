# Live Share Workspace Bridge

[English](README.md) | **简体中文** | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md)

通过本机 Windows IPC 操作已连接的 VS Code Live Share Guest 工作区，无需 HTTP 端口或复制 token。

## 功能

- 文档／范围读取、受版本保护的批量编辑、只保存目标文件。
- 可选 Host 通道：已保存文件搜索、有界命令、检查后应用文本补丁、保持字节的复制及大文件上传。
- 语言服务符号、定义、引用、重命名和格式化；英文操作与 IPC 接入设置。

不提供递归删除和跨文件原子保存。 大文件下载（`transferOpenRead`／`transferRead`，含 CLI download）返回 `feature_unavailable`。请用户提供可访问副本和本地路径，不循环小块读取或用原始命令绕过；小文件字节读取和大文件上传仍可用。

## 开始使用

需要 Windows、VS Code Live Share 和 Node.js。

1. 在 Live Share Guest 窗口安装[扩展](https://marketplace.visualstudio.com/items?itemName=Koha9-Lee.liveshare-workspace-bridge)，并连接共享项目。
2. 让 agent 从 [Releases](https://github.com/Koha9/liveshare-workspace-bridge/releases) 安装与扩展版本匹配的 skill。
3. 让 agent 使用 `$liveshare-workspace-bridge` 开始工作。

Host 功能需已连接的共享 RW Windows PowerShell 和相应权限，搜索／补丁还需 Host ripgrep／Git；终端权限默认关闭。详见[设置说明](docs/SETTINGS.zh-CN.md)。

## 指南

[设置说明](docs/SETTINGS.zh-CN.md) | [使用](docs/USAGE.zh-CN.md) | [API](docs/API.zh-CN.md) | [IPC 接入](docs/IPC-SECURITY.zh-CN.md) | [启动诊断](docs/STARTUP-DIAGNOSTICS.zh-CN.md) | [开发](docs/DEVELOPMENT.zh-CN.md) | [更新记录](docs/CHANGELOG.zh-CN.md)

[MIT](LICENSE)
