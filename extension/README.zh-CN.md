# Live Share Workspace Tools

[English](README.md) | **简体中文** | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md)

通过 Windows 命名管道，让 Codex 或随附 CLI 读取、编辑和保存已连接的 Live Share Guest 工作区中的文件。

- 无需 HTTP 监听端口、复制令牌、npm 运行时依赖或 Host 安装。
- 支持缓冲区读取、多文件编辑、定向保存、文件操作、诊断和语言查询。
- 原生内容搜索返回快照；文件名搜索可能遗漏新文件。

安装到 Guest 窗口使用的 Profile，更新后按 VS Code 提示重载窗口。

命令：

- `Live Share Workspace Tools: Restart Connection`
- `Live Share Workspace Tools: Stop Connection`

详见[使用指南](../docs/USAGE.zh-CN.md)、[API 参考](../docs/API.zh-CN.md)和[故障排查](../docs/TROUBLESHOOTING.zh-CN.md)。

该管道对同一 Windows 用户运行的程序可用，不提供 Host shell，也不隔离同用户程序。

本项目采用 MIT 许可证。详见 [LICENSE](../LICENSE)。
