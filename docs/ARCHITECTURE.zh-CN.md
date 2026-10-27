# 架构

[English](ARCHITECTURE.md) | **简体中文** | [繁體中文](ARCHITECTURE.zh-TW.md) | [日本語](ARCHITECTURE.ja.md)

[文档](README.zh-CN.md)

## 模块职责

- `extension.cjs`：当前用户 IPC、生命周期和英文权限状态栏。
- `permissions.cjs`：请求授权层，在派发和 Host 发送前读取实时 User/machine 设置；agent 接口不能更改权限。
- `workspace.cjs`：文档版本、dirty 保护、文本预检、语言编辑和目标保存。Host 修改后保留模型保护，直到规范化内容匹配。
- `host-channel.cjs`：串行共享终端请求，以随机 bootstrap 文件核对根目录，通过 nonce 和显式结束标记封装响应；大输入在收到准备确认后走不回显控制台路径。
- `host-operations.cjs`：公开 API 到窄 Host 操作的映射，将任务／传输绑定到 root 和 epoch。
- `host-actions.ps1`：加载内存中的 Host 会话辅助程序；`host-runtime.cs` 提供 Windows Job Object、有界输出排空、分块字节句柄、SHA-256 和空闲过期。不安装常驻 Host agent 或 HTTP 服务。
- `cli.cjs`：唯一规范客户端，构建时复制到 skill；支持 JSON、文本补丁和分块上传。保留的下载入口由本版服务端能力门禁拒绝。

## 文档路径与 Host 路径

文本编辑默认使用文档 API，成功保存后不重复读取提供者。可选 Host 通道负责已保存文件搜索、命令、补丁、字节和目录操作。原始 Host 执行需要全部操作权限；窄接口分别授权。这不是任意脚本的操作系统沙箱。

共享 URI 保留 `vsls:`，不能交给 Node 本机文件系统。实例、epoch 和根目录构成绑定，工作区改变时旧任务资源不能用于新项目。客户端不自动重放已发送但结果未知的修改。

## 撤销、故障与限制

撤销权限阻止新工作，不回滚已派发工作。子任务保留超时；同步文件系统操作可能在 Guest 响应超时后仍完成。传输临时资源有空闲过期；目录复制可能部分失败。没有递归删除或跨文件落盘事务。

Host 写入可能早于 Guest 刷新。插件仅核对受影响的已打开文档，内容未匹配或缓冲区变脏时保留并报错；不全局回退。skill 请求用户协助处理持续冲突和其他未支持步骤，等待确认后再继续依赖工作。

`pipe-security.cs` / `pipe-host.ps1`: 明确 owner／沙箱 DACL、本机与会话门禁、持久单实例管道、有界 UTF-8 输入及响应排空。

`local-accounts.cs` 只枚举本机 SAM 用户并按稳定 SID 选择；`ipc-access.cjs` 负责仅 User 的模式解析、一次旧 SID 迁移和英文账号选择器。

大文件下载（`transferOpenRead`／`transferRead`，含 CLI download）返回 `feature_unavailable`。请用户提供可访问副本和本地路径，不循环小块读取或用原始命令绕过；小文件字节读取和大文件上传仍可用。
