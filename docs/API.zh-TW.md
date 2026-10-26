# API 參考 v0.2

[English](API.md) | [简体中文](API.zh-CN.md) | **繁體中文** | [日本語](API.ja.md)

v0.2.2：**Configure IPC Access** 提供 ownerOnly（預設）、allLocalUsers 及穩定 SID 的 selectedUsers。舊 true 僅遷移既有指定帳戶，不自動允許全部帳戶。見 [IPC 三模式](IPC-SECURITY.zh-TW.md)，Host 權限獨立。

[文件](README.zh-TW.md)

## 協議

請求使用 `op`、`instance`、`epoch` 和準確的 `workspace` URI；CLI 同名參數可提供繫結資訊。共用路徑相對於選定根目錄，使用正斜線。回應為 `{ok:true,result:...}` 或 `{ok:false,error:{code,message,details?}}`；仍需檢查 `applied`、`saved`、逐檔案結果、`complete`、截斷、任務狀態和退出碼。請求上限 2 MiB，回應上限 4 MiB。

## 權限與 Host 繫結

設定名稱保留英文，位於 `liveshareWorkspaceBridge.*`，使用 machine scope，只能在 User／Remote 設定中組態，工作區不能覆蓋。

| 設定 | 含義 |
|---|---|
| `agent.enabled` | 總開關，預設 true；info/status 仍可檢查。 |
| `terminal.enabled` | Host 共用終端存取，預設 false；關閉時所有 Host 功能的有效權限關閉。 |
| `permissions.OPERATION` | 單項權限；別名繼承基礎操作，見 `info.permissions.configured/effective`。 |
| `terminal.name` | 準確的共用 RW 終端名；留空時必須只有一個合格共用終端，排除 Guest 本機終端。 |
| `terminal.hostWorkspacePath` | 可選顯式 Host 根目錄；否則驗證共用 PowerShell 當前目錄。 |
| `terminal.commandTimeoutMs` | 預設 120000，範圍 1000..3600000 毫秒。 |
| `terminal.maxOutputCharacters` | stdout/stderr 各自保留的字元數，預設 65536，範圍 1024..262144。 |
| `transfer.chunkBytes` | 單塊原始位元組數，預設 32768，範圍 1024..65536。 |
| `transfer.idleTimeoutMs` | 傳輸句柄／暫存資源空閑壽命，預設 120000，範圍 10000..900000 毫秒。 |

原始 Host 命令要求全部操作權限，避免繞過細分限制。文件修改需要 save 權限；創建父目錄需要 mkdir；覆蓋位元組檔案需要 write。這些是操作授權，不是作業系統檔案沙箱。

```json
{"op":"hostStatus"}
{"op":"hostBind"}
```

`hostStatus` 不發送終端命令。`hostBind` 通過自有隨機臨時 bootstrap 檔案驗證 Host/Guest 根目錄，載入記憶體工作階段輔助程式後刪除檔案；不安裝常駐 Host agent，不改身份驗證。目前 Host 僅支援 Windows PowerShell。關閉權限阻止新請求，不撤銷已派發操作。

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

讀取回傳緩沖文字、version、dirty、EOL 和 lineCount；行號從 1 開始，兩端包含。`withHash:true` 是文件文字雜湊，不是 Host 原始位元組雜湊。一次回傳文字上限 1 MiB，打開文件仍可能存取完整提供者資源。

`edit.files` 最多 100 個不同目標，每檔案最多 1000 項修改。`oldText` 預設必須唯一，刻意全替換才用 `all:true`。位置相對於原始內容且不得重疊。按行編輯使用 `startLine/endLine/newText/expectedText?`，不包含最後的換行分隔符。原生範圍采用從 0 開始的行號和 UTF-16 字元位置，結束位置不包含在內，並支援版本／雜湊／原文保護。整文件 `write` 需要 `expectedVersion` 或 `expectedHash`。

文字按 Guest 文件 EOL 規范化，Host 協同編輯可能采用不同磁盤換行。只儲存目標文件，不提供跨檔案事務；部分失敗明確報告。`allowDirty:true` 表示包含保留和儲存既有未儲存內容。

`symbols`、`workspaceSymbols`、`definition`、`diagnostics` 保留。語言查詢輸入使用從 1 開始的行號和從 0 開始的 UTF-16 字元位置。重新命名和格式化檢查範圍、版本和 dirty 狀態並儲存目標；重新命名只重建文字編輯，不應用提供者回傳的檔案操作。`preview:true` 只回傳計劃。格式化需要語言提供者。

`delete` 拒絕 `recursive:true`。`stat` 是可能缺少大小／時間的提供者中繼資料；`providerRead` 是顯式 UTF-8 驗證，不是二進位讀。Host 寫入在同一回應中僅為受影響的已打開 Guest 文件計算規范化摘要，每檔案上限 16 MiB。`hostStat` 的 `withTextHash:true` 可在結果未知後顯式刷新預期摘要；干凈緩衝區必須內容匹配，版本增加本身不夠。未刷新時報告 `editor_refresh_pending`，保留內容，不全域還原或回傳已知過期文字。

