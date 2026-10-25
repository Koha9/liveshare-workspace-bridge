# 故障排查

[English](TROUBLESHOOTING.md) | **简体中文** | [繁體中文](TROUBLESHOOTING.zh-TW.md) | [日本語](TROUBLESHOOTING.ja.md)

[文档](README.zh-CN.md)

## 没有实例或共享根目录

将扩展安装到 Live Share Guest 窗口使用的 Profile，更新后重载窗口，连接目标会话，再运行 CLI 的 `instances`。本地 VS Code 窗口可能有实例但 `roots` 为空。按项目名和完整 `vsls:` URI 选择 Guest 条目。连接停止时使用 **Live Share Workspace Bridge: Restart Connection**；同名输出通道记录管道启动错误。

从早期本地包迁移时，卸载 `ucuni-local.liveshare-workspace-tools` 或 `Koha9-Lee.liveshare-workspace-tools`，安装 `Koha9-Lee.liveshare-workspace-bridge`，并重载受影响的窗口。VS Code 将改名后的扩展视为独立安装，不应同时运行新旧扩展。若曾配置 PowerShell 路径，请将其转移到 `liveshareWorkspaceBridge.powershell`。

## 绑定、编辑与保存

重载会改变实例 ID，工作区变化会更新 epoch。绑定错误后重新发现并选择项目。遇到 `content_changed`，只重读受影响文本，按当前版本调整编辑。默认保护 dirty 文档，只有明确希望包含其未保存改动时才允许编辑。

编辑已应用仍可能保存失败。检查逐文件保存结果和 dirty 状态；需要时仅用回执版本重试 `save`。传输失败且 `requestSent:true` 表示结果未知，应先核对受影响目标，不能盲目重放修改。

## 搜索与语言结果

内容搜索返回 `complete:null` 的搜索视图快照，没有完成信号。文件名搜索可能遗漏新文件，空结果不能证明不存在；已知路径可直接读取。语言查询依赖项目语言提供者，空诊断不代表构建或测试通过。

## 文本、原始字节与大小限制

文档编辑保留 Guest 缓冲区的换行风格。Live Share 可能在 Host 保存时规范化换行，因此 Guest 文本或 `providerRead` 不能证明 Host 原始字节、编码或换行完全一致。本版本不提供通用二进制写入、目录复制、递归删除或 Host shell。

遇到 `response_limit`，减少请求的行数或文件数。局部返回不代表底层提供者流式读取文件。详见 [API 限制](API.zh-CN.md)和[使用指南](USAGE.zh-CN.md)。
