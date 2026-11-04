# 设置说明

[English](SETTINGS.md) | **简体中文** | [繁體中文](SETTINGS.zh-TW.md) | [日本語](SETTINGS.ja.md)

本文对应当前仓库 schema；已安装的发布版可能提供更少或不同的命令，应以其版本、Settings UI 与匹配的发布资产为准。下表各键均有前缀 liveshareWorkspaceBridge.，schema scope 为 machine（按 VS Code 允许的 User／Remote 设置，不是 Workspace／Folder）。UI 扩展运行在 Windows Guest，修改 Host 机器的设置不是同一件事。IPC 信任只读取明确的 User global 值，忽略工作区设置与扩展提供的默认值。

## 通用、IPC 与 Host 参数

| 设置（省略前缀） | 类型／默认／范围 | 作用与安全后果 | 生效方式 |
|---|---|---|---|
| `agent.enabled` | `boolean` / `true` | 工作区操作总开关。info／hostStatus 及安全诊断元数据仍可检查；关闭不撤销已派发的效果。 | 后续请求生效；同时使 Host 绑定／资源失效。 |
| `host.enabled` | `boolean` / `false` | 允许依赖 Host 的 API，仍受操作开关约束，并需要已验证的共享 RW 终端；该终端只用于启动一次 Host helper。绑定可能创建／删除自有的临时 bootstrap 文件；绝不会把普通 Guest shell 当作 Host。取代 `terminal.enabled`。 | 后续请求生效；同时使 Host 绑定／资源失效。 |
| `powershell` | `string` / `""` | Guest 本机 IPC／账号辅助进程使用的 PowerShell 可执行文件覆盖；空值使用系统自带的 Windows PowerShell。不选择 Host 终端 shell，也不改变执行策略。 | 下次本机桥接启动时使用；不会自动切换正在运行的辅助进程。 |
| `ipc.accessMode` | `string` / `"ownerOnly"` | ownerOnly／selectedUsers。已保存的 allLocalUsers 值（0.3.0 已移除）按 ownerOnly 运行；设置不会被改写，info 以 ipc.requestedMode 和 ipc.deprecatedModeIgnored 报告它。所属用户始终保留。额外授权仅限同一 Windows session ID 中的当前本机 SAM 用户，不是 Everyone、组或全部域用户；拒绝枚举域控制器。信任覆盖这些账户的全部进程，超出任何 agent 文件系统沙箱的限制，仍受桥接权限约束。 | 重启 IPC 桥接／新的 instance+epoch；需重新发现。 |
| `ipc.selectedUserSids` | `array` / `[]` | 仅 selectedUsers 使用的稳定 SID 选择；其他模式下不据此授权。唯一列表，最多 256 个字符串；UI 校验本机用户 SID 格式，运行时还限制每项 184 个字符并验证本机 SAM 成员身份。名称仅供显示；改名后仍有效，删除重建绝不替换身份。 | 重启 IPC 桥接／新的 instance+epoch；需重新发现。 |
| `ipc.allowCodexSandboxClients` | `boolean` / `false` | 已弃用的兼容项。没有明确 User 模式时，true 会把原有两个旧沙箱身份固定到 selectedUsers；false／未设置保持 ownerOnly。明确模式优先。绝不开启 Host 权限。首次迁移会写入 User 设置；布尔值无法恢复快照之前已删除重建的 SID。 | 重启 IPC 桥接／新的 instance+epoch；需重新发现。 |
| `host.terminalName` | `string` / `""` | 用于启动 Host helper 的共享终端的准确名称。空值要求只有一个合格的共享 PTY 候选。仍会检查只读提示并验证绑定；终端标题不能证明实际 shell／版本。 | 使 Host 绑定失效；下次允许的 Host 调用重新绑定。 |
| `host.workspacePath` | `string` / `""` | 可选的明确 Host 根目录；空值时核对共享 PowerShell 当前目录与 Guest 根。这是 Host 路径，不是 Guest 本机路径。hostBind 请求参数可以覆盖它。 | 使 Host 绑定失效；下次允许的 Host 调用重新绑定。 |
| `host.commandTimeoutMs` | `integer` / `120000` / 1000..3600000 | Host 子命令默认超时，单位毫秒。hostExec 的 timeoutMs 可在支持范围内覆盖。已启动的任务保留原截止时间；这不是通用的 IPC／握手超时。 | 使 Host 绑定失效；下次允许的 Host 调用重新绑定。 |
| `host.maxOutputCharacters` | `integer` / `65536` / 1024..262144 | stdout 和 stderr 各自保留的字符数。超出部分仍会排空并标记 truncated，不是完整输出。 | 使 Host 绑定失效；下次允许的 Host 调用重新绑定。 |
| `transfer.chunkBytes` | `integer` / `32768` / 1024..65536 | 每个传输分块及小字节 API 的最大原始字节数。Guest 校验和 Host 会话都使用它；修改后在继续 Host 工作前使绑定失效。不会启用下载。 | 使 Host 绑定失效；下次允许的 Host 调用重新绑定。 |
| `transfer.idleTimeoutMs` | `integer` / `120000` / 10000..900000 | Host 传输句柄／暂存文件的空闲寿命，单位毫秒。新绑定使用此值；旧资源保留已确定的过期时间。 | 使 Host 绑定失效；下次允许的 Host 调用重新绑定。 |
| `host.guestPort` | `integer` / `0` / 0..65535 | Guest 连接的本机端口；0 表示与 Host helper 端口相同。仅当 Live Share 把 Host 端口转发到不同的本机端口时才设置：如果 Host helper 端口在 Guest 上已被占用，Live Share 会另选一个本机端口，并且只在 Guest 的 Live Share 视图共享服务器列表中显示（或运行 "Live Share: Show Shared Servers"）。找到 Host helper 端口对应的条目，把它在 Guest 上的本机端口填到这里。桥接不会自动发现重映射后的端口，因为 Live Share 的转发器运行在同时承载其他本机服务的 VS Code 进程中，而桥接从不探测这些进程。 | 每次握手尝试都会读取：绑定等待期间填入的值会在下一次尝试（约 2 秒）时使用，无需重新绑定；已建立的绑定保留其端口。 |
| `host.idleTimeoutMinutes` | `integer` / `30` / 1..1440 | Host helper 在连续这么多分钟没有请求后退出。 | 下次启动的 helper 生效。 |
| `host.handshakeTimeoutMinutes` | `integer` / `5` / 1..60 | hostBind 启动的后台握手等待 Host 共享 helper 端口的时长；hostBind 本身会先返回。超时后 hostStatus 显示 `handshake.state: "failed"` 和 `handshake.code: "host_port_forward_required"`。超时、取消或端口上的其他服务都不会把通道标记为不确定。 | 下次 Host 绑定生效。 |

