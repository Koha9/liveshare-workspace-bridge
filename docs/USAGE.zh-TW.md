# 使用指南 v0.2

[English](USAGE.md) | [简体中文](USAGE.zh-CN.md) | **繁體中文** | [日本語](USAGE.ja.md)

v0.2.2：**Configure IPC Access** 提供 ownerOnly（預設）、allLocalUsers 及穩定 SID 的 selectedUsers。舊 true 僅遷移既有指定帳戶，不自動允許全部帳戶。見 [IPC 三模式](IPC-SECURITY.zh-TW.md)，Host 權限獨立。

[文件](README.zh-TW.md)

1. 在已連線 Guest 視窗的 Profile 安裝 VSIX，並安裝匹配的 skill。
2. 發現一次目標專案，後續固定 `instance`、`epoch` 和完整 `workspace` URI。
3. 打開 **Live Share Workspace Bridge: Configure Agent Permissions**。agent 預設開啟，終端預設關閉；使用者手動調整英文操作開關。
4. 使用 Host 功能時，請 Host 共用可讀寫 Windows PowerShell，並在 Guest 連線。多個共用終端需要指定準確名稱。可顯式組態 Host 根目錄，不猜測路徑。
5. 在授權任務中調用 `hostStatus`／`hostBind`。終端缺失時只請求使用者一次並等待，不使用普通 Guest 終端或繞過設定。

## 文字操作

使用 `read`／`readMany` 並保留版本；相關修改合併到一次 `edit`，檢查 `applied`、`saved` 和每個目標的 dirty 狀態。成功後不預設追加全文驗證。`create` 用於新檔案，受保護的 `write` 用於整文件替換；儲存失敗只重試 `save`，不要重新應用編輯。

未儲存緩衝區預設受保護；`allowDirty:true` 必須包含保留並儲存已有編輯的意圖。文件 EOL 反映 Guest 狀態，與 Host 原始位元組是不同保證。

## 搜尋、命令和補丁

`search`／`findFiles` 通過 Host rg 搜尋，報告完整性、限制和退出碼；無匹配的退出碼 1 正常。它們只覆蓋已儲存檔案，不覆蓋 dirty 緩衝區，不自動 `saveAll`。編輯器快照是顯式且不完整的獨立接口。

`hostExec` 回傳有界輸出的任務。使用有意義的 `waitMs` 和輸出游標輪詢，避免忙迴圈；取消只作用於自有處理程序樹。報告實際退出碼。原始命令要求全部操作權限；受限時只使用符合任務的已允許窄接口，不繞過限制。已知檔案修改應聲明 `affectedPaths`，任意其他副作用不會自動追蹤。

`applyPatch` 校驗路徑並先執行 Host Git 檢查，`checkOnly:true` 只檢查不應用。補丁行尾受 Host Git 組態影響；不隱含 stage、commit 或 push。

## 位元組和大檔案

小數據用 `readBytes`／`writeBytes`。複製由 Host 完成，因為 Live Share 文字提供者不能保證二進位位元組。目錄複製目標必須是新目錄。大檔案用 CLI `upload`，不要將整個檔案塞入一個 JSON 請求。上傳校驗 SHA-256；覆蓋現有檔案需要當前原始位元組雜湊。

大檔案下載本版停用，`transferOpenRead`／`transferRead` 回傳 `feature_unavailable`。約 1.1 MB 的實際下載曾使共用終端停住；不迴圈小塊讀取繞過。小檔案位元組讀取和大檔案上傳仍可用。

## 錯誤、控制與使用者協助

總開關和終端開關即時約束後續請求，不撤銷已經派發的工作。agent 報告權限拒絕，不自行啟用。結果未知的已發送修改必須先檢查狀態，不能盲目重送。

Host 寫入可能早於 Guest 模型刷新。擴充套件只對受影響的已打開緩衝區進行規范化文字雜湊核對，不全域還原編輯器。出現 `editor_refresh_pending` 或 `external_change_dirty_document` 時保留內容，必要時請使用者解決衝突或安全重新打開檔案。

遞歸刪除和跨檔案原子儲存不可用。skill 對每個未解決步驟請求一次使用者協助，說明準確路徑和需要的結果，並等待回覆：大檔案下載請提供可存取副本；遞歸刪除請確認使用者手動刪除；原子儲存請使用合適 Host 工具，或明確接受逐檔案儲存。語言服務缺失和持續緩衝區衝突也請使用者處理，不用原始命令繞過。獨立且受支援的工作可以繼續。

參數和限制見 [API](API.zh-TW.md)，復原說明見[故障排查](TROUBLESHOOTING.zh-TW.md)，測試邊界見[驗收記錄](VALIDATION-v0.2.zh-TW.md)。