## 已儲存檔案的完整搜尋

```json
{"op":"search","query":"handleRequest","include":["src/**/*.ts"],"exclude":["**/generated/**"],"caseSensitive":true,"limit":500}
{"op":"findFiles","pattern":["src/**/*.ts"],"limit":500}
```

include/exclude 接受單個 glob 或數組，不是逗號分隔的模式語言。`regex/wholeWord/caseSensitive` 預設 false。`useExcludes:false` 包含隱藏和忽略檔案，但始終排除 `.git` 管理路徑；否則使用 rg 忽略規則，不完全重現 VS Code 條件排除。

檢查 `complete/state/exitCode/truncated` 和 `scope:saved_host_files`。無匹配退出碼 1 正常。輸出／結果限制或解析失敗使 complete 為 false。limit 預設 500、最大 10000。匹配包含相對路徑、從 1 開始的行號、文字和 UTF-8 位元組偏移；構造 UTF-16 編輯前讀取相關文字。dirty 文件單獨報告，絕不自動儲存。

`searchSnapshot/searchResults/findFilesSnapshot` 顯式保留舊編輯器／提供者接口，完整性未知；不需要 Host，但不是 Host 缺失時的自動替代。

## 命令與補丁

```json
{"op":"hostExec","command":"node --test","cwd":"","timeoutMs":120000,"waitMs":1000}
{"op":"hostJobPoll","jobId":"<id>","waitMs":5000,"stdoutOffset":0,"stderrOffset":0}
{"op":"hostJobCancel","jobId":"<id>"}
{"op":"hostJobForget","jobId":"<id>"}
{"op":"applyPatch","patch":"<Git-style unified text patch>","checkOnly":true}
```

已知命令會修改檔案時，提供 `affectedPaths`，最多 100 個相對路徑。只針對這些已打開緩衝區檢查最終 Host 文字摘要；其他任意副作用不追蹤。

命令執行在自有子處理程序和 Windows Job Object 中。超時／取消只針對其處理程序樹，不終止共用 PowerShell。命令長度 1..8000，`waitMs` 0..5000，timeout 1000..3600000 毫秒。狀態為 `running/completed/timed_out/cancelled`，completed 不代表退出碼為 0。輸出流有界、持續排空並標記截斷；重用回傳的輸出游標。只能 forget 已結束任務；每次繫結最多保留 16 個任務。

文字補丁最多 1 MiB／100 檔案，使用 `a/`、`b/` 路徑；拒絕越界、`.git`、二進位、符號鏈接和子模塊補丁。先 `git apply --check` 再應用；`checkOnly:true` 不寫入，拒絕 dirty 目標。Host 需要 Git，不自動 stage/commit/push。補丁行尾跟隨 Host Git 組態；需要位元組精確保真時用位元組 API。

## 原始位元組和大檔案上傳

```json
{"op":"hostStat","path":"asset.bin","withHash":true}
{"op":"readBytes","path":"asset.bin"}
{"op":"writeBytes","path":"asset.bin","base64":"<canonical base64>","parents":false}
{"op":"writeBytes","path":"asset.bin","base64":"<base64>","overwrite":true,"expectedCurrentSha256":"<raw Host hash>"}
{"op":"copy","path":"assets/a.png","to":"backup/a.png"}
{"op":"copyDirectory","path":"template","to":"new-template"}
```

小位元組 API 受 chunkBytes 限制並校驗 SHA-256。目錄複製目標必須新建，拒絕重解析點和 Git 管理樹；路徑及祖先保持在已驗證 Host 根目錄內。覆蓋現有位元組檔案需要 `expectedCurrentSha256`，與文字雜湊不同。普通寫入不預設追加提供者驗證。

```powershell
node "<client>" upload --instance "<id>" --epoch "<epoch>" --workspace "vsls:/" --input "<local.bin>" --path "assets/file.bin"
node "<client>" apply-patch --instance "<id>" --epoch "<epoch>" --workspace "vsls:/" --input "<local.patch>" --check-only
```

上傳覆蓋需要 `--overwrite` 和 `--expected-current-sha256 HASH`。當前開放的傳輸協議為 `transferBeginWrite`、`transferWrite(sequence/base64)`、`transferCommit(sha256)`、`transferAbort`；檔案通過多個有界塊上傳。

上傳暫存在 Host 自有臨時檔案中，關閉時刪除並有空閑過期機制，只在 commit 時更新目標。立即重複上一上傳序號及相同內容是冪等的，普通修改不會自動重送。提交回報紀錄丟失時先檢查目標狀態和雜湊，再決定是否重新啟動。

**大檔案下載本版停用**：`transferOpenRead/transferRead`（含 CLI download）在 Host 派發前回傳 `feature_unavailable`。約 1.1 MB 的實際下載曾反復使終端停住，根因未解決；禁止迴圈小塊讀取繞過。小檔案讀取和大檔案上傳仍可用。未支援的任務需要按 skill 請求使用者提供準確的手動結果或可存取副本，並在回覆後繼續依賴步驟。
