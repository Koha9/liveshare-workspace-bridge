# 架構

[English](ARCHITECTURE.md) | [简体中文](ARCHITECTURE.zh-CN.md) | **繁體中文** | [日本語](ARCHITECTURE.ja.md)

[文件](README.zh-TW.md)

## 模塊職責

- `extension.cjs`：當前使用者 IPC、生命周期和英文權限狀態欄。
- `permissions.cjs`：請求授權層，在派發和 Host 發送前讀取實時 User/machine 設定；agent 接口不能更改權限。
- `workspace.cjs`：文件版本、dirty 保護、文字預檢、語言編輯和目標儲存。Host 修改後保留模型保護，直到規范化內容匹配。
- `host-channel.cjs`：串行共用終端請求，以隨機 bootstrap 檔案核對根目錄，通過 nonce 和顯式結束標記封裝回應；大輸入在收到準備確認後走不回顯控制臺路徑。
- `host-operations.cjs`：公開 API 到窄 Host 操作的映射，將任務／傳輸繫結到 root 和 epoch。
- `host-actions.ps1`：載入記憶體中的 Host 工作階段輔助程式；`host-runtime.cs` 提供 Windows Job Object、有界輸出排空、分塊位元組句柄、SHA-256 和空閑過期。不安裝常駐 Host agent 或 HTTP 服務。
- `cli.cjs`：唯一規范客戶端，建置時複製到 skill；支援 JSON、文字補丁和分塊上傳。保留的下載入口由本版服務端能力門禁拒絕。

## 文件路徑與 Host 路徑

文字編輯預設使用文件 API，成功儲存後不重複讀取提供者。可選 Host 通道負責已儲存檔案搜尋、命令、補丁、位元組和目錄操作。原始 Host 執行需要全部操作權限；窄接口分別授權。這不是任意腳本的作業系統沙箱。

共用 URI 保留 `vsls:`，不能交給 Node 本機檔案系統。實例、epoch 和根目錄構成繫結，工作區改變時舊任務資源不能用於新專案。客戶端不自動重送已發送但結果未知的修改。

## 撤銷、故障與限制

撤銷權限阻止新工作，不復原已派發工作。子任務保留超時；同步檔案系統操作可能在 Guest 回應超時後仍完成。傳輸臨時資源有空閑過期；目錄複製可能部分失敗。沒有遞歸刪除或跨檔案落盤事務。

Host 寫入可能早於 Guest 刷新。擴充套件僅核對受影響的已打開文件，內容未匹配或緩衝區變臟時保留並報錯；不全域還原。skill 請求使用者協助處理持續衝突和其他未支援步驟，等待確認後再繼續依賴工作。

`pipe-security.cs` / `pipe-host.ps1`: 明確 owner／沙箱 DACL、本機與工作階段門檻、持續單執行個體管道、有界 UTF-8 輸入和回應排空。

`local-accounts.cs` 僅列舉本機 SAM 使用者並依穩定 SID 選擇；`ipc-access.cjs` 管理 User 模式、一次舊 SID 遷移及英文帳戶選擇器。

大檔案下載（`transferOpenRead`／`transferRead`，含 CLI download）回傳 `feature_unavailable`。請使用者提供可存取副本與本機路徑，不反覆小塊讀取或用原始命令繞過；小檔案位元組讀取與大檔案上傳仍可用。
