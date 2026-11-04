# 架构

[English](ARCHITECTURE.md) | **简体中文** | [繁體中文](ARCHITECTURE.zh-TW.md) | [日本語](ARCHITECTURE.ja.md)

[文档](README.zh-CN.md)

- extension.cjs 负责本机 IPC（默认仅所属用户）、生命周期和英文权限状态。
- registry-cleanup.cjs 在激活时运行，删除已退出窗口留下的发现记录（按文件名、id、pid 和管道名匹配）；链接和其他文件不受影响。cli.cjs 中的发现逻辑把这类记录报告为 `stale` 探测。
- permissions.cjs 是请求授权层；它在派发和 Host 发送之前读取实时的 User／machine 设置。agent 接口不能更改权限。
- workspace.cjs 负责文档版本、dirty 缓冲区检查、文本预检、语言编辑和目标保存。Host 修改之后保留受影响模型的保护，直到规范化内容匹配。
- host-channel.cjs 串行化 Host 请求，通过共享终端启动一次 Host helper（用随机 bootstrap 文件验证），在后台等待转发端口，并通过 loopback TCP（host-transport-tcp.cjs）发送每个请求，附带每个 helper 独立的 token 和 nonce。host-terminal.cjs 选择共享 RW 终端；host-bootstrap.cjs 渲染 helper 并读取其监听横幅。不会向终端输入任何请求。
- host-operations.cjs 把公开 API 映射为窄 Host 操作，并把任务／传输绑定到根目录和 epoch。
- host-server.ps1 是前台内存中的 Host helper；它内嵌 host-core.ps1（Host 操作）。host-runtime.cs 提供自有的 Windows Job Object、有界输出排空、分块字节句柄、SHA-256 和过期管理。不安装常驻 Host agent；helper 只监听 loopback，并在按 Ctrl+C、关闭终端、会话结束或空闲超时时退出。
- mcp-server.cjs 是 stdio MCP 协议层（initialize、tools/list、tools/call）。它只向 stdout 写协议帧。
- mcp-tools.cjs 定义 MCP 工具表。它通过 cli.cjs 的传输把 Guest、Host 和本地文件工具映射为桥接操作，并维护根 uri 到 instance／epoch 的绑定。未知的传输结果会被报告，绝不重放。
- mcp-launcher.cjs 是自包含的启动器，扩展把它安装到 `~/.liveshare-local/mcp-server.cjs`（通过 mcp-launcher-install.cjs，它同时渲染 Copy MCP Server Configuration 的配置片段）。它根据存活的发现记录启动 mcp-server.cjs（先选 server 文件最新的，再选记录最新的），因此 agent 配置在升级后仍然有效。
- mcp-definition-provider.cjs 向 VS Code 注册 mcp-server.cjs（`vscode.lm.registerMcpServerDefinitionProvider`），使内置 agent 能发现它。
- cli.cjs 是给人用的排障 CLI（instances、diagnose、固定绑定的原始 JSON 请求），也是 mcp-tools.cjs 用于发现、请求和分块上传的本机传输库。agent 不直接调用它。

文本编辑默认仍走文档路径，每次保存后不重复读取提供者。可选的 Host 路径负责完整的已保存文件搜索、命令、补丁以及字节／目录操作。原始 Host 执行需要全部操作权限；窄操作仍可分别控制。这些检查不是针对任意脚本的操作系统沙箱。

撤销权限不会回滚已派发的工作。子任务保留有界超时；同步文件系统操作可能在 Guest 响应超时之后仍然完成。未知结果不会重试。传输有空闲过期和自有的临时暂存；目录复制可能部分失败。不提供递归删除或多文件磁盘事务。

`pipe-security.cs` / `pipe-host.ps1`：明确的 owner／沙箱 DACL、本机／会话门禁、持久的单实例管道、有界 UTF-8 输入和响应排空。

`local-accounts.cs` 只枚举本机 SAM 用户并选择稳定 SID；`ipc-access.cjs` 负责仅限 User 的模式解析、一次性旧 SID 迁移和英文账号选择器。

大文件下载（`transferOpenRead`／`transferRead`）返回 `feature_unavailable`。请用户提供可访问的副本和本地路径，不要用重复的字节读取或原始命令绕过限制；小文件字节读取和大文件上传仍可用。
