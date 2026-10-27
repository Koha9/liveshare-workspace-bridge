# IPC 接入与迁移

[English](IPC-SECURITY.md) | **简体中文** | [繁體中文](IPC-SECURITY.zh-TW.md) | [日本語](IPC-SECURITY.ja.md)


通过英文 User 设置及 **Live Share Workspace Bridge: Configure IPC Access** 配置。仅明确 User 值控制信任，工作区配置和扩展默认值不能扩权。

| 模式 | 桥接所属用户以外的范围 |
|---|---|
| ownerOnly | 无，发布默认。 |
| allLocalUsers | 当前本机 SAM 用户，包括可能仍有进程的已禁用账号；不是 Everyone、组或全部域用户。 |
| selectedUsers | 精确匹配 ipc.selectedUserSids 的当前本机用户。 |

所属用户即使是域用户也保留；额外授权只限本机用户。拒绝远程连接，客户端必须与桥接同 Windows session ID。域控制器拒绝额外账号枚举。全部本机用户集合在桥接启动时刷新，不创建或监控账号。

信任账户下全部进程，不限一个 Codex 任务；调用超出 Codex 文件系统沙箱，仍受 agent／操作权限约束。Host 权限独立，已开启且其他条件满足时可能允许 Host 命令。选择器扩大授权前会警告；禁止自动选更宽模式绕过错误。

界面显示当前名称，保存 SID。改名保留授权；删除重建不按同名继承。不可用、非法、非本机 SID 会报告且不放行，取消不改设置。

## 兼容迁移

ipc.accessMode 没有明确 User 值且旧 ipc.allowCodexSandboxClients 为 true 时，首次只解析已有 CodexSandboxOffline／Online，缓存其 SID，写入 ipc.selectedUserSids 和 selectedUsers，不选 allLocalUsers。固定后不按名称重解，缺失账号不增加授权。旧布尔无法恢复首次快照前已删除重建的历史 SID，有疑问先核对身份。

明确新模式优先，旧 false／未设置保持 ownerOnly。不覆盖模糊手工选择或已观察到的并发变更。旧布尔保留兼容，但新模式明确后新版忽略它；旧窗口需要更新／重载才识别新模式。

操作权限即时约束后续请求；IPC 信任变化／迁移写 User 设置并重启桥接，改变 instance/epoch。取得必要部署许可，暂停依赖工作并重新发现。不因此开启 Host、创建账号／凭据或调整 ACL／执行策略；已派发效果不回滚。

## 设计边界

原生管道采用明确 SID、远程拒绝、同会话、单个持久服务器实例和有界输入／响应。SAM 枚举拒绝域控制器。这些是现行边界，不表示所有 Windows 策略、远端或账户类型均已验证。错误排查见[启动诊断](STARTUP-DIAGNOSTICS.zh-CN.md)。
