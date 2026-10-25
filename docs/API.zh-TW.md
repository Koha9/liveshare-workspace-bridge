# API 參考

[English](API.md) | [简体中文](API.zh-CN.md) | **繁體中文** | [日本語](API.ja.md)

[文件](README.zh-TW.md)

## 協定

請求是 JSON 物件。共用欄位 `instance`、`epoch` 和 `workspace` 可由同名 CLI 參數補入，其值從 `instances` 取得。檔案路徑相對於選取的根目錄，並使用正斜線。

- 請求上限：2 MiB。
- 回應上限：4 MiB。
- 單次讀取傳回的文字上限：1 MiB。

回應為 `{"ok":true,"result":...}` 或 `{"ok":false,"error":{"code":"...","message":"..."}}`。回應外層成功不代表可忽略 `applied`、`saved` 和逐檔結果。套用失敗、儲存失敗或批次讀取部分出錯時，CLI 傳回非零結束代碼。

## 讀取與編輯

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

`read` 傳回緩衝區文字、`version`、`dirty`、`eol` 和 `lineCount`。行號從 1 開始且包含兩端。`withHash:true` 才額外傳回目前文字的 SHA-256，不是原始檔案位元組雜湊。局部輸出不表示底層提供者使用串流讀取。

`edit.files` 最多包含 100 份不同文件，每份文件最多 1000 項修改。所有位置相對於修改前的文件，範圍不可重疊。`oldText` 必須非空且唯一；`all:true` 取代所有非重疊符合項目。

依行修改選取指定的完整行，不包含最後一行末尾的換行分隔符號。可用 `expectedText` 檢查選取內容。原生範圍為 `range:{start:{line,character},end:{line,character}}`：行號從 0 開始，不包含結束位置，character 使用 UTF-16 位移。超出範圍的位置會被拒絕。依位置修改須提供 `expectedVersion`、`expectedHash` 或 `expectedText`。

`write` 取代既有文件，要求 `expectedVersion` 或 `expectedHash`；不存在的檔案使用 `create`。建立和編輯都會儲存目標文件。既有檔案保留 EOL；建立時推斷第一個換行，沒有換行則預設 LF，也可明確指定 `LF`／`CRLF`。

`edit` 傳回 `{applied,saved,files:[{uri,version,dirty,saved,changes,error?}]}`。先提交一份 WorkspaceEdit，再逐檔儲存；失敗不會自動回復或重送。`save` 要求目前的 `expectedVersion`。只有明確納入原有未儲存內容時才使用 `allowDirty:true`。

## 檔案操作

```json
{"op":"mkdir","path":"new/nested"}
{"op":"stat","path":"src/main.ts"}
{"op":"copy","path":"src/main.ts","to":"backup/main.ts"}
{"op":"move","path":"backup/main.ts","to":"backup/renamed.ts"}
{"op":"delete","path":"backup/renamed.ts"}
```

建立、複製與移動預設建立缺少的父目錄，可用 `parents:false` 關閉。複製與移動預設拒絕覆寫，除非設定 `overwrite:true`。複製只支援檔案；移動支援檔案和目錄。刪除只支援檔案與空目錄，不使用資源回收筒，並拒絕 `recursive:true`。來源或目的地有未儲存文件時，這些操作會被阻擋。

`mkdir` 直接交給提供者處理，包括目錄已存在的情況。`stat` 中未知的大小或時間保持 `null`。操作失敗前可能已建立父目錄；檔案操作不保證交易回復。

## 搜尋與程式碼導覽

```json
{"op":"findFiles","pattern":"src/**/*.ts","limit":100}
{"op":"search","query":"handleRequest","include":"src/**/*.ts","regex":false,"caseSensitive":true,"waitMs":800}
{"op":"searchResults","searchId":1}
{"op":"diagnostics","path":"src/main.ts"}
{"op":"symbols","path":"src/main.ts"}
{"op":"workspaceSymbols","query":"Handler"}
{"op":"definition","path":"src/main.ts","line":20,"character":8}
```

`findFiles` 最多傳回 1000 項，帶有 `possiblyCapped` 和 `complete:null`。預設遵守排除設定，可依需要使用 `exclude` 或 `useExcludes:false`。結果可能遺漏新檔案。

`search` 要求單一 Live Share 根目錄，並使用 Search View。參數包括 `include`、`exclude`、`regex`、`caseSensitive` 和 `useExcludes`（預設 true）。`waitMs` 為 0–5000，預設 800，僅控制取樣延遲，不表示完成。傳回 `search.id`、`snapshot`、`truncated`、`complete:null` 和 `correlation:"best_effort"`。`maxCharacters` 預設 100000，上限 1000000。

`searchResults` 不發起新搜尋。選用的 `searchId` 能偵測橋接發起的其他查詢，但無法偵測使用者手動變更搜尋檢視。

`definition` 使用從 1 開始的行號和從 0 開始的 UTF-16 字元位移。傳回位置保留 URI scheme，並使用原生的從 0 開始的位置。語言結果為空不表示建置成功。

`providerRead` 傳回提供者的 UTF-8 文字與位元組數，用於疑難排解或明確要求的核對，不是正常寫入後的預設步驟。

## 錯誤

| 錯誤碼／結果 | 意義 |
|---|---|
| `instance_mismatch`、`workspace_changed` | 重新探索並確認目標工作區。 |
| `content_changed` | 編輯前更新受影響的文字或版本。 |
| `text_not_found`、`ambiguous_match` | 調整原文比對或範圍。 |
| `dirty_document` | 原有未儲存內容受到保護。 |
| `saved:false` | 修改可能仍在編輯器中，應重試儲存而非重新編輯。 |
| `transport_outcome_unknown`、`requestSent:true` | 重試修改前先檢查受影響的狀態。 |
