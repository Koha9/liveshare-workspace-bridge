# 故障排查

[English](TROUBLESHOOTING.md) | [简体中文](TROUBLESHOOTING.zh-CN.md) | **繁體中文** | [日本語](TROUBLESHOOTING.ja.md)

[文件](README.zh-TW.md)

## 連線與權限

將擴充套件安裝到 Live Share Guest 視窗的 Profile。更新後重新載入視窗、重新連線目標工作階段，再執行 CLI `instances`。按根目錄名稱和完整 `vsls:` URI 選擇專案，沿用 instance/epoch/workspace。重新載入後繫結失效需要重新發現。擴充套件 Output 通道報告具名管道啟動錯誤。

打開 **Live Share Workspace Bridge: Configure Agent Permissions**。agent 預設開啟，共用終端預設關閉；檢查組態權限和有效權限。開關由使用者控制，agent 不自行啟用來繞過拒絕。更改只阻止新工作，不撤銷已派發副作用。

## 執行中斷線與恢復

0.2.4 修正 broken pipe 清理：用戶端逾時斷線後，遲到回應寫入失敗可能令 IsConnected 變成 false，舊程式跳過 Disconnect，監聽迴圈持續失敗。現在會隔離 writer 清理例外、斷開 broken 連線，並在監聽器故障時退出而非空轉。真實 Windows 管道測試已涵蓋此情境；尚未確認視窗失焦是觸發原因。

已 ready 的 IPC helper 意外退出後，按 1／2／4 秒退避重啟，連續不穩定時最多三次；穩定 ready 一分鐘後重設次數。不需焦點事件或 Host 輪詢。啟動、策略、權限失敗及明確 Stop 不自動重啟。自動恢復保留 instance/epoch、Host 工作及不確定狀態，循序處理仍在執行的請求，絕不重送已發送操作。

仍斷線時先執行一次 diagnose。任務已授權恢復連線時，agent 可在目標 Guest 視窗的命令選擇區直接執行 **Live Share Workspace Bridge: Restart Connection**（`liveshareWorkspaceBridge.restart`）；按 Ctrl+Shift+P，或 Ctrl+P 後輸入 `>`。沒有可用 UI 工具時只請使用者執行一次。手動重啟改變 instance/epoch，使 Host 工作／傳輸句柄失效，之後按根名稱及完整 URI 重新探索一次。Host 不確定狀態仍保留，確認 Host 恢復後才能 acknowledgeRecovery。不可用重啟繞過權限、策略或主動 Stop，也不可重送結果未知的修改。IPC 恢復不會重新加入 Live Share 或修復缺失的 Host 終端。

## Host 終端缺失或無回應

Host 功能需要已連線的共用 RW Windows PowerShell，普通 Guest 終端不合格。缺少時 skill 只請求使用者開啟並共用一次，然後等待；多個候選需要準確名稱，不猜測或逐個嘗試，不切換執行路線。使用者確認後驗證一次，仍失敗就報告並等待，不反復提示或輪詢。

繫結通過自有隨機 bootstrap 臨時檔案驗證根目錄。已發送請求超時後通道隔離，不能重送修改。保留回報紀錄、檢查目標狀態，等待使用者確認終端空閑或已重新啟動，再以 `acknowledgeRecovery:true` 顯式重新繫結。超時診斷只有計數，不包含捕獲的檔案內容。

## 編輯與 Host 修改

使用當前版本進行受保護編輯，保留既有未儲存內容。已應用但儲存失敗時，用回傳版本只重試 `save`，不重新應用整批文字。批量儲存逐檔案完成，不是事務。

Host 寫入可能留下過期或 dirty 的 Guest 緩衝區。`editor_refresh_pending/external_change_dirty_document` 用於保護內容，不全域還原。請使用者解決衝突或安全重新打開檔案。`hostStat` 的 `withTextHash:true` 只刷新預期規范化摘要，不刷新編輯器。不要儲存已知過期文字。Guest 文字／EOL 與 Host 原始位元組不同；Host Git 可能將補丁結果轉成 CRLF。

## 搜尋與語言工具

Host rg 搜尋已儲存檔案；超限或失敗時 complete 為 false，無匹配退出碼 1 正常。dirty 文件單獨報告且不自動儲存。編輯器搜尋快照仍不完整。語言工具需要提供者，缺失時請使用者啟用或協助處理；空診斷不能證明建置或測試通過。

## 檔案與其他限制

位元組覆蓋需要當前 Host 原始 SHA-256。目錄複製只允許新目標，失敗可能留下部分目錄。遞歸刪除請使用者完成並確認；跨檔案原子儲存請使用合適 Host 工具，或由使用者明確接受逐檔案語義。對每個未解決步驟請求一次協助，說明準確路徑和目標結果，等待回覆後再繼續依賴工作；不能靜默跳過或用原始命令繞過。

遇到 `response_limit` 時請求相關範圍或更少結果。提供者的局部文字回應不代表底層流式讀取。參見 [API](API.zh-TW.md) 與[開發與驗證邊界](DEVELOPMENT.zh-TW.md)。

大檔案下載（`transferOpenRead`／`transferRead`，含 CLI download）回傳 `feature_unavailable`。請使用者提供可存取副本與本機路徑，不反覆小塊讀取或用原始命令繞過；小檔案位元組讀取與大檔案上傳仍可用。
