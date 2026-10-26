# Live Share Workspace Bridge v0.2

[English](README.md) | **简体中文** | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md)

v0.2.2：**Configure IPC Access** 提供 ownerOnly（默认）、allLocalUsers 和按稳定 SID 保存的 selectedUsers。旧 true 只迁移原有指定账号，不自动放行全部账号。见 [IPC 三模式](../docs/IPC-SECURITY.zh-CN.md)，Host 权限仍独立。

通过默认仅当前用户可访问的 Windows IPC 读取、编辑和保存共享文档。可选的已验证 Host RW PowerShell 通道提供已保存文件完整搜索、有界命令、经检查的文本补丁、保持字节的复制和分块大文件上传，无需 HTTP 端口或复制 token。

打开 **Live Share Workspace Bridge: Configure Agent Permissions**。英文 User 设置提供 agent 总开关、单项权限和联动终端开关（默认关闭）。状态栏显示权限模式，Host allowed 不代表已验证连接。缺少 Host 终端时 skill 请求用户一次并等待，不用普通 Guest 终端替代。

递归删除和跨文件保存事务不可用。Host 搜索只覆盖已保存文件；文档 EOL 不证明 Host 字节一致。需要未支持步骤时，请用户协助并等待，不能绕过。参见[使用指南](../docs/USAGE.zh-CN.md)、[API](../docs/API.zh-CN.md)、[开发指南](../docs/DEVELOPMENT.zh-CN.md)和[验收记录](../docs/VALIDATION-v0.2.zh-CN.md)。

大文件下载 `transferOpenRead/transferRead`（含 CLI download）本版在 Host 派发前返回 `feature_unavailable`。约 1.1 MB 的实际下载多次使终端停住，等待可靠传输方案；不要循环小块读取绕过。小文件字节读取和大文件上传仍可用。
