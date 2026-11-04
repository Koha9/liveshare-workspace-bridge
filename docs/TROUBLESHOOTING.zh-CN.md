# 故障排查

[English](TROUBLESHOOTING.md) | **简体中文** | [繁體中文](TROUBLESHOOTING.zh-TW.md) | [日本語](TROUBLESHOOTING.ja.md)

[文档](README.zh-CN.md) | [API](API.zh-CN.md)

## 连接与权限

在 Live Share Guest 窗口的 Profile 中安装扩展。更新后重载该窗口，重新连接目标会话，并让 agent 调用 `lswb_list_workspaces`。按根目录名称和完整 vsls URI 选择项目。重载后出现绑定错误时需要重新发现。扩展的 Output 通道会报告管道启动错误。排查桥接的人可以在已安装的扩展目录中运行 `node extension/cli.cjs instances` 或 `diagnose`；agent 使用 MCP 工具。

重载或崩溃的窗口可能留下发现记录。当其管道已不存在且所属进程已退出时，发现结果把该探测报告为 `stale` 并带有 `ownerProcess: "exited"`，不计为失败；如果只剩这类记录，状态为 `no_records`。扩展下次激活时会删除这些记录。

打开 **Live Share Workspace Bridge: Configure Agent Permissions**。agent 权限默认开启；Host 权限（`host.enabled`）默认关闭。检查已配置和实际生效的权限。这些设置由用户控制；agent 不得为绕过拒绝而启用它们。权限变更会阻止新工作，但不撤销已派发的效果。

## 运行中断连与恢复

broken pipe 清理：客户端超时后，失败的迟到响应不再让监听器空转。写入端的清理错误被隔离，断开的连接会被断开，监听器故障时退出而不是空转。真实的 Windows 管道测试覆盖了这一点；尚未确认窗口失去焦点是原因。

之前已 ready 的 IPC 辅助进程退出后，会在 1／2／4 秒后重启，最多三次不稳定重启；ready 运行满一分钟后重置次数。不需要焦点事件或 Host 轮询。启动／策略／访问失败和显式 Stop 不会自动重启。传输恢复保留 instance／epoch、Host 任务和不确定状态，串行化进行中的工作，绝不重放已发送的操作。

如果仍然断开，检查 `lswb_status`（如果是人工排查，可运行一次 CLI `diagnose`）。在任务授权的恢复中，agent 可以在目标 Guest 窗口通过命令面板调用 **Live Share Workspace Bridge: Restart Connection**（`liveshareWorkspaceBridge.restart`）：按 Ctrl+Shift+P，或按 Ctrl+P 后输入 `>`。没有支持的 UI 工具时，只询问用户一次。手动重启会改变 instance／epoch，并使 Host 任务／传输句柄失效；按根目录名称和完整 URI 重新发现一次。Host 不确定状态仍然保留：先确认 Host 已恢复，再回报恢复完成（acknowledgeRecovery）。不要绕过被拒绝的访问、策略失败或有意的 Stop，也不要重放未知结果的修改。IPC 恢复不会重新加入 Live Share，也不会修复缺失的 Host 终端。

## Host 终端缺失或无响应

Host 功能需要一个已连接、可读写的共享 Windows PowerShell 终端；它启动一次 Host helper，然后 Host 用 "Live Share: Share Server" 共享 helper 端口。普通 Guest 终端被排除。终端缺失时，agent 只请求用户设置 Host 一次并等待。存在多个候选时需要配置准确的名称。不重复提示、不猜测终端、不使用其他执行途径。

绑定用自有的临时 bootstrap 文件验证共享根目录。当 `lswb_host_status` 显示 `handshake.state: "waitingForward"` 时，请 Host 共享显示的端口并轮询状态；其他 Host 工具返回 `host_handshake_pending`。如果握手失败或被取消，再次绑定前请 Host 对之前的 helper 按 Ctrl+C。结果未知的已发送修改会隔离通道；不要重放修改。保留回执，检查受影响的目标，等用户确认 Host 空闲或 helper 已重启后，再显式进行 acknowledgeRecovery 绑定。超时详情只包含计数器，不包含捕获的文件内容。

## 编辑与 Host 修改

读取不存在的文件会以 `not_found` 失败；在批量读取中只有该条目失败。受保护的编辑使用当前文档版本。dirty 缓冲区受保护；只有在保留／保存其内容属于任务范围时才包含它们。编辑已应用但目标保存失败时，用返回的版本重试保存，而不是重新应用文本。批量保存是逐文件的，不是事务。

Host 写入可能让已有的 Guest 缓冲区过期或变脏。editor_refresh_pending／external_change_dirty_document 会保留它，而不是全局回退用户的编辑器。请与用户一起处理受影响的缓冲区，或安全地重新打开它；显式的 hostStat withTextHash 只刷新预期的规范化摘要，不刷新编辑器本身。Guest 文本／EOL 与 Host 原始字节不同。Host 的 Git 配置可能把补丁输出转换为 CRLF。

## 搜索与语言工具

Host rg 搜索已保存的文件；达到限制或失败时 complete 为 false，无匹配时退出码 1 是正常的。dirty 缓冲区单独列出，绝不自动保存。快照查询仍是显式且不完整的。语言操作需要语言服务提供者；提供者不可用时报错，空诊断不能证明构建或测试通过。

## 文件操作与限制

覆盖字节需要当前的 Host 原始 SHA-256。目录复制需要新的目标目录，并可能部分失败。未实现递归删除和跨文件原子保存。遇到 response_limit 时，请求相关范围或更少的结果。提供者返回部分文本并不表示支持流式读取。

大文件下载（`transferOpenRead`／`transferRead`）返回 `feature_unavailable`。请用户提供可访问的副本和本地路径，不要用重复的字节读取或原始命令绕过限制；小文件字节读取和大文件上传仍可用。
