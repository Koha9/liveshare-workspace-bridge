# 疑難排解

[English](TROUBLESHOOTING.md) | [简体中文](TROUBLESHOOTING.zh-CN.md) | **繁體中文** | [日本語](TROUBLESHOOTING.ja.md)

[文件](README.zh-TW.md)

## 沒有執行個體或共用根目錄

將擴充功能安裝到 Live Share Guest 視窗使用的 Profile，更新後重新載入視窗，連線到目標工作階段，再執行 CLI 的 `instances`。本機 VS Code 視窗可能有執行個體但 `roots` 為空。依專案名稱及完整 `vsls:` URI 選擇 Guest 項目。連線停止時使用 **Live Share Workspace Bridge: Restart Connection**；同名輸出通道會記錄管道啟動錯誤。

從早期本機套件遷移時，解除安裝 `ucuni-local.liveshare-workspace-tools` 或 `Koha9-Lee.liveshare-workspace-tools`，安裝 `Koha9-Lee.liveshare-workspace-bridge`，並重新載入受影響的視窗。VS Code 將改名後的擴充功能視為獨立安裝，不應同時執行新舊擴充功能。若曾設定 PowerShell 路徑，請將其轉移至 `liveshareWorkspaceBridge.powershell`。

## 綁定、編輯及儲存

重新載入會改變執行個體 ID，工作區變更會更新 epoch。綁定錯誤後重新探索並選擇專案。遇到 `content_changed`，只重讀受影響文字，依目前版本調整編輯。預設保護 dirty 文件，只有明確希望包含其未儲存變更時才允許編輯。

編輯已套用仍可能儲存失敗。檢查逐檔儲存結果及 dirty 狀態；需要時僅以回執版本重試 `save`。傳輸失敗且 `requestSent:true` 表示結果未知，應先核對受影響目標，不能盲目重送修改。

## 搜尋及語言結果

內容搜尋傳回 `complete:null` 的搜尋檢視快照，沒有完成訊號。檔名搜尋可能遺漏新檔案，空結果不能證明不存在；已知路徑可直接讀取。語言查詢依賴專案語言提供者，空診斷不代表建置或測試通過。

## 文字、原始位元組及大小限制

文件編輯保留 Guest 緩衝區的換行樣式。Live Share 可能在 Host 儲存時正規化換行，因此 Guest 文字或 `providerRead` 不能證明 Host 原始位元組、編碼或換行完全一致。本版本不提供通用二進位寫入、目錄複製、遞迴刪除或 Host shell。

遇到 `response_limit`，減少要求的行數或檔案數。局部傳回不代表底層提供者串流讀取檔案。詳見 [API 限制](API.zh-TW.md)及[使用指南](USAGE.zh-TW.md)。
