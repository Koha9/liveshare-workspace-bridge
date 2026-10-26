# API 参考 v0.2

[English](API.md) | **简体中文** | [繁體中文](API.zh-TW.md) | [日本語](API.ja.md)

[文档](README.zh-CN.md)

## 协议

请求使用 `op`、`instance`、`epoch` 和准确的 `workspace` URI；CLI 同名参数可提供绑定信息。共享路径相对于选定根目录，使用正斜杠。响应为 `{ok:true,result:...}` 或 `{ok:false,error:{code,message,details?}}`；仍需检查 `applied`、`saved`、逐文件结果、`complete`、截断、任务状态和退出码。请求上限 2 MiB，响应上限 4 MiB。

## 权限与 Host 绑定

设置名称保留英文，位于 `liveshareWorkspaceBridge.*`，使用 machine scope，只能在 User／Remote 设置中配置，工作区不能覆盖。

| 设置 | 含义 |
|---|---|
| `agent.enabled` | 总开关，默认 true；info/status 仍可检查。 |
| `terminal.enabled` | Host 共享终端访问，默认 false；关闭时所有 Host 功能的有效权限关闭。 |
| `permissions.OPERATION` | 单项权限；别名继承基础操作，见 `info.permissions.configured/effective`。 |
| `terminal.name` | 准确的共享 RW 终端名；留空时必须只有一个合格共享终端，排除 Guest 本地终端。 |
| `terminal.hostWorkspacePath` | 可选显式 Host 根目录；否则验证共享 PowerShell 当前目录。 |
| `terminal.commandTimeoutMs` | 默认 120000，范围 1000..3600000 毫秒。 |
| `terminal.maxOutputCharacters` | stdout/stderr 各自保留的字符数，默认 65536，范围 1024..262144。 |
| `transfer.chunkBytes` | 单块原始字节数，默认 32768，范围 1024..65536。 |
| `transfer.idleTimeoutMs` | 传输句柄／暂存资源空闲寿命，默认 120000，范围 10000..900000 毫秒。 |

原始 Host 命令要求全部操作权限，避免绕过细分限制。文档修改需要 save 权限；创建父目录需要 mkdir；覆盖字节文件需要 write。这些是操作授权，不是操作系统文件沙箱。

```json
{"op":"hostStatus"}
{"op":"hostBind"}
```

`hostStatus` 不发送终端命令。`hostBind` 通过自有随机临时 bootstrap 文件验证 Host/Guest 根目录，加载内存会话辅助程序后删除文件；不安装常驻 Host agent，不改身份验证。目前 Host 仅支持 Windows PowerShell。关闭权限阻止新请求，不撤销已派发操作。

## 文本、文件与语言功能

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

读取返回缓冲文本、version、dirty、EOL 和 lineCount；行号从 1 开始，两端包含。`withHash:true` 是文档文本哈希，不是 Host 原始字节哈希。一次返回文本上限 1 MiB，打开文档仍可能访问完整提供者资源。

`edit.files` 最多 100 个不同目标，每文件最多 1000 项修改。`oldText` 默认必须唯一，刻意全替换才用 `all:true`。位置相对于原始内容且不得重叠。按行编辑使用 `startLine/endLine/newText/expectedText?`，不包含最后的换行分隔符。原生范围采用从 0 开始的行号和 UTF-16 字符位置，结束位置不包含在内，并支持版本／哈希／原文保护。整文档 `write` 需要 `expectedVersion` 或 `expectedHash`。

文本按 Guest 文档 EOL 规范化，Host 协同编辑可能采用不同磁盘换行。只保存目标文档，不提供跨文件事务；部分失败明确报告。`allowDirty:true` 表示包含保留和保存既有未保存内容。

`symbols`、`workspaceSymbols`、`definition`、`diagnostics` 保留。语言查询输入使用从 1 开始的行号和从 0 开始的 UTF-16 字符位置。重命名和格式化检查范围、版本和 dirty 状态并保存目标；重命名只重建文本编辑，不应用提供者返回的文件操作。`preview:true` 只返回计划。格式化需要语言提供者。

`delete` 拒绝 `recursive:true`。`stat` 是可能缺少大小／时间的提供者元数据；`providerRead` 是显式 UTF-8 验证，不是二进制读。Host 写入在同一响应中仅为受影响的已打开 Guest 文档计算规范化摘要，每文件上限 16 MiB。`hostStat` 的 `withTextHash:true` 可在结果未知后显式刷新预期摘要；干净缓冲区必须内容匹配，版本增加本身不够。未刷新时报告 `editor_refresh_pending`，保留内容，不全局回退或返回已知过期文本。

## 已保存文件的完整搜索

