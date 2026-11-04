# IPC 接入与迁移

[English](IPC-SECURITY.md) | **简体中文** | [繁體中文](IPC-SECURITY.zh-TW.md) | [日本語](IPC-SECURITY.ja.md)


通过 **Live Share Workspace Bridge: Configure IPC Access** 配置英文 User 设置。只有明确的 User 值控制信任；工作区设置和扩展提供的默认值不能扩大信任。

| 模式 | 桥接所属用户以外的访问范围 |
|---|---|
| ownerOnly | 无；发布默认值。 |
| selectedUsers | 与已保存的 ipc.selectedUserSids 匹配的当前本机用户。 |

所属用户即使是域用户也会保留；额外授权仅限本机用户。远程连接会被拒绝，所有客户端必须与桥接处于同一 Windows session ID。拒绝在域控制器上枚举额外账号。

信任覆盖允许账户的全部进程，不限于某个 agent 任务。桥接调用超出任何 agent 文件系统沙箱的边界，但仍受 agent／操作权限约束。Host 权限是独立的；开启且其他条件满足时，它可能允许 Host 命令。选择器在扩大访问前会发出警告。绝不要把开启更宽的模式当作自动的错误绕过手段。

选择器显示当前名称，但保存 SID。改名后仍保留访问；删除后重建的账户不会按名称继承选择。不可用／无效／非本机的 SID 会被报告且不授权。取消不会改变设置。

## 兼容迁移

当 ipc.accessMode 没有明确的 User 值且旧的 ipc.allowCodexSandboxClients 为 true 时，首次迁移只解析已有的 CodexSandboxOffline／Online 身份，缓存其 SID，并保存 ipc.selectedUserSids 和 selectedUsers。已缓存的 SID 不会按名称重新解析；缺失的账户不增加访问。布尔值无法恢复首次快照之前已删除重建的历史 SID：如有疑问请核对身份。

明确的模式优先于旧标志。false／未设置保持 ownerOnly。不会覆盖含义模糊的手工选择或已观察到的并发修改。旧标志保持兼容，但模式明确后新版本会忽略它；正在运行的旧窗口需要更新／重载才能识别这些模式。

操作权限开关即时作用于后续请求。IPC 信任变更和迁移会写入 User 设置并重启桥接，改变 instance／epoch。请取得必要的部署许可，暂停依赖工作并重新发现。此流程不会改变任何 Host 权限、账户、凭据、ACL 策略或执行策略；已派发的效果不会撤销。

## 已移除的 allLocalUsers 模式

0.3.0 版本移除了 allLocalUsers。agent 通过 MCP server 访问桥接，而 MCP server 由你的 agent 在你自己的 Windows 账户下启动，因此 ownerOnly 已覆盖这条路径。其他账户请使用 selectedUsers。

如果你的 User 设置中仍有 allLocalUsers，桥接不会失败。它按 ownerOnly 运行，每次启动向输出通道写一行提示，并在每个窗口会话中显示一次带 Configure IPC Access 按钮的通知。它不会改写你的设置；请自行修改该值以停止通知。info 和 lswb_status 报告 ipc.mode 为 ownerOnly，同时 ipc.requestedMode 为 allLocalUsers、ipc.deprecatedModeIgnored 为 true。其他任何未知值仍会以设置错误停止桥接。原生辅助程序拒绝 allLocalUsers。

## 设计边界

原生管道使用明确的 SID 授权、拒绝远程、同会话检查、单个持久服务器实例以及有界的输入／响应处理。本机 SAM 枚举拒绝域控制器。这些是当前的约束，不代表每种 Windows 策略、远程主机或账户类型都已测试。访问／错误排查见[启动诊断](STARTUP-DIAGNOSTICS.zh-CN.md)。
