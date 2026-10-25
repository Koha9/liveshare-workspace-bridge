# API 参考

[English](API.md) | **简体中文** | [繁體中文](API.zh-TW.md) | [日本語](API.ja.md)

[文档](README.zh-CN.md)

## 协议

请求是 JSON 对象。公共字段 `instance`、`epoch` 和 `workspace` 可由同名 CLI 参数补充，值从 `instances` 获取。文件路径相对于所选根目录，并使用正斜杠。

- 请求上限：2 MiB。
- 响应上限：4 MiB。
- 单次读取返回的文本上限：1 MiB。

响应为 `{"ok":true,"result":...}` 或 `{"ok":false,"error":{"code":"...","message":"..."}}`。响应外层成功不代表可忽略 `applied`、`saved` 及逐文件结果。应用失败、保存失败或批量读取部分出错时，CLI 返回非零退出码。

## 读取与编辑

```json
{"op":"info"}
{"op":"list","path":"src"}
{"op":"read","path":"src/main.ts","startLine":20,"endLine":100}
{"op":"readMany","files":[{"path":"src/main.ts","startLine":20,"endLine":100},{"path":"package.json"}]}
{"op":"edit","files":[{"path":"src/main.ts","expectedVersion":4,"changes":[{"oldText":"return oldValue;","newText":"return newValue;"}]}]}
{"op":"edit","files":[{"path":"src/main.ts","expectedVersion":4,"changes":[{"startLine":20,"endLine":23,"newText":"replacement lines"}]}]}
{"op":"write","path":"config.json","expectedVersion":2,"text":"{}\n"}
{"op":"create","path":"src/new/module.ts","text":"export const value = 1;\n","eol":"LF"}
{"op":"save","path":"src/main.ts","expectedVersion":5}
```

`read` 返回缓冲区文本、`version`、`dirty`、`eol` 和 `lineCount`。行号从 1 开始、两端包含。`withHash:true` 才额外返回当前文本的 SHA-256，不是原始文件字节哈希。局部返回不代表底层提供者使用流式读取。

`edit.files` 最多包含 100 个不同文档，每个文档最多 1000 项修改。所有位置相对于修改前的文档，范围不可重叠。`oldText` 必须非空且唯一；`all:true` 替换全部非重叠匹配。

按行修改选择指定的完整行，不包含最后一行末尾的换行分隔符。可用 `expectedText` 检查选中内容。原生范围为 `range:{start:{line,character},end:{line,character}}`：行号从 0 开始，结束位置不包含，character 使用 UTF-16 偏移。越界位置会被拒绝。按位置修改须提供 `expectedVersion`、`expectedHash` 或 `expectedText`。

`write` 替换已有文档，要求 `expectedVersion` 或 `expectedHash`；不存在的文件使用 `create`。创建和编辑均会保存目标文档。已有文件保留 EOL；创建时推断首个换行，没有换行则默认 LF，也可显式指定 `LF`／`CRLF`。

`edit` 返回 `{applied,saved,files:[{uri,version,dirty,saved,changes,error?}]}`。先提交一份 WorkspaceEdit，再逐文件保存；失败不会自动回滚或重放。`save` 要求当前 `expectedVersion`。只有明确包含原有未保存内容时才使用 `allowDirty:true`。

## 文件操作

```json
{"op":"mkdir","path":"new/nested"}
{"op":"stat","path":"src/main.ts"}
{"op":"copy","path":"src/main.ts","to":"backup/main.ts"}
{"op":"move","path":"backup/main.ts","to":"backup/renamed.ts"}
{"op":"delete","path":"backup/renamed.ts"}
```

创建、复制和移动默认创建缺失父目录，可通过 `parents:false` 关闭。复制和移动默认拒绝覆盖，除非设置 `overwrite:true`。复制只支持文件；移动支持文件和目录。删除只支持文件和空目录，不使用回收站，并拒绝 `recursive:true`。源或目标有未保存文档时，这些操作会被阻止。

`mkdir` 直接交给提供者处理，包括目录已存在的情况。`stat` 中未知的大小或时间保持 `null`。操作失败前可能已创建父目录；文件操作不保证事务回滚。

## 搜索与代码导航

```json
{"op":"findFiles","pattern":"src/**/*.ts","limit":100}
{"op":"search","query":"handleRequest","include":"src/**/*.ts","regex":false,"caseSensitive":true,"waitMs":800}
{"op":"searchResults","searchId":1}
{"op":"diagnostics","path":"src/main.ts"}
{"op":"symbols","path":"src/main.ts"}
{"op":"workspaceSymbols","query":"Handler"}
{"op":"definition","path":"src/main.ts","line":20,"character":8}
```

`findFiles` 最多返回 1000 项，带有 `possiblyCapped` 和 `complete:null`。默认遵守排除设置，可按需要使用 `exclude` 或 `useExcludes:false`。结果可能遗漏新文件。

`search` 要求单个 Live Share 根目录，并使用 Search View。参数包括 `include`、`exclude`、`regex`、`caseSensitive` 和 `useExcludes`（默认 true）。`waitMs` 为 0–5000，默认 800，仅控制采样延时，不表示完成。返回 `search.id`、`snapshot`、`truncated`、`complete:null` 和 `correlation:"best_effort"`。`maxCharacters` 默认 100000，上限 1000000。

`searchResults` 不发起新搜索。可选 `searchId` 能发现桥接发起的其他查询，但不能发现用户手动更改搜索视图。

`definition` 使用从 1 开始的行号和从 0 开始的 UTF-16 字符偏移。返回位置保留 URI scheme，并使用原生的从 0 开始的位置。语言结果为空不表示构建成功。

`providerRead` 返回提供者的 UTF-8 文本及字节数，用于故障定位或明确要求的核对，不属于正常写入后的默认步骤。

## 错误

| 错误码／结果 | 含义 |
|---|---|
| `instance_mismatch`、`workspace_changed` | 重新发现并确认目标工作区。 |
| `content_changed` | 编辑前刷新受影响的文本或版本。 |
| `text_not_found`、`ambiguous_match` | 调整原文匹配或范围。 |
| `dirty_document` | 原有未保存内容受到保护。 |
| `saved:false` | 修改可能仍在编辑器中，应重试保存而非重新编辑。 |
| `transport_outcome_unknown`、`requestSent:true` | 重试修改前先检查受影响状态。 |
