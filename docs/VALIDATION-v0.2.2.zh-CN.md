# v0.2.2 候选版验证

[English](VALIDATION-v0.2.2.md) | **简体中文** | [繁體中文](VALIDATION-v0.2.2.zh-TW.md) | [日本語](VALIDATION-v0.2.2.ja.md)


本记录是源码／包验证，不是已安装 v0.2.2 的生产验收。保留已有 v0.2.1 WIP；本轮没有更新已安装扩展、本机 skill 或 User 设置。安装和实际迁移可能重启当前桥接／窗口，等待额外部署确认。

| 证据 | 结果 |
|---|---|
| 本地套件 | Windows 上 53 项测试通过，无跳过；语法、构建、skill 和包校验通过。 |
| 原生策略模拟 | ownerOnly 忽略额外选择；allLocalUsers 只映射给定本机目录；selectedUsers 精确按 SID。改名保留授权；删除后同名重建不继承；非法、组、外域 SID 被拒绝。 |
| 真实本机 API | 成功枚举现有本机 SAM；原生指定账号 DACL 无通用组授权，第二服务器实例和异会话逻辑被拒绝。域控制器拒绝是角色／策略测试，未在真实域控执行。 |
| 迁移／UI 模拟 | 旧 true 只固定两个原有 SID 到 selectedUsers，false 不迁移；缓存 SID 不按改名重解。明确 User 模式优先，工作区／默认值注入不能扩权。取消不写，确认选择保存 SID，不改变 terminal。 |
| 真实跨账号回显 | 已有 CodexSandboxOffline／Online 在 ownerOnly 发送前被拒，在 selectedUsers 按捕获 SID 完成 Unicode 往返；仅用独立自有临时管道，不是已安装 Live Share 扩展。 |
| 未执行 | 未将 allLocalUsers 部署到当前环境；未创建、改名、删除账号；无生产／Host 命令或数据库操作，无机器／域策略修复；尚未进行已安装 v0.2.2 迁移或 Live Share 文件写入验收。 |

v0.2.1 的实际 Live Share 验收仍是历史证据，不能替代新版本安装后验收。未实际修改账号名、登录外域账号、建立第二 Windows 会话或做远程渗透。UI 采用模拟测试，未在当前 VS Code 应用新配置。全部本机账号模式测试的是目录／策略映射，不表示逐个登录全部本机账户验证。

本机部署计划记录两个当前旧账号 SID 和 User 设置哈希，供安装前复核，不能在身份／配置变化后直接套用。首次快照前已删除重建的 SID 无法从旧布尔恢复。确认后应安装 v0.2.2，必要时重载受影响窗口／宿主，核对 selectedUsers 与准确 SID 集合，按需重连目标 Live Share，再做自有目录验收；不新增 Host 权限。

随后补充的针对性回归也已通过：跨进程输出分片的 Unicode 账号名称能够正确解码。
