# 设置说明

[English](SETTINGS.md) | **简体中文** | [繁體中文](SETTINGS.zh-TW.md) | [日本語](SETTINGS.ja.md)

本文对应当前仓库 schema；已安装发布版的命令／字段可能不同，应以其版本、Settings UI 与匹配资产为准。下表均省略前缀 liveshareWorkspaceBridge.，schema scope 为 machine（按 VS Code 允许的 User／Remote 设置，不是 Workspace／Folder）。UI 扩展运行在 Windows Guest，改 Host 机器设置不是同一件事。IPC 信任只读明确 User global 值，忽略工作区与扩展默认覆盖。

## 通用、IPC 与 Host 参数

| 设置（省略前缀） | 类型／默认／范围 | 作用与安全后果 | 生效方式 |
|---|---|---|---|
| `agent.enabled` | `boolean` / `true` | 工作区操作总开关。info／hostStatus 及安全诊断元数据仍可检查；关闭不回滚已派发效果。 | 后续请求即时生效；同时使 Host 绑定／资源引用失效。 |
| `terminal.enabled` | `boolean` / `false` | 允许依赖 Host 的 API，仍需单项权限及已验证的共享 RW 终端。绑定可能创建／删除自有 bootstrap 临时文件；不会把普通 Guest shell 当 Host。 | 后续请求即时生效；同时使 Host 绑定／资源引用失效。 |
| `powershell` | `string` / `""` | Guest 本机 IPC／账号辅助进程的 PowerShell 路径覆盖；空值用系统 Windows PowerShell。不选择 Host 终端 shell，也不改变执行策略。 | 下次本机桥接启动使用，不自动切换正在运行的辅助进程。 |
| `ipc.accessMode` | `string` / `"ownerOnly"` | ownerOnly／allLocalUsers／selectedUsers。所属用户始终保留；额外账户仅当前本机 SAM 用户且同 Windows session ID，不是 Everyone、组或全部域用户，域控拒绝枚举。信任其全部进程，调用超出 Codex 文件系统沙箱，仍受桥接权限约束。 | 重启 IPC 桥接、改变实例与 epoch，需重新发现。 |
| `ipc.selectedUserSids` | `array` / `[]` | 仅 selectedUsers 使用的稳定 SID，其他模式不据此授权。唯一列表、最多 256 字符串；UI 检查本机用户 SID 格式，运行时还限制每项 184 字符并验证 SAM 成员。名称只供显示，改名不影响，删除重建不替换。 | 重启 IPC 桥接、改变实例与 epoch，需重新发现。 |
| `ipc.allowCodexSandboxClients` | `boolean` / `false` | 废弃兼容项。无明确 User 模式时，true 把原有两个沙箱身份按 SID 固定到 selectedUsers，false／未设置保持 ownerOnly；明确模式优先。绝不自动 allLocalUsers 或开启 Host。首次迁移写 User 设置，布尔无法恢复快照前已删重建的历史 SID。 | 重启 IPC 桥接、改变实例与 epoch，需重新发现。 |
| `terminal.name` | `string` / `""` | 准确的目标共享终端名；空值要求唯一合格共享 PTY。仍检查只读提示并验证绑定；标题不证明实际 shell／版本。 | 使 Host 绑定失效，下次允许的 Host 调用重绑。 |
| `terminal.hostWorkspacePath` | `string` / `""` | 可选的明确 Host 根目录；空值核对共享 PowerShell 当前目录与 Guest 根。是 Host 路径，不是 Guest 本机路径；hostBind 请求参数可覆盖。 | 使 Host 绑定失效，下次允许的 Host 调用重绑。 |
| `terminal.commandTimeoutMs` | `integer` / `120000` / 1000..3600000 | Host 子命令默认超时，单位毫秒；hostExec 的 timeoutMs 可在合法范围覆盖。已启动任务保留原截止时间；不是全部 IPC／握手超时。 | 使 Host 绑定失效，下次允许的 Host 调用重绑。 |
| `terminal.maxOutputCharacters` | `integer` / `65536` / 1024..262144 | stdout 和 stderr 各自保留的字符上限；超出仍排空并标 truncated，不能当完整输出。 | 使 Host 绑定失效，下次允许的 Host 调用重绑。 |
| `transfer.chunkBytes` | `integer` / `32768` / 1024..65536 | 单块原始字节／小字节 API 上限。Guest 预检与 Host 会话均使用；更改会使绑定失效，下次 Host 工作重绑。不会启用下载。 | 使 Host 绑定失效，下次允许的 Host 调用重绑。 |
| `transfer.idleTimeoutMs` | `integer` / `120000` / 10000..900000 | Host 传输句柄／暂存的空闲寿命，单位毫秒。新绑定取新值；旧资源仍按已有过期设置。 | 使 Host 绑定失效，下次允许的 Host 调用重绑。 |

## 操作开关

