# 更新记录

[English](CHANGELOG.md) | **简体中文** | [繁體中文](CHANGELOG.zh-TW.md) | [日本語](CHANGELOG.ja.md)

- 0.3.0
  - 升级注意事项：`terminal.*` 设置已改为 `host.*`；新键未设置时，旧键的 User 值仍会读取一个版本，设置不会被改写，请自行改名。已保存的 `allLocalUsers` IPC 模式按 ownerOnly 运行，并提示一次。Codex skill 已移除：请用 **Copy MCP Server Configuration** 把 MCP server 添加到你的 agent。Host 功能现在需要 Host 为桥接显示的 helper 端口运行一次 "Live Share: Share Server"。需要 VS Code 1.101 或更高版本。
  - 新增：MCP stdio server，提供 36 个 `lswb_` 工具，随 VSIX 发布（`mcp-server.cjs`、`mcp-tools.cjs`）；固定路径启动器 `~/.liveshare-local/mcp-server.cjs`，跟随当前运行的扩展版本；以及 **Copy MCP Server Configuration** 命令。复制的配置使用正斜杠路径。若打包的模块 require 了未打包的文件，构建会失败。新增 [MCP 指南](MCP.zh-CN.md)。
  - 新增：扩展通过 `vscode.lm.registerMcpServerDefinitionProvider` 向 VS Code 注册其 MCP server，内置 agent 可自动发现。
  - 新增：经 Live Share 转发端口的 Host 通道。共享终端启动一次前台内存中的 Host helper，请求通过转发的 loopback 端口发送，并带有每个 helper 独立的 token。新设置 `host.guestPort`、`host.idleTimeoutMinutes` 和 `host.handshakeTimeoutMinutes`。新错误码 `host_transport_unavailable`、`host_request_too_large`、`host_bind_cancelled`、`host_port_forward_required` 和 `host_port_unavailable`。
  - 新增：Host helper 开始监听后 `hostBind` 立即返回 `waitingForward`（附带 `hostPort` 和 `next`），转发端口握手在后台完成。`hostStatus` 像 `info` 一样绕过派发队列，并报告 `handshake.state` 和 `handshake.code`。握手完成前，其他 Host 请求返回新的 `host_handshake_pending`。
  - 新增：扩展激活时删除已退出窗口留下的发现记录（按名称、id、pid 和管道名匹配；链接和其他文件不受影响）。
  - 新增：info 和 lswb_status 报告 ipc.requestedMode 和 ipc.deprecatedModeIgnored。
  - 变更：最低 VS Code 版本为 1.101。
  - 变更：激活事件限定为 `onFileSystem:vsls` 和 `onStartupFinished`，不再使用 `*`。
  - 变更：`terminal.*` 设置重命名为 `host.enabled`、`host.terminalName`、`host.workspacePath`、`host.commandTimeoutMs` 和 `host.maxOutputCharacters`；新键未设置时旧的 User 值仍会读取一个版本，设置绝不被改写。错误码 `terminal_access_disabled` 改为 `host_access_disabled`，info.permissions 报告 `hostEnabled` 而不是 `terminalEnabled`。
  - 移除：共享终端数据传输。共享 Host 终端只用于启动一次 Host helper，所有 Host 请求都使用 Live Share 转发端口。`host.transport` 设置已移除；已保存的 `sharedTerminal` 值按 portForward 运行，并在输出通道写一行提示。
  - 移除：Codex skill；agent 通过 MCP server 连接。CLI 保留 instances／diagnose／原始请求用于排障。
  - 移除：allLocalUsers IPC 接入模式；只保留 ownerOnly 和 selectedUsers。已保存的 allLocalUsers 值按 ownerOnly 运行，每个窗口会话显示一次通知，且不会被改写。见 [IPC 接入](IPC-SECURITY.zh-CN.md)。
  - 修复：read 和 readMany 对不存在的文件报告 `not_found`，而不是通用的 `vscode_error`；在 readMany 中只有该条目失败，其他文件仍会返回。
  - 修复：重载或崩溃窗口留下的发现记录不再使发现结果变为 `partial`。管道已不存在且所属进程已退出的记录被报告为 `stale` 探测，带有 `ownerProcess: "exited"`（CLI 发现结果还会计入 `staleRecordCount`）；如果只剩这类记录，状态为 `no_records`。

- 0.2.4 — 修复 broken pipe 清理，增加有限自动重连，保留 Host 不确定状态，并行发现和 agent 重启指引。

- 0.2.3 — 本机启动摘要、安全 shell 元数据、当前／历史状态区分。

- 0.2.2 — 所属用户／本机用户／指定 SID 接入及旧设置迁移。

- 0.2.1 — 明确的发现错误和本机 IPC 帧处理。

- 0.2 — 可选 Host 搜索、任务、文本补丁、字节及上传。
