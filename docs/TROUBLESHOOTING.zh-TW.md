# 故障排查 v0.2

[English](TROUBLESHOOTING.md) | [简体中文](TROUBLESHOOTING.zh-CN.md) | **繁體中文** | [日本語](TROUBLESHOOTING.ja.md)

[文件](README.zh-TW.md)

## 連線與權限

將擴充套件安裝到 Live Share Guest 視窗的 Profile。更新後重新載入視窗、重新連線目標工作階段，再執行 CLI `instances`。按根目錄名稱和完整 `vsls:` URI 選擇專案，沿用 instance/epoch/workspace。重新載入後繫結失效需要重新發現。擴充套件 Output 通道報告具名管道啟動錯誤。

打開 **Live Share Workspace Bridge: Configure Agent Permissions**。agent 預設開啟，共用終端預設關閉；檢查組態權限和有效權限。開關由使用者控制，agent 不自行啟用來繞過拒絕。更改只阻止新工作，不撤銷已派發副作用。

## Host 終端缺失或無回應

Host 功能需要已連線的共用 RW Windows PowerShell，普通 Guest 終端不合格。缺少時 skill 只請求使用者開啟並共用一次，然後等待；多個候選需要準確名稱，不猜測或逐個嘗試，不切換執行路線。使用者確認後驗證一次，仍失敗就報告並等待，不反復提示或輪詢。

繫結通過自有隨機 bootstrap 臨時檔案驗證根目錄。已發送請求超時後通道隔離，不能重送修改。保留回報紀錄、檢查目標狀態，等待使用者確認終端空閑或已重新啟動，再以 `acknowledgeRecovery:true` 顯式重新繫結。超時診斷只有計數，不包含捕獲的檔案內容。

實際大檔案下載曾使終端停住，本版已停用；不迴圈位元組讀取模擬。大檔案上傳和有界位元組 API 有實測證據。新增輸出節流尚未證明可修復持續下載。需要下載時請使用者提供可存取副本和本機路徑。

## 編輯與 Host 修改

使用當前版本進行受保護編輯，保留既有未儲存內容。已應用但儲存失敗時，用回傳版本只重試 `save`，不重新應用整批文字。批量儲存逐檔案完成，不是事務。

Host 寫入可能留下過期或 dirty 的 Guest 緩衝區。`editor_refresh_pending/external_change_dirty_document` 用於保護內容，不全域還原。請使用者解決衝突或安全重新打開檔案。`hostStat` 的 `withTextHash:true` 只刷新預期規范化摘要，不刷新編輯器。不要儲存已知過期文字。Guest 文字／EOL 與 Host 原始位元組不同；Host Git 可能將補丁結果轉成 CRLF。

## 搜尋與語言工具

Host rg 搜尋已儲存檔案；超限或失敗時 complete 為 false，無匹配退出碼 1 正常。dirty 文件單獨報告且不自動儲存。編輯器搜尋快照仍不完整。語言工具需要提供者，缺失時請使用者啟用或協助處理；空診斷不能證明建置或測試通過。

## 檔案與其他限制

位元組覆蓋需要當前 Host 原始 SHA-256。目錄複製只允許新目標，失敗可能留下部分目錄。遞歸刪除請使用者完成並確認；跨檔案原子儲存請使用合適 Host 工具，或由使用者明確接受逐檔案語義。對每個未解決步驟請求一次協助，說明準確路徑和目標結果，等待回覆後再繼續依賴工作；不能靜默跳過或用原始命令繞過。

遇到 `response_limit` 時請求相關範圍或更少結果。提供者的局部文字回應不代表底層流式讀取。參見 [API](API.zh-TW.md) 與[驗收記錄](VALIDATION-v0.2.zh-TW.md)。
