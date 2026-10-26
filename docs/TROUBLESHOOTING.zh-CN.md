# 故障排查 v0.2

[English](TROUBLESHOOTING.md) | **简体中文** | [繁體中文](TROUBLESHOOTING.zh-TW.md) | [日本語](TROUBLESHOOTING.ja.md)

[文档](README.zh-CN.md)

## 连接与权限

将扩展安装到 Live Share Guest 窗口的 Profile。更新后重载窗口、重新连接目标会话，再运行 CLI `instances`。按根目录名称和完整 `vsls:` URI 选择项目，沿用 instance/epoch/workspace。重载后绑定失效需要重新发现。扩展 Output 通道报告命名管道启动错误。

打开 **Live Share Workspace Bridge: Configure Agent Permissions**。agent 默认开启，共享终端默认关闭；检查配置权限和有效权限。开关由用户控制，agent 不自行启用来绕过拒绝。更改只阻止新工作，不撤销已派发副作用。

## Host 终端缺失或无响应

Host 功能需要已连接的共享 RW Windows PowerShell，普通 Guest 终端不合格。缺少时 skill 只请求用户开启并共享一次，然后等待；多个候选需要准确名称，不猜测或逐个尝试，不切换执行路线。用户确认后验证一次，仍失败就报告并等待，不反复提示或轮询。

绑定通过自有随机 bootstrap 临时文件验证根目录。已发送请求超时后通道隔离，不能重放修改。保留回执、检查目标状态，等待用户确认终端空闲或已重启，再以 `acknowledgeRecovery:true` 显式重新绑定。超时诊断只有计数，不包含捕获的文件内容。

实际大文件下载曾使终端停住，本版已禁用；不循环字节读取模拟。大文件上传和有界字节 API 有实测证据。新增输出节流尚未证明可修复持续下载。需要下载时请用户提供可访问副本和本地路径。

## 编辑与 Host 修改

使用当前版本进行受保护编辑，保留既有未保存内容。已应用但保存失败时，用返回版本只重试 `save`，不重新应用整批文本。批量保存逐文件完成，不是事务。

Host 写入可能留下过期或 dirty 的 Guest 缓冲区。`editor_refresh_pending/external_change_dirty_document` 用于保护内容，不全局回退。请用户解决冲突或安全重新打开文件。`hostStat` 的 `withTextHash:true` 只刷新预期规范化摘要，不刷新编辑器。不要保存已知过期文本。Guest 文本／EOL 与 Host 原始字节不同；Host Git 可能将补丁结果转成 CRLF。

## 搜索与语言工具

Host rg 搜索已保存文件；超限或失败时 complete 为 false，无匹配退出码 1 正常。dirty 文档单独报告且不自动保存。编辑器搜索快照仍不完整。语言工具需要提供者，缺失时请用户启用或协助处理；空诊断不能证明构建或测试通过。

## 文件与其他限制

字节覆盖需要当前 Host 原始 SHA-256。目录复制只允许新目标，失败可能留下部分目录。递归删除请用户完成并确认；跨文件原子保存请使用合适 Host 工具，或由用户明确接受逐文件语义。对每个未解决步骤请求一次协助，说明准确路径和目标结果，等待回复后再继续依赖工作；不能静默跳过或用原始命令绕过。

遇到 `response_limit` 时请求相关范围或更少结果。提供者的局部文本响应不代表底层流式读取。参见 [API](API.zh-CN.md) 与[验收记录](VALIDATION-v0.2.zh-CN.md)。