```json
{"op":"search","query":"handleRequest","include":["src/**/*.ts"],"exclude":["**/generated/**"],"caseSensitive":true,"limit":500}
{"op":"findFiles","pattern":["src/**/*.ts"],"limit":500}
```

include/exclude 接受单个 glob 或数组，不是逗号分隔的模式语言。`regex/wholeWord/caseSensitive` 默认 false。`useExcludes:false` 包含隐藏和忽略文件，但始终排除 `.git` 管理路径；否则使用 rg 忽略规则，不完全复刻 VS Code 条件排除。

检查 `complete/state/exitCode/truncated` 和 `scope:saved_host_files`。无匹配退出码 1 正常。输出／结果限制或解析失败使 complete 为 false。limit 默认 500、最大 10000。匹配包含相对路径、从 1 开始的行号、文本和 UTF-8 字节偏移；构造 UTF-16 编辑前读取相关文本。dirty 文档单独报告，绝不自动保存。

`searchSnapshot/searchResults/findFilesSnapshot` 显式保留旧编辑器／提供者接口，完整性未知；不需要 Host，但不是 Host 缺失时的自动替代。

## 命令与补丁

```json
{"op":"hostExec","command":"node --test","cwd":"","timeoutMs":120000,"waitMs":1000}
{"op":"hostJobPoll","jobId":"<id>","waitMs":5000,"stdoutOffset":0,"stderrOffset":0}
{"op":"hostJobCancel","jobId":"<id>"}
{"op":"hostJobForget","jobId":"<id>"}
{"op":"applyPatch","patch":"<Git-style unified text patch>","checkOnly":true}
```

已知命令会修改文件时，提供 `affectedPaths`，最多 100 个相对路径。只针对这些已打开缓冲区检查最终 Host 文本摘要；其他任意副作用不追踪。

命令运行在自有子进程和 Windows Job Object 中。超时／取消只针对其进程树，不终止共享 PowerShell。命令长度 1..8000，`waitMs` 0..5000，timeout 1000..3600000 毫秒。状态为 `running/completed/timed_out/cancelled`，completed 不代表退出码为 0。输出流有界、持续排空并标记截断；复用返回的输出游标。只能 forget 已结束任务；每次绑定最多保留 16 个任务。

文本补丁最多 1 MiB／100 文件，使用 `a/`、`b/` 路径；拒绝越界、`.git`、二进制、符号链接和子模块补丁。先 `git apply --check` 再应用；`checkOnly:true` 不写入，拒绝 dirty 目标。Host 需要 Git，不自动 stage/commit/push。补丁行尾跟随 Host Git 配置；需要字节精确保真时用字节 API。

## 原始字节和大文件上传

```json
{"op":"hostStat","path":"asset.bin","withHash":true}
{"op":"readBytes","path":"asset.bin"}
{"op":"writeBytes","path":"asset.bin","base64":"<canonical base64>","parents":false}
{"op":"writeBytes","path":"asset.bin","base64":"<base64>","overwrite":true,"expectedCurrentSha256":"<raw Host hash>"}
{"op":"copy","path":"assets/a.png","to":"backup/a.png"}
{"op":"copyDirectory","path":"template","to":"new-template"}
```

小字节 API 受 chunkBytes 限制并校验 SHA-256。目录复制目标必须新建，拒绝重解析点和 Git 管理树；路径及祖先保持在已验证 Host 根目录内。覆盖现有字节文件需要 `expectedCurrentSha256`，与文本哈希不同。普通写入不默认追加提供者验证。

```powershell
node "<client>" upload --instance "<id>" --epoch "<epoch>" --workspace "vsls:/" --input "<local.bin>" --path "assets/file.bin"
node "<client>" apply-patch --instance "<id>" --epoch "<epoch>" --workspace "vsls:/" --input "<local.patch>" --check-only
```

上传覆盖需要 `--overwrite` 和 `--expected-current-sha256 HASH`。当前开放的传输协议为 `transferBeginWrite`、`transferWrite(sequence/base64)`、`transferCommit(sha256)`、`transferAbort`；文件通过多个有界块上传。

上传暂存在 Host 自有临时文件中，关闭时删除并有空闲过期机制，只在 commit 时更新目标。立即重复上一上传序号及相同内容是幂等的，普通修改不会自动重放。提交回执丢失时先检查目标状态和哈希，再决定是否重启。

**大文件下载本版禁用**：`transferOpenRead/transferRead`（含 CLI download）在 Host 派发前返回 `feature_unavailable`。约 1.1 MB 的实际下载曾反复使终端停住，根因未解决；禁止循环小块读取绕过。小文件读取和大文件上传仍可用。未支持的任务需要按 skill 请求用户提供准确的手动结果或可访问副本，并在回复后继续依赖步骤。
