# API 參考

[English](API.md) | [简体中文](API.zh-CN.md) | **繁體中文** | [日本語](API.ja.md)

[文件](README.zh-TW.md)

請求使用 op、instance、epoch 與準確的 workspace URI，這些值來自探索結果（`lswb_list_workspaces`；見 [MCP 指南](MCP.zh-TW.md#探索結果)）。故障排查 CLI 的原始請求旗標可提供繫結欄位。共用路徑相對於選定根目錄。回應為 `{ok:true,result:...}` 或 `{ok:false,error:{code,message,details?}}`；仍需檢查 applied／saved、逐檔案結果、complete、截斷、工作狀態與退出碼。

## 權限與 Host 繫結

所有設定名稱均為英文，位於 `liveshareWorkspaceBridge.*`，使用 machine scope（User／Remote 設定；工作區不能覆蓋）。

| 設定 | 含義 |
|---|---|
| agent.enabled | 總存取開關，預設 true。info／status 仍可檢查。 |
| host.enabled | Host 存取，預設 false。關閉時所有依賴 Host 的功能實際上均停用（`host_access_disabled`）。取代 terminal.enabled。 |
| permissions.OPERATION | 單項開關；別名繼承其基礎操作。見 info.permissions.configured/effective。 |
| host.terminalName | 用來啟動 Host 輔助程式的共用 RW 終端準確名稱，或唯一合格的共用終端。排除 Guest 終端。 |
| host.workspacePath | 可選的明確 Host 根目錄；否則驗證共用 PowerShell 目前目錄。 |
| host.commandTimeoutMs | 預設 120000，範圍 1000..3600000。 |
| host.maxOutputCharacters | stdout／stderr 各自保留的字元數，預設 65536，範圍 1024..262144。 |
| transfer.chunkBytes | 每塊原始位元組數，預設 32768，範圍 1024..65536。 |
| transfer.idleTimeoutMs | 傳輸控制代碼／暫存資源閒置壽命，預設 120000，範圍 10000..900000。 |

0.3.0 的重新命名在新鍵未設定時，仍會讀取舊 `terminal.*` 的 User 值一個版本；見[設定說明](SETTINGS.zh-TW.md#已淘汰的設定鍵)。info.permissions 回報 `hostEnabled`。

原始 Host 命令要求全部操作權限均開啟：任意程式碼無法落實單項操作限制。文件修改需要 save 權限；建立父目錄需要 mkdir；覆蓋位元組需要 write。這些控制的是操作授權，不是作業系統檔案沙箱。

```json
{"op":"hostStatus"}
{"op":"hostBind"}
```

hostStatus 不送出任何命令，立即回應。繫結會寫入一個自有的 Guest 暫存 bootstrap 檔案，在共用 Host 終端輸入一行啟動指令，啟動前景、僅存於記憶體的 Host 輔助程式（protocol 3），並在輔助程式開始監聽後刪除該檔案。接著 hostBind 回傳 `bound:false`，附帶 `handshake.state:"waitingForward"`、`hostPort` 與 `next`；Host 針對該連接埠執行「Live Share: Share Server」後，hostStatus 回報 `bound:true`。在此之前，其他 Host 請求回傳 `host_handshake_pending`。每個請求都經由轉送的 loopback 連接埠並搭配每個輔助程式專屬的權杖傳送；不再向終端輸入其他內容。不安裝 Host agent，也不變更身分驗證。目前 Host 僅支援 Windows 上的 Windows PowerShell。撤銷 Host 存取只阻止新請求，不撤銷已派發的效果。

## 文字、檔案與語言功能

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

讀取回傳緩衝區的 text／version／dirty／EOL／lineCount。行號從 1 開始，兩端包含。withHash:true 加上文件文字雜湊，不是 Host 原始位元組。單次文字回傳上限 1 MiB；開啟文件仍可能存取完整的提供者資源。讀取不存在的檔案時以 `not_found` 失敗（readMany 中只有該項失敗）；其他開啟失敗保留原本的錯誤碼。

edit.files 最多 100 個不同目標，每檔案 1000 項修改。oldText 必須唯一，除非指定 all:true。所有位置都相對於原始內容，且不得重疊。按行編輯使用 startLine/endLine/newText/expectedText?，選取的行不含最後的分隔符。原生範圍欄位使用從 0 開始的行號與 UTF-16 字元位置，結束位置不含，並支援 version／hash／expectedText 保護。整份 write 需要 expectedVersion 或 expectedHash。

文字依 Guest 文件 EOL 規範化。Host 協同編輯可能採用不同的磁碟換行。儲存只針對目標且非交易式；部分失敗會明確報告。allowDirty:true 包含保留並儲存既有未儲存內容。

既有的 symbols、workspaceSymbols、definition 與 diagnostics 保留。語言查詢輸入使用從 1 開始的行號與從 0 開始的 UTF-16 字元位置。重新命名／格式化會檢查範圍與 dirty 緩衝區並儲存目標；重新命名只重建文字編輯，不套用提供者的檔案操作。preview:true 只回傳計畫而不套用。格式化需要提供者。

delete 拒絕 recursive:true。stat 是提供者中繼資料，大小／提供者時間可能未知；providerRead 是明確的 UTF-8 驗證，不是二進位讀取。Host 寫入只在同一個 Host 回應中，為受影響的已開啟 Guest 文件計算規範化文字摘要（每檔案上限 16 MiB）。結果不確定的修改之後，HostStat withTextHash:true 可明確重新整理該摘要。乾淨的 Guest 模型必須與摘要相符，版本變動本身不夠。Host 寫入可能等待相符的變更事件；editor_refresh_pending 會保留緩衝區內容，不全域還原，也不回傳已知過期的文字。

## 已儲存檔案的完整搜尋

```json
{"op":"search","query":"handleRequest","include":["src/**/*.ts"],"exclude":["**/generated/**"],"caseSensitive":true,"limit":500}
{"op":"findFiles","pattern":["src/**/*.ts"],"limit":500}
```

include／exclude 接受單一 glob 或陣列，不是以逗號分隔的模式語言。regex/wholeWord/caseSensitive 預設 false。useExcludes:false 包含隱藏與忽略的檔案；.git 管理路徑仍排除。否則使用 rg 忽略規則；不完整重現 VS Code 的條件式排除。

檢查 complete、state、exitCode、truncated 與 scope:saved_host_files。無匹配的退出碼 1 正常。輸出／結果限制或解析錯誤會使 complete 為 false。limit 預設 500，最大 10000。匹配包含相對路徑、從 1 開始的行號、文字與 UTF-8 位元組偏移；建構 UTF-16 編輯前請重新讀取相關文字。dirty 緩衝區另外報告，絕不自動儲存。

明確的 searchSnapshot/searchResults/findFilesSnapshot 保留有限的舊編輯器／提供者路徑，完整性未知；它們不需要 Host 存取，也不是自動備援。

## 命令與修補

```json
{"op":"hostExec","command":"node --test","cwd":"","timeoutMs":120000,"waitMs":1000}
{"op":"hostJobPoll","jobId":"<id>","waitMs":5000,"stdoutOffset":0,"stderrOffset":0}
{"op":"hostJobCancel","jobId":"<id>"}
{"op":"hostJobForget","jobId":"<id>"}
{"op":"applyPatch","patch":"<Git-style unified text patch>","checkOnly":true}
```

已知命令會修改檔案時，提供 affectedPaths（最多 100 個相對路徑）。只有受影響的已開啟緩衝區會與最終 Host 文字摘要核對；其他任意命令效果不追蹤。

命令在自有子處理程序中執行，並使用 Windows Job Object。逾時／取消只針對其處理程序樹，絕不終止共用 PowerShell。命令長度 1..8000，waitMs 0..5000，timeout 1000..3600000。狀態為 running/completed/timed_out/cancelled。completed 不代表退出碼為 0。輸出串流有界、持續排空並標記截斷；重用回傳的游標。只能 forget 已完成的工作。每次繫結最多保留 16 個工作。

修補最多 1 MiB／100 個檔案，使用 a/ 與 b/ 路徑，不能越出根目錄、修改 .git，或包含二進位／符號連結／子模組修補。套用前先執行 git apply --check。checkOnly:true 不套用；拒絕 dirty 目標。不 stage／commit／push。Host 必須有 Git。修補行尾遵循 Host Git 組態；需要原始位元組精確時改用位元組 API。

## 原始位元組和大型傳輸

```json
{"op":"hostStat","path":"asset.bin","withHash":true}
{"op":"readBytes","path":"asset.bin"}
{"op":"writeBytes","path":"asset.bin","base64":"<canonical base64>","parents":false}
{"op":"writeBytes","path":"asset.bin","base64":"<base64>","overwrite":true,"expectedCurrentSha256":"<raw Host hash>"}
{"op":"copy","path":"assets/a.png","to":"backup/a.png"}
{"op":"copyDirectory","path":"template","to":"new-template"}
```

小位元組 API 受 chunkBytes 限制並檢查 SHA-256。目錄複製需要新的目的地，並拒絕重新剖析點／Git 管理樹。路徑及其上層目錄都必須位於已驗證的 Host 根目錄內。覆蓋既有位元組需要原始 expectedCurrentSha256；文字雜湊不同。一般寫入不觸發額外的提供者驗證。

agent 以 MCP 工具 `lswb_upload_file` 上傳本機檔案，並以 `lswb_apply_patch_file` 套用本機修補檔；見 [MCP 指南](MCP.zh-TW.md)。上傳覆蓋需要 `overwrite` 與目標目前的原始 `expectedCurrentSha256`。已啟用的傳輸協定為 transferBeginWrite、transferWrite(sequence/base64)、transferCommit(sha256)、transferAbort。最大訊框大小仍為請求 2 MiB／回應 4 MiB；上傳使用多個有界區塊。

上傳暫存在 Host 自有的暫存檔中，關閉時刪除並有閒置過期；只在 commit 時更新目的地。立即重複的相同上傳序列具冪等性；一般修改絕不自動重送。commit 回應遺失時，須先檢查目標狀態／雜湊再重新開始。不支援的步驟需要具體的使用者協助請求，並在相依工作前取得回覆；見 [MCP 指南](MCP.zh-TW.md)。

大檔案下載（`transferOpenRead`／`transferRead`）回傳 `feature_unavailable`。請使用者提供可存取副本與本機路徑，不反覆小塊讀取或用原始命令繞過限制；小檔案位元組讀取與大檔案上傳仍可用。
