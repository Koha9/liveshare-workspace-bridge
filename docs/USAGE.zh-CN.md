# 使用指南

[English](USAGE.md) | **简体中文** | [繁體中文](USAGE.zh-TW.md) | [日本語](USAGE.ja.md)

[文档](README.zh-CN.md)

agent 通过 MCP server 使用本桥接。接入方法、完整工具列表和结果语义见 [MCP 指南](MCP.zh-CN.md)。

1. 在已连接 Guest 窗口的 Profile 中安装 VSIX。
2. 运行 **Live Share Workspace Bridge: Copy MCP Server Configuration**，按 [MCP 指南](MCP.zh-CN.md)把 server 添加到你的 agent。VS Code 内置 agent 无需配置即可发现它。
3. 让 agent 调用一次 `lswb_list_workspaces` 并选择目标根目录。其他所有工具都以该根目录准确的 `uri` 作为 `workspace` 参数。
4. 打开 **Live Share Workspace Bridge: Configure Agent Permissions**。agent 权限默认开启；Host 权限（`host.enabled`）默认关闭。用户手动调整英文操作开关。
5. 使用 Host 功能时，请 Host 以读写模式共享一个 Windows PowerShell 终端，并在 Guest 中连接它。桥接只用它启动一次 Host helper；存在多个共享终端时，请设置准确的终端名称（`host.terminalName`）。可以配置明确的 Host 根目录，不猜测路径。
6. 在已授权的任务中让 agent 调用 `lswb_host_status` 和 `lswb_host_bind`。然后 Host 为桥接显示的端口运行 "Live Share: Share Server"，agent 轮询 `lswb_host_status` 直到已绑定。终端缺失时，agent 只询问一次并等待。它绝不在普通 Guest 终端中开始工作，也不绕过设置。

## 文本操作

使用 `lswb_read_file` 或 `lswb_read_many` 并保留版本。相关修改合并为一次 `lswb_edit_file` 请求；检查 `applied`、`saved` 和每个目标的 `dirty` 状态。成功后继续，不额外做全文验证。`lswb_create_file` 用于新文本，`lswb_write_file` 用于受保护的整文档替换，`lswb_save_file` 用于在不重新应用文本的情况下重试失败的保存。

未保存缓冲区受保护；`allowDirty:true` 必须包含保留并保存这些已有编辑的意图。普通文档 EOL 反映 Guest 状态；Host 原始字节是另一份约定。

## 搜索、命令和补丁

`lswb_search` 和 `lswb_find_files` 使用 Host rg，报告完整性、限制和退出码。无匹配时退出码 1 是正常的。已保存文件搜索不覆盖 dirty 缓冲区；不会自动 saveAll。编辑器快照仍是显式且有限的操作。

`lswb_host_exec` 返回带有界输出的任务。用有意义的 waitMs 和输出游标通过 `lswb_host_job_poll` 轮询，不要忙循环；用 `lswb_host_job_cancel` 只取消自有的任务树。报告实际退出码。原始命令需要全部操作权限；权限受限时使用允许的窄工具，不绕过限制。

`lswb_apply_patch`（补丁文本）和 `lswb_apply_patch_file`（本地补丁文件）会检查路径，并在应用文本补丁前执行 Host Git 预检。checkOnly:true 只执行检查。补丁换行行为由 Git 配置决定。不隐含 commit／push。

## 字节和大文件

小量原始数据使用 `lswb_read_bytes`／`lswb_write_bytes`。`lswb_copy` 和 `lswb_copy_dir` 通过 Host 完成，因为 Live Share 文本提供者无法保留任意二进制内容。目录复制需要新的目标目录。较大文件使用 `lswb_upload_file`；不要把整个文件放进一个请求。上传会校验传输 SHA-256。覆盖已有字节文件需要其当前原始哈希。

## 错误与控制

总开关和 Host 开关无需重启即对请求生效，但不撤销已派发的工作。被禁用的权限会被报告，agent 不会修改它们。结果不确定的已发送修改（`transport_outcome_unknown`）需先检查再重试，绝不盲目重放。

Host 写入可能早于 Guest 模型刷新。桥接用目标化的规范化 Host 哈希核对受影响的已打开缓冲区；绝不全局回退编辑器。如果返回 editor_refresh_pending，请保留缓冲区，并使用显式 Host 字节读取或重新打开文档。

API 仍拒绝递归删除，也不保证跨文件原子保存。详细字段、限制和恢复见 [API](API.zh-CN.md) 和 [MCP 指南](MCP.zh-CN.md)。

当任务需要不可用的操作时，agent 应请求用户协助：说明准确的路径和需要的手动结果，然后在依赖工作之前等待。大文件下载需要用户提供可访问的副本；递归删除需要用户确认手动删除。必须原子保存时需要合适的 Host 工具，或明确接受逐文件保存。语言服务缺失和未解决的缓冲区冲突同样需要协助，不强制回退，也不用原始命令绕过。

大文件下载（`transferOpenRead`／`transferRead`）返回 `feature_unavailable`。请用户提供可访问的副本和本地路径，不要用重复的字节读取或原始命令绕过限制；小文件字节读取和大文件上传仍可用。

## 排障 CLI

`extension/cli.cjs` 供人排查桥接问题，不供 agent 使用。它支持 `instances`、`diagnose` 和一次固定绑定的原始 JSON 请求（`--instance ID --epoch N --workspace URI [--request FILE]`）。见[故障排查](TROUBLESHOOTING.zh-CN.md)。
