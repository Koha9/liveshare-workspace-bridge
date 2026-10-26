# 使用指南 v0.2

[English](USAGE.md) | **简体中文** | [繁體中文](USAGE.zh-TW.md) | [日本語](USAGE.ja.md)

v0.2.2：**Configure IPC Access** 提供 ownerOnly（默认）、allLocalUsers 和按稳定 SID 保存的 selectedUsers。旧 true 只迁移原有指定账号，不自动放行全部账号。见 [IPC 三模式](IPC-SECURITY.zh-CN.md)，Host 权限仍独立。

[文档](README.zh-CN.md)

1. 在已连接 Guest 窗口的 Profile 安装 VSIX，并安装匹配的 skill。
2. 发现一次目标项目，后续固定 `instance`、`epoch` 和完整 `workspace` URI。
3. 打开 **Live Share Workspace Bridge: Configure Agent Permissions**。agent 默认开启，终端默认关闭；用户手动调整英文操作开关。
4. 使用 Host 功能时，请 Host 共享可读写 Windows PowerShell，并在 Guest 连接。多个共享终端需要指定准确名称。可显式配置 Host 根目录，不猜测路径。
5. 在授权任务中调用 `hostStatus`／`hostBind`。终端缺失时只请求用户一次并等待，不使用普通 Guest 终端或绕过设置。

## 文本操作

使用 `read`／`readMany` 并保留版本；相关修改合并到一次 `edit`，检查 `applied`、`saved` 和每个目标的 dirty 状态。成功后不默认追加全文验证。`create` 用于新文件，受保护的 `write` 用于整文档替换；保存失败只重试 `save`，不要重新应用编辑。

未保存缓冲区默认受保护；`allowDirty:true` 必须包含保留并保存已有编辑的意图。文档 EOL 反映 Guest 状态，与 Host 原始字节是不同保证。

## 搜索、命令和补丁

`search`／`findFiles` 通过 Host rg 搜索，报告完整性、限制和退出码；无匹配的退出码 1 正常。它们只覆盖已保存文件，不覆盖 dirty 缓冲区，不自动 `saveAll`。编辑器快照是显式且不完整的独立接口。

`hostExec` 返回有界输出的任务。使用有意义的 `waitMs` 和输出游标轮询，避免忙循环；取消只作用于自有进程树。报告实际退出码。原始命令要求全部操作权限；受限时只使用符合任务的已允许窄接口，不绕过限制。已知文件修改应声明 `affectedPaths`，任意其他副作用不会自动追踪。

`applyPatch` 校验路径并先执行 Host Git 检查，`checkOnly:true` 只检查不应用。补丁行尾受 Host Git 配置影响；不隐含 stage、commit 或 push。

## 字节和大文件

小数据用 `readBytes`／`writeBytes`。复制由 Host 完成，因为 Live Share 文本提供者不能保证二进制字节。目录复制目标必须是新目录。大文件用 CLI `upload`，不要将整个文件塞入一个 JSON 请求。上传校验 SHA-256；覆盖现有文件需要当前原始字节哈希。

大文件下载本版禁用，`transferOpenRead`／`transferRead` 返回 `feature_unavailable`。约 1.1 MB 的实际下载曾使共享终端停住；不循环小块读取绕过。小文件字节读取和大文件上传仍可用。

## 错误、控制与用户协助

总开关和终端开关即时约束后续请求，不撤销已经派发的工作。agent 报告权限拒绝，不自行启用。结果未知的已发送修改必须先检查状态，不能盲目重放。

Host 写入可能早于 Guest 模型刷新。插件只对受影响的已打开缓冲区进行规范化文本哈希核对，不全局回退编辑器。出现 `editor_refresh_pending` 或 `external_change_dirty_document` 时保留内容，必要时请用户解决冲突或安全重新打开文件。

递归删除和跨文件原子保存不可用。skill 对每个未解决步骤请求一次用户协助，说明准确路径和需要的结果，并等待回复：大文件下载请提供可访问副本；递归删除请确认用户手动删除；原子保存请使用合适 Host 工具，或明确接受逐文件保存。语言服务缺失和持续缓冲区冲突也请用户处理，不用原始命令绕过。独立且受支持的工作可以继续。

参数和限制见 [API](API.zh-CN.md)，恢复说明见[故障排查](TROUBLESHOOTING.zh-CN.md)，测试边界见[验收记录](VALIDATION-v0.2.zh-CN.md)。