Host 通道的工作方式：共享 RW 终端启动一次前台 Host helper（按 Ctrl+C、关闭终端、会话结束或空闲超时时退出）。然后 Host 用桥接显示的端口运行一次 "Live Share: Share Server"。helper 开始监听后 hostBind 立即返回（`handshake.state: "waitingForward"`）；握手在后台完成，由 hostStatus 报告，期间其他 Host 请求返回 `host_handshake_pending`。之后请求通过转发的 loopback 端口发送，并带有每个 helper 独立的 token。不会向终端输入任何请求。

## 已弃用的设置键

0.3.0 重命名了 `terminal.*` 键，旧键保留读取一个版本。新键未明确设置时，桥接仍读取旧键的 User 值，并为每个旧键向 "Live Share Workspace Bridge Host" 输出通道写一行提示。桥接绝不改写你的设置；请自行改名。

| 旧键 | 新键 |
|---|---|
| `terminal.enabled` | `host.enabled` |
| `terminal.name` | `host.terminalName` |
| `terminal.hostWorkspacePath` | `host.workspacePath` |
| `terminal.commandTimeoutMs` | `host.commandTimeoutMs` |
| `terminal.maxOutputCharacters` | `host.maxOutputCharacters` |

明确设置的新键始终优先，即使其值为 `false`。`host.transport` 已移除：Host 通道始终使用转发端口。已保存的 `sharedTerminal` 值按 portForward 运行，并向同一输出通道写一行提示；其他值被忽略。

## 操作开关

以下每项都是 boolean、默认 true、machine scope，在后续权限检查中生效，无需重启本机 IPC。它们授权的是 API，不是数据类型，也不是操作系统沙箱：例如即使关闭了文本 read，readBytes 仍可读取文本文件的字节；agent 不得借其他途径绕过用户意图。

