# Live Share 能力调查：Host 共享 PowerShell 路线

日期：2026-10-26。范围：在已授权的 Live Share Guest、Host 可读写共享 PowerShell及唯一命名临时目录中调查，不执行 commit 或 push。

## 核心结论

Host 可读写共享终端提供了一条可行的执行通道：Guest 扩展通过稳定的 `Terminal.sendText` 发送命令，并订阅该终端 `creationOptions.pty.onDidWrite`，只提取本次随机标记之间的 JSON 输出。当前共享终端没有普通 Shell Integration，但这种方式已实际取得 Host 返回结果，不需要 proposed API、HTTP 端口、访问令牌或安装 Host agent。

这使可靠搜索、Host 原生测试、原生 Git 补丁及文件操作的实现成本显著下降。**这是已验证的调查原型，不是已经加入正式插件的功能。** 仍需完成命令与终端绑定、作业排队、stdout/stderr、退出码、超时／取消和断线后的未知状态处理。

文件操作也发现新的提供者限制：不能把 Guest 文档状态、提供者回读、Host 原始字节混为一个结果。二进制及目录复制不能直接解除现有接口限制后开放。

## 本次环境与验收层级

- VS Code 1.143.1、Live Share 1.1.122、可信任单根 Guest。
- Host 是另一台机器，PowerShell 5.1。通过同一随机目录中的绑定文件，确认 Host 当前目录与 Guest 共享根相对应。
- 运行中的桥接扩展是旧 publisher 的 0.1.1；五个运行文件与当前仓库逐字节一致。当前仓库的 Koha9-Lee publisher 安装迁移没有在本次更换。
- 正式 v0.1 文件测试脚本已在当前连接中退出 0：核心文件操作、保存、换行的 Guest 表现、代码接口及 skill 客户端通过，fixture 清理回读通过。它证明当前代码的运行行为，不代表 publisher 迁移和所有字节语义均已验收。
- 没有运行实际业务项目的构建／测试，Host 测试程序仅为本次 fixture。

## 实测结果

| 能力 | 结果与证据 | 结论 |
|---|---|---|
| Host 命令输入与输出 | `powershell [Shared]` 的 `processId=-1`、无 Shell Integration；公共 Pseudoterminal 输出事件存在。带随机边界的命令得到对应 JSON 完成帧 | 可用稳定 API 做 Host 执行原型；不要选到普通 Guest 本地终端 |
| Host 内容搜索 | 找到 Host VS Code 附带的 ripgrep 15.0.0；正查询返回 2 个命中、退出 0；负查询退出 1并返回零命中 | 在明确的、已保存 fixture 范围内可证明查询完成 |
| Host 新文件枚举 | `rg --files` 完整枚举 4 个本次 txt 文件；Guest findFiles 对同一新目录返回空 | Host 枚举可以绕开当前 Guest 搜索提供者的漏项 |
| Host 原生测试 | Node fixture 测试返回标记输出、退出 0；受控进程返回退出 7；PowerShell throw 被报告为失败 | 可以分辨完成与失败；尚未证明任意长任务及完整 stderr 流处理 |
| 通用补丁路径 | Host `git apply --check` 和 `git apply` 均退出 0，仅改本次 patch.txt | 可通过 Host Git应用补丁；桥接侧解析器仍未实现 |
| 完成信号的 VS Code 搜索 API | 在可信任状态下调用 findTextInFiles，仍被 proposed API 权限检查拒绝 | 工作区信任不会解除这层权限；当前稳定搜索视图路线仍是快照 |
| 直接 provider 二进制写入 | 256 个原始字节写到 Host 后变成 512 字节；Guest 回读只得到 9 字节且哈希不一致 | 当前 Live Share 提供者不是可用的通用二进制写入／读取通道 |
| 直接 provider 覆盖已有文件 | 写入调用返回成功，但 Host 内容仍是 ORIGINAL | 必须继续使用已验证的文档编辑路径；不能把 provider 调用不抛错当成写入成功 |
| provider 目录复制 | 调用返回成功，Host 上复制源与副本的二进制哈希不同 | 目录复制以及包含二进制的通用文件复制都不能按成功回执宣称正确 |
| provider 递归删除 | 非空目录返回 ENOTEMPTY，Host 确认目录仍在 | 当前提供者没有兑现递归删除请求 |
| Host 原生二进制与目录操作 | 4096 字节写入／目录复制的源和副本 SHA-256 一致；递归删除后目录不存在 | Host 文件通道可承担这些操作，需加入范围保护与明确结果协议 |
| 引用查询 | JavaScript 样本返回 4 个引用位置 | 加入接口的成本较低，仍依赖语言服务 |
| 符号重命名 | 返回跨 2 个文件、各 2 处的编辑计划，未应用计划 | 可实现；需接入预检、范围检查和逐文件保存 |
| 格式化 | 本次样本没有返回编辑 | 不解释为所有语言均不支持；需要按提供者进一步验收 |
| 大文件 | 1,230,000 字节文本可创建；全文读取被 response_limit 拒绝；局部 5 行可读取 | 当前大小上限确实影响大文件；局部返回仍不代表底层流式读取 |

## 换行和原始字节的新增发现

通过文档 create/save 创建 LF 文本时，Guest 文档与提供者回读可以显示 LF，Host 原始磁盘却是相同文本的 CRLF 版本。独立 Host 哈希精确对应 CRLF 变体，不对应 LF 或 BOM 变体。这不是完整字节保留通过。

