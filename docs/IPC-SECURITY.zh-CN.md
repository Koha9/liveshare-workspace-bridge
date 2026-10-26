# IPC 三模式接入 v0.2.2

[English](IPC-SECURITY.md) | **简体中文** | [繁體中文](IPC-SECURITY.zh-TW.md) | [日本語](IPC-SECURITY.ja.md)


## 模式与范围

运行 **Live Share Workspace Bridge: Configure IPC Access**，或修改英文 User 设置 `liveshareWorkspaceBridge.ipc.accessMode`。只有明确的 User 值能决定信任；工作区配置和扩展贡献的默认值不能扩大范围。

| 模式 | 桥接所属用户以外的授权 |
|---|---|
| ownerOnly | 无，发布默认值。 |
| allLocalUsers | 当前本机 SAM 中的所有用户账户，包括已禁用账户（其旧进程仍可能存在）；不是 Everyone、Authenticated Users、本机组或域用户。 |
| selectedUsers | 只允许 ipc.selectedUserSids 保存的准确 SID，且该 SID 仍属于当前本机用户。 |

桥接所属用户始终保留，即使 VS Code 本身由域用户运行；额外授权仅限本机用户。三种模式都拒绝远程连接，且要求相同 Windows 会话。这里检查 Windows session ID，不承诺不同 run-as 令牌具有相同 logon SID。域控制器上拒绝额外本机用户枚举，避免把域 SAM 当作本机账号。

信任的是账户下的全部进程，不只 Codex 或单个任务。调用超出 Codex 文件系统沙箱边界，仍受 agent 与操作开关约束。Host／terminal 权限独立，本配置绝不启用它；如果 terminal.enabled 原本为 true 且其他条件满足，被允许的账户也可能执行 Host 命令。模式选择器在扩大权限前显示该警告。

账号选择器显示当前名称和 SID，实际保存 SID 字符串。改名后授权仍有效。删除的本机 SID 保留为不可用引用，不予放行；同名重建的新账号 SID 不同，必须重新明确选择。非法 SID、通用组和非本机 SID 会出现在 ipc.selectionIssues，不会被授权。打开选择器不改设置，取消不产生变更。

allLocalUsers 在桥接启动时枚举本机 SAM；新增账号在重启桥接后纳入。不创建、启用或改名任何账号，不修改机器／域策略、凭据或网络映射。

## 旧配置兼容

若新模式未设置且旧 ipc.allowCodexSandboxClients 为 true，首次启动只解析已有两个旧账号名，缓存 SID，写入 ipc.selectedUserSids，再设为 selectedUsers，绝不自动转为 allLocalUsers。固定后重启不再按名称解析。旧账号缺失时不猜其他名称；空结果不增加授权。旧布尔没有历史 SID，因此首次快照前若账号已删除重建，无法从布尔还原原身份；有疑问时必须核对迁移计划／当前身份。

明确的新模式（包括 ownerOnly）优先于旧布尔。旧值 false／未设置时保持 ownerOnly，不迁移。模糊的手工 SID 列表和观察到的并发配置修改不会被覆盖。旧布尔保留兼容，但新模式明确后 v0.2.2 忽略它；未重载的旧版窗口仍按旧规则运行，不能把新模式当作旧窗口的控制开关。

迁移会写入 User 设置。策略变化重启本机桥接并改变 instance/epoch，之后重新发现；不主动重载 VS Code、不打开 Host，也不撤销已派发工作。未知结果的已发送修改不能重放。安装升级可能另需重载扩展宿主／窗口并重新连接 Live Share；影响当前连接前应取得部署确认。

## 诊断与实现

```powershell
node "<client>" diagnose
node "<client>" instances
```

diagnose 只读取注册目录并探测 info，不绑定 Host、不写共享文件。区分 ready、partial、no_records、no_shared_workspace、access_denied、unavailable、invalid_registry。无关过期／拒绝记录与健康目标可并存；EPERM/EACCES 不证明扩展未启用。检查模式和 SID 问题，不自行扩大授权、关闭沙箱或自动选择 allLocalUsers。

原生层用本机 NetUserEnum／NetUserGetInfo 枚举 SAM 并检查机器角色。保留明确 DACL、远程拒绝、同会话检查、单个持久 FIRST_PIPE_INSTANCE、有界 UTF-8 输入和响应排空。不模拟客户端、不增加 HTTP 端口或复制 token。[v0.2.2 验证](VALIDATION-v0.2.2.zh-CN.md)区分策略模拟、真实跨账号测试和待部署项目。