以下每项都是 boolean、默认 true、machine scope，在后续权限检查生效，不重启本机 IPC。它们授权 API，不是内容分类或操作系统沙箱：例如关闭文本 read，readBytes 仍可能读文本的字节；agent 不得借其他接口绕过用户意图。

| 设置（省略前缀） | 作用与安全后果 | 需要 Host |
|---|---|---|
| `permissions.list` | 目录列表。 | 否 |
| `permissions.read` | 文本、批量、显式提供者读；不控制原始字节接口。 | 否 |
| `permissions.create` | 新建文本；需 save，缺失父目录需 mkdir。 | 否 |
| `permissions.write` | 受保护全文替换；字节／复制覆盖目标时也需 write。 | 否 |
| `permissions.edit` | 文本替换／批量；也是补丁综合授权的一部分。 | 否 |
| `permissions.save` | 目标保存；create/write/edit/renameSymbol/format 均需要，不保证跨文件事务。 | 否 |
| `permissions.mkdir` | 目录与隐式父目录创建。 | 否 |
| `permissions.copy` | Host 字节保持文件复制；覆盖另需 write。 | 是 |
| `permissions.copyDirectory` | Host 复制到新目录，不合并／递归替换。 | 是 |
| `permissions.move` | 路径移动／改名；覆盖需 write，缺父目录需 mkdir。 | 否 |
| `permissions.delete` | 仅文件和空目录。 | 否 |
| `permissions.stat` | 提供者／Host 元数据；原始哈希另需 readBytes。 | 按接口 |
| `permissions.diagnostics` | 语言诊断；空结果不证明测试通过。 | 否 |
| `permissions.symbols` | 文档符号。 | 否 |
| `permissions.workspaceSymbols` | 工作区语言符号，不等于完整保存文件搜索。 | 否 |
| `permissions.definition` | 语言定义位置。 | 否 |
| `permissions.references` | 语言引用位置。 | 否 |
| `permissions.renameSymbol` | 仅文本的语言重命名／预览；需 save 和目标保护。 | 否 |
| `permissions.format` | 语言服务格式化并保存目标。 | 否 |
| `permissions.search` | Host 已保存文件搜索；显式快照有限且无需 Host。 | 按接口 |
| `permissions.findFiles` | Host 路径枚举；显式提供者快照有限。 | 按接口 |
| `permissions.applyPatch` | Host Git 文本补丁；统一检查 edit/create/move/delete。 | 是 |
| `permissions.readBytes` | Host 字节／原始哈希和下载句柄权限，仍受可用性限制。 | 是 |
| `permissions.writeBytes` | Host 字节／上传；覆盖需 write 和原始哈希保护。 | 是 |
| `permissions.largeTransfers` | 分块上传，另需 writeBytes；不会启用不可用的下载。 | 是 |
| `permissions.hostExec` | 原始 Host 命令及轮询／取消／忘记；其余 25 个操作开关也必须全为 true。 | 是 |

## 特殊行为与非设置项


- agent／terminal／transfer 组变更会使 Host 绑定及 Guest 端任务／传输引用失效，下次允许的 Host 调用重绑；不重启本机 IPC 的实例／epoch，不停止已派发子进程或改其原截止时间。旧任务可能需 Host 人工检查，传输保留既有过期设置。IPC 组变更则重启桥接，即使修改的是当前未使用的 SID／旧字段。
- 关闭不是回滚。hostExec 及轮询／取消／忘记要求 terminal.enabled 和全部 26 个操作权限；关闭其中一项也可能使取消不可用，但已启动任务超时仍在。覆盖／隐式父目录另检查 write／mkdir；applyPatch 总检查 edit/create/move/delete；直接 Host 磁盘操作不走文档 save 权限。
- readMany/providerRead 共用 read；searchSnapshot/searchResults 共用 search；findFilesSnapshot 共用 findFiles；hostStat 共用 stat，哈希另需 readBytes；Host 任务控制共用 hostExec；传输共用 largeTransfers 并按方向检查 readBytes/writeBytes。Host 搜索／复制／补丁／字节／任务需要 terminal.enabled，快照／语言／文档接口不需要。largeTransfers 不会启用不可用的大文件下载。
- 当前实现读取的字面配置键均已在公开 manifest 找到，没有额外隐藏设置。ipc.legacySidSnapshot 是内部 globalState，**不是设置项**。hostExec 的 timeoutMs／waitMs 和 hostBind 的 hostWorkspacePath 是请求参数，不是 UI 设置；启动摘要上限、IPC／Host 响应及握手固定等待时间也不是可虚构的配置项。
- 开关不会打开／共享终端、不证明 Host RW 授权，也不解决已发送结果未知。详见 [IPC 接入](IPC-SECURITY.zh-CN.md)、[API](API.zh-CN.md) 与[启动诊断](STARTUP-DIAGNOSTICS.zh-CN.md)。agent 可以解释拒绝项，但未经明确授权不能自行启用或扩权。
