# 架构

[English](ARCHITECTURE.md) | **简体中文** | [繁體中文](ARCHITECTURE.zh-TW.md) | [日本語](ARCHITECTURE.ja.md)

[文档](README.zh-CN.md)

## 请求链路

```text
Codex skill or CLI
    → current-user Windows named pipe
    → PowerShell transport process
    → VS Code extension APIs
    → Live Share file provider
```

## 组件

| 组件 | 职责 |
|---|---|
| `extension/extension.cjs` | 激活、通信生命周期、实例发现和工作区 epoch |
| `extension/pipe-host.ps1` | 当前用户的管道权限及 JSON 帧转发 |
| `extension/workspace.cjs` | 固定的文件、文档、搜索和语言操作 |
| `extension/core.cjs` | 路径校验、内容保护、换行处理和编辑规划 |
| `extension/cli.cjs` | 发现、请求传输和 CLI 退出状态 |
| `skills/liveshare-workspace-bridge/` | Codex 使用说明及独立客户端 |

## 工作区绑定

每个 VS Code 窗口都有实例 ID，工作区变化会更新 epoch。请求将所选实例与 epoch 绑定到准确的根 URI，避免旧选择悄然指向另一个同样使用 `vsls:/` 的项目。

发现记录位于 `~/.liveshare-local/instances/`，只保存连接元信息，不是访问令牌。扩展隐藏启动管道辅助进程，该进程随拥有者退出而结束。

## 文档操作

共享 URI 保留 `vsls:` scheme。读取使用当前编辑器缓冲区。批量文本修改统一预检后，以一份 WorkspaceEdit 提交，再逐文档保存；多文件保存不是原子的磁盘事务。

日常操作复用文档版本和保存回执。提供者回读和文本哈希只在明确要求时使用。请求发出后传输失败会保留为结果未知，不自动重放。

## 访问边界

Windows PowerShell 使用显式的当前用户管道 ACL，PowerShell 7 可使用 `CurrentUserOnly`。桥接只开放固定操作，不执行任意 shell 或 VS Code 命令。以同一 Windows 用户运行的其他程序也可访问该接口。

Node 文件系统 API 只处理本机请求文件和发现记录；虚拟资源经 VS Code 和 Live Share 解析。桥接不提供 Host 执行环境。