对照中，新文件直接走 provider 的纯文本 LF 写入，以及 Host `WriteAllText` 指定 UTF-8 无 BOM，都能得到实际 11 字节的 LF 文本。说明差异与具体写入／协作路径有关，不能笼统说所有文件写入都会转换。

Host Git 修改后，Guest 文档与 provider 回读也可能呈现不同的换行字节。当前文本哈希只描述文档文本；不能作为 Host 原始文件哈希。

已安装 Live Share 的 WorkspaceProvider 源码给出相符的实现线索：写入转换为字符串并调用文本服务，已有文件分支直接返回；删除分支未使用递归参数，且指定了回收站行为。stat 的 size 没有值，ctime 来自 mtime。这些是版本 1.1.122 的静态观察，不应推广到所有未来版本。

## 修订后的实现代价

代价包括开发、失败处理、实机验收及后续兼容维护，不是日历承诺。

| 后续能力 | 当前路线和成本 | 不实现的影响 |
|---|---|---|
| 可确认完成的内容／路径搜索 | **中**：基于已提供的 Host RW 终端运行 rg，处理查询范围、排除规则、输出上限和退出码；不再需要逐文件通过 Live Share 搜索 | 只能继续使用不完整快照，无法可靠证明“没有其他命中” |
| Host 测试／构建 | **中**：执行基础已通；需作业身份、队列、取消、stderr、断线及超时协议 | 文件可改，但开发任务无法通过本通道完成 Host 验证 |
| Host Git 补丁 | **中**：复用 git apply；验证补丁路径、预检、实际修改范围和失败后状态，不自行重写通用解析器 | Codex继续把修改转换为当前文本编辑格式 |
| 引用查询 | **低**：增加固定语言服务调用及 URI／位置序列化 | 不影响现有编辑，但代码调查效率较低 |
| 符号重命名／代码动作 | **中**：需要处理 WorkspaceEdit 涉及的文件操作、dirty 文档和保存结果 | 复杂重构仍主要靠文本定位与编辑 |
| 小型二进制及目录操作 | **中**：走 Host 字节和文件 API，校验源／目标范围、覆盖及部分失败，不能走当前 provider 的文本写入 | 图片和其他资产无法可靠复制／写入，非空目录仍需其他通道清理 |
| 大文件／大二进制流式传输 | **中高**：分块协议、重组、校验、超时、版本一致性和中断恢复 | 继续受 2 MiB 请求、4 MiB 响应和 1 MiB 单次文本返回限制 |
| Host 原始换行／编码精确保留 | **中高**：需明确文档编辑模式与字节模式，以及 Host 外部写入后和共享缓冲区的一致性 | 普通文本内容可用，不能承诺指定 LF／CRLF 或原始字节一定按 Guest 表现落盘 |
| 多根、用户同时操作及搜索隔离 | **中高**：Host 根映射、任务绑定、专用终端／队列及 dirty 缓冲区规则 | 当前只适合明确选择的单根场景与已有协作约束 |
| 跨文件落盘全成或全败 | **很高**：当前接口没有事务；Host 文件系统命令也不会自动提供多文件事务。只能增加检查点或尽力恢复 | 保留逐文件成功／失败回执，失败后恢复或报告，不能宣称跨文件原子保存 |

## Host 路线仍需保留的边界

1. Host rg 搜索的是已保存文件。Guest/Host 未保存缓冲区需要单独说明或叠加处理，不能为搜索自动 saveAll。
2. 本次搜索明确限定 fixture，并关闭忽略规则。还没实现与 VS Code 配置、gitignore、二进制及符号链接规则的完整等价。
3. 当前原型仅在该版本的 Windows Host PowerShell 和一个 RW 共享终端上验证；没有证明其他终端实现、只读终端或跨平台支持。
4. 完成帧由随机标记限定，不读取历史终端内容。任意生产级长任务仍需要超时／取消和输出隔离；收到发送回执不能单独证明执行完成。
5. 命令输入／输出仍通过共享终端传输。本次没有抓取网络包；不能把终端字符数或 API 次数说成网络请求数。Host 本地扫描避免了逐文件的 Live Share 读取，但实际总流量未测量。
6. 建议保持当前 VS Code 文档通道用于日常文本编辑，增加可选的、明确绑定工作区的 Host 通道承担搜索、执行及字节／目录任务。没有理由把每次文本保存都改成 Host 回读确认。

## 收尾与文件状态

所有本次共享 fixture 均由随机绑定文件限定；Host 删除确认及 Guest 根目录回读均确认不存在，Guest dirty 文档清单为空。临时调查扩展已停止并卸载，辅助进程和登记文件已检查清理。

原有已暂存内容的 Git index 哈希保持不变。没有 stage、commit 或 push，也没有将本次原型接入正式插件或修改现有 skill。

原始回执放在本机忽略目录 `.local/evidence/2026-10-26/`；公开候选文档不包含 Host 原始路径或用户身份。运行期间使用的是公开 VS Code API 和用户提供的 RW 共享终端，没有读取 SecretStorage 或 Internals 令牌。

## 来源

- [VS Code Terminal.creationOptions](https://code.visualstudio.com/api/references/vscode-api#Terminal)
- [VS Code Pseudoterminal.onDidWrite／handleInput](https://code.visualstudio.com/api/references/vscode-api#Pseudoterminal)
- [VS Code proposed API 说明](https://code.visualstudio.com/api/advanced-topics/using-proposed-api)
- 当前 [工作区接口实现](../extension/workspace.cjs) 和 [API 说明](API.md)
