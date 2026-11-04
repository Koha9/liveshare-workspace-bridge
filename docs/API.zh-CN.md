# API 参考

[English](API.md) | **简体中文** | [繁體中文](API.zh-TW.md) | [日本語](API.ja.md)

[文档](README.zh-CN.md)

请求使用 op、instance、epoch 和准确的 workspace URI，这些值来自发现结果（`lswb_list_workspaces`；见 [MCP 指南](MCP.zh-CN.md#发现结果)）。排障 CLI 的原始请求参数可以提供这些绑定字段。共享路径相对于所选根目录。响应为 `{ok:true,result:...}` 或 `{ok:false,error:{code,message,details?}}`；仍需检查 applied/saved、逐文件结果、complete、截断、state 和退出码。

## 权限与 Host 绑定

所有设置均为英文，位于 `liveshareWorkspaceBridge.*` 下，scope 为 machine（User／Remote 设置；不能被工作区覆盖）。

| 设置 | 含义 |
|---|---|
| agent.enabled | 访问总开关；默认 true。info／status 仍可检查。 |
| host.enabled | Host 权限；默认 false。关闭时所有依赖 Host 的能力实际上都被禁用（`host_access_disabled`）。取代 terminal.enabled。 |
| permissions.OPERATION | 单项开关；别名继承其基础操作。检查 info.permissions.configured/effective。 |
| host.terminalName | 用于启动 Host helper 的共享 RW 终端的准确名称，或唯一合格的共享终端。排除 Guest 终端。 |
| host.workspacePath | 可选的明确 Host 根目录；否则核对共享 PowerShell 的当前目录。 |
| host.commandTimeoutMs | 默认 120000，范围 1000..3600000。 |
| host.maxOutputCharacters | stdout／stderr 每个流保留的字符数，默认 65536，范围 1024..262144。 |
| transfer.chunkBytes | 每块原始字节数，默认 32768，范围 1024..65536。 |
| transfer.idleTimeoutMs | 句柄／暂存的空闲寿命，默认 120000，范围 10000..900000。 |

0.3.0 的重命名会在新键未设置时继续读取旧 `terminal.*` 的 User 值一个版本；见[设置说明](SETTINGS.zh-CN.md#已弃用的设置键)。info.permissions 报告 `hostEnabled`。

原始 Host 命令要求全部操作权限都已开启：任意代码无法执行单项操作限制。文档修改需要 save 权限；创建父目录需要 mkdir；覆盖字节需要 write。这些控制授权的是操作，不是操作系统文件系统沙箱。

```json
{"op":"hostStatus"}
{"op":"hostBind"}
```

Status 不发送命令并立即响应。绑定会写入一个自有的临时 Guest bootstrap 文件，向共享 Host 终端输入一行启动命令以启动前台内存中的 Host helper（protocol 3），并在 helper 开始监听后删除该文件。随后 hostBind 返回 `bound:false`，附带 `handshake.state:"waitingForward"`、`hostPort` 和 `next`；Host 为该端口运行 "Live Share: Share Server" 后，hostStatus 报告 `bound:true`。在此之前，其他 Host 请求返回 `host_handshake_pending`。每个请求都通过转发的 loopback 端口发送，并带有每个 helper 独立的 token；除此之外不会向终端输入任何内容。它不安装 Host agent，也不改变身份验证。当前 Host 支持限于 Windows 上的 Windows PowerShell。撤销 Host 权限会阻止新请求，但不撤销已派发的效果。

## 文本、文件和语言

```json
{"op":"list","path":"src"}
{"op":"read","path":"src/main.ts","startLine":1,"endLine":80}
{"op":"readMany","files":[{"path":"a.txt"},{"path":"b.txt","startLine":1,"endLine":40}]}
{"op":"edit","files":[{"path":"a.txt","expectedVersion":3,"changes":[{"oldText":"old","newText":"new"}]}]}
{"op":"write","path":"a.txt","expectedVersion":4,"text":"replacement\n"}
{"op":"create","path":"new/a.txt","text":"hello\n","eol":"LF"}
{"op":"save","path":"a.txt","expectedVersion":5}
{"op":"mkdir","path":"new/nested"}
{"op":"stat","path":"a.txt"}
{"op":"move","path":"old.txt","to":"new.txt","parents":false}
{"op":"delete","path":"empty-directory"}
{"op":"references","path":"src/a.ts","line":12,"character":8}
{"op":"renameSymbol","path":"src/a.ts","line":12,"character":8,"newName":"newValue","preview":true}
{"op":"format","path":"src/a.ts","tabSize":2,"insertSpaces":true}
```

读取返回缓冲区中的 text／version／dirty／EOL／lineCount。行号从 1 开始且包含首尾。withHash:true 会附加文档文本哈希，不是 Host 原始字节。单次文本返回上限为 1 MiB；打开文件时仍可能访问完整的提供者资源。读取不存在的文件会以 `not_found` 失败（在 readMany 中只有该条目失败）；其他打开失败保留原错误码。

edit.files 最多允许 100 个不同目标，每个文件 1000 处修改。除非 all:true，oldText 必须唯一。所有位置都指向原始内容，且不得重叠。行编辑使用 startLine/endLine/newText/expectedText?，选中的行不含最后的分隔符。原生 range 字段使用从 0 开始的行和 UTF-16 字符，结束位置不包含，并受 version／hash／expectedText 保护。整文档写入需要 expectedVersion 或 expectedHash。

文本会规范化为 Guest 文档的 EOL。Host 协同编辑可能选择不同的磁盘换行符。保存只针对目标且不是事务；部分失败会被明确报告。allowDirty:true 表示包含保留并保存已有的未保存内容。

已有的 symbols、workspaceSymbols、definition 和 diagnostics 保持不变。语言查询输入使用从 1 开始的行和从 0 开始的 UTF-16 字符。重命名／格式化会检查范围和 dirty 缓冲区并保存目标；重命名只重建文本编辑，不执行提供者的文件操作。preview:true 只返回计划而不应用。格式化需要语言服务提供者。

Delete 拒绝 recursive:true。Stat 是提供者元数据，大小／提供者时间可能未知；providerRead 是显式的 UTF-8 验证，不是二进制读取。Host 写入只为受影响的已打开 Guest 文档计算规范化文本摘要（每个文件最多 16 MiB），并在同一个 Host 响应中返回。HostStat withTextHash:true 可在结果不确定的修改之后显式刷新该摘要。干净的 Guest 模型必须与摘要匹配，而不只是版本变化。Host 写入可能需要等待对应的变更事件；editor_refresh_pending 会保留缓冲区，而不是全局回退或返回已知过期的文本。

## 完整的已保存文件搜索

```json
{"op":"search","query":"handleRequest","include":["src/**/*.ts"],"exclude":["**/generated/**"],"caseSensitive":true,"limit":500}
{"op":"findFiles","pattern":["src/**/*.ts"],"limit":500}
```

include／exclude 是一个 glob 或 glob 数组，不是逗号分隔的模式语言。regex／wholeWord／caseSensitive 默认 false。useExcludes:false 会包含隐藏／被忽略的文件；.git 管理路径仍被排除。否则使用 rg 的忽略规则；VS Code 的条件排除没有完全复刻。

检查 complete、state、exitCode、truncated 和 scope:saved_host_files。无匹配时退出码 1 是正常的。输出／结果限制或解析错误会使 complete 为 false。limit 默认 500，最大 10000。匹配项包含相对路径、从 1 开始的行号、文本和 UTF-8 字节偏移；构造 UTF-16 编辑前请重新读取相关文本。dirty 缓冲区单独报告，绝不自动保存。

显式的 searchSnapshot／searchResults／findFilesSnapshot 保留原来有限的编辑器／提供者路径，完整性未知；它们不需要 Host 权限，也不是自动回退方案。

## 命令和补丁

```json
{"op":"hostExec","command":"node --test","cwd":"","timeoutMs":120000,"waitMs":1000}
{"op":"hostJobPoll","jobId":"<id>","waitMs":5000,"stdoutOffset":0,"stderrOffset":0}
{"op":"hostJobCancel","jobId":"<id>"}
{"op":"hostJobForget","jobId":"<id>"}
{"op":"applyPatch","patch":"<Git-style unified text patch>","checkOnly":true}
```

对已知会修改文件的命令，请提供 affectedPaths（最多 100 个相对路径）。只有受影响的已打开缓冲区会与最终的 Host 文本摘要核对；命令的其他任意效果不会被追踪。

命令在带 Windows Job Object 的自有子进程中运行。超时／取消只作用于其进程树，绝不作用于共享 PowerShell。命令长度 1..8000，waitMs 0..5000，timeout 1000..3600000。状态：running／completed／timed_out／cancelled。completed 不代表退出码为 0。输出流有界、会被排空并标记 truncated；请复用返回的游标。只能忘记已结束的任务。每个绑定最多保留 16 个任务。

补丁最多 1 MiB／100 个文件，使用 a/ 和 b/ 路径，不能逃出根目录、修改 .git，也不能包含二进制／符号链接／子模块补丁。应用前先执行 git apply --check。checkOnly:true 不应用；dirty 目标会被拒绝。不执行 stage／commit／push。Host 上必须有 Git。补丁行尾遵循 Host 的 Git 配置；需要原始字节完全一致时请使用字节 API。

## 原始字节和大文件传输

```json
{"op":"hostStat","path":"asset.bin","withHash":true}
{"op":"readBytes","path":"asset.bin"}
{"op":"writeBytes","path":"asset.bin","base64":"<canonical base64>","parents":false}
{"op":"writeBytes","path":"asset.bin","base64":"<base64>","overwrite":true,"expectedCurrentSha256":"<raw Host hash>"}
{"op":"copy","path":"assets/a.png","to":"backup/a.png"}
{"op":"copyDirectory","path":"template","to":"new-template"}
```

小字节 API 受 chunkBytes 限制并校验 SHA-256。目录复制需要新的目标目录，并拒绝重解析点／Git 管理目录树。路径及其上级目录必须位于已验证的 Host 根目录内。覆盖已有字节文件需要原始的 expectedCurrentSha256；文本哈希与之不同。普通写入不会触发额外的提供者验证。

agent 用 MCP 工具 `lswb_upload_file` 上传本地文件，用 `lswb_apply_patch_file` 应用本地补丁文件；见 [MCP 指南](MCP.zh-CN.md)。上传覆盖需要 `overwrite` 和目标当前的原始 `expectedCurrentSha256`。已启用的传输协议为 transferBeginWrite、transferWrite(sequence/base64)、transferCommit(sha256)、transferAbort。最大帧大小仍为请求 2 MiB／响应 4 MiB；上传使用许多有界分块。

上传先暂存在自有的 Host 临时文件中，关闭时删除并有空闲过期；只有提交时才更新目标。立即重复的相同上传序列是幂等的；普通修改绝不自动重放。丢失提交响应时，需先检查目标状态／哈希再重新开始。不支持的步骤需要向用户提出具体的协助请求，并在依赖工作前等待回复；见 [MCP 指南](MCP.zh-CN.md)。

大文件下载（`transferOpenRead`／`transferRead`）返回 `feature_unavailable`。请用户提供可访问的副本和本地路径，不要用重复的字节读取或原始命令绕过限制；小文件字节读取和大文件上传仍可用。