| 设置（省略前缀） | 作用与安全后果 | 需要 Host |
|---|---|---|
| `permissions.list` | 目录列表。 | 否 |
| `permissions.read` | 文本、批量和显式提供者读取；不控制原始字节。 | 否 |
| `permissions.create` | 新建文本文件；需要 save，缺失父目录时需要 mkdir。 | 否 |
| `permissions.write` | 受保护的整文档替换；覆盖字节／文件时也需要。 | 否 |
| `permissions.edit` | 文本替换／批量；也是补丁检查授权的一部分。 | 否 |
| `permissions.save` | 目标保存；create/write/edit/renameSymbol/format 都需要。没有跨文件事务。 | 否 |
| `permissions.mkdir` | 目录及隐式父目录创建。 | 否 |
| `permissions.copy` | Host 上保持字节的文件复制；覆盖另需 write。 | 是 |
| `permissions.copyDirectory` | Host 复制到新目录，不合并、不递归替换。 | 是 |
| `permissions.move` | 路径移动／改名；覆盖需要 write，缺失父目录需要 mkdir。 | 否 |
| `permissions.delete` | 仅文件和空目录。 | 否 |
| `permissions.stat` | 提供者元数据／Host stat；原始哈希另需 readBytes。 | 视情况 |
| `permissions.diagnostics` | 语言诊断；空结果不是测试结果。 | 否 |
| `permissions.symbols` | 文档符号。 | 否 |
| `permissions.workspaceSymbols` | 工作区语言符号，不是完整的已保存文件搜索。 | 否 |
| `permissions.definition` | 语言定义。 | 否 |
| `permissions.references` | 语言引用。 | 否 |
| `permissions.renameSymbol` | 仅文本的语言重命名／预览；需要 save 和目标保护。 | 否 |
| `permissions.format` | 语言服务格式化并保存目标。 | 否 |
| `permissions.search` | Host 已保存文件搜索；显式快照有限且不需要 Host。 | 视情况 |
| `permissions.findFiles` | Host 路径枚举；显式提供者快照有限。 | 视情况 |
| `permissions.applyPatch` | 经检查的 Host Git 文本补丁；edit/create/move/delete 都会检查。 | 是 |
| `permissions.readBytes` | Host 字节／原始哈希及下载句柄权限，仍受可用性限制。 | 是 |
| `permissions.writeBytes` | Host 字节／上传；覆盖需要 write 和原始哈希保护。 | 是 |
| `permissions.largeTransfers` | 分块上传；writeBytes 同样适用。不会启用不可用的下载。 | 是 |
| `permissions.hostExec` | 任意 Host 命令及轮询／取消／忘记；其余 25 个操作开关也必须全部为 true。 | 是 |

## 特殊行为与非设置项


- agent／host／transfer 设置变更（以及已弃用的 terminal.* 键）会使 Host 绑定及 Guest 端任务／传输引用失效；下次允许的 Host 调用重新绑定。这不会重启本机 IPC 的 instance／epoch，不会停止已派发的子进程，也不改变其原截止时间。旧任务可能需要在 Host 端检查；传输资源保留已确定的过期时间。IPC 键变更则会重启桥接，即使修改的 SID／旧字段当前未被使用。
- 关闭权限不是回滚。原始 hostExec 及其任务控制需要 host.enabled 和全部 26 个操作权限；关闭其中一项也可能使轮询／取消不可用，而子进程的有界超时仍然有效。copy／write 覆盖和隐式父目录另有 write／mkdir 检查。applyPatch 总是检查 edit/create/move/delete；直接的 Host 磁盘操作不使用文档 save 权限。
- readMany/providerRead 共用 read；searchSnapshot/searchResults 共用 search；findFilesSnapshot 共用 findFiles；hostStat 共用 stat（哈希另需 readBytes）；hostJobPoll/Cancel/Forget 共用 hostExec；传输 API 共用 largeTransfers，并按方向检查 readBytes/writeBytes。Host 搜索／复制／补丁／字节／任务需要 host.enabled；快照／语言／文档 API 不需要。largeTransfers 不会让不可用的大文件下载变为可用。
- 当前运行时读取的字面配置键均已在公开 manifest 中找到，没有额外的设置。ipc.legacySidSnapshot 是内部 globalState，**不是设置项**。hostExec 的 timeoutMs／waitMs 和 hostBind 的 hostWorkspacePath 是请求参数，不是 Settings UI 条目。启动快照上限以及本机 IPC／Host 响应／握手的固定等待时间是固定的实现限制，不是虚构的设置。
- 策略开关不会打开／共享终端，不能证明 Host RW 授权，也不能解决结果未知的已发送修改。参阅 [IPC 接入](IPC-SECURITY.zh-CN.md)、[API](API.zh-CN.md) 与[启动诊断](STARTUP-DIAGNOSTICS.zh-CN.md)。agent 可以解释被拒绝的设置，但未经明确授权不得启用它或扩大信任。
