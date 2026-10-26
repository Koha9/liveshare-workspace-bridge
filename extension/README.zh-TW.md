# Live Share Workspace Bridge v0.2

[English](README.md) | [简体中文](README.zh-CN.md) | **繁體中文** | [日本語](README.ja.md)

通過僅當前使用者可存取的 Windows IPC 讀取、編輯和儲存共用文件。可選的已驗證 Host RW PowerShell 通道提供已儲存檔案完整搜尋、有界命令、經檢查的文字補丁、保持位元組的複製和分塊大檔案上傳，無需 HTTP 連接埠或複製 token。

打開 **Live Share Workspace Bridge: Configure Agent Permissions**。英文 User 設定提供 agent 總開關、單項權限和聯動終端開關（預設關閉）。狀態欄顯示權限模式，Host allowed 不代表已驗證連線。缺少 Host 終端時 skill 請求使用者一次並等待，不用普通 Guest 終端替代。

遞歸刪除和跨檔案儲存事務不可用。Host 搜尋只覆蓋已儲存檔案；文件 EOL 不證明 Host 位元組一致。需要未支援步驟時，請使用者協助並等待，不能繞過。參見[使用指南](../docs/USAGE.zh-TW.md)、[API](../docs/API.zh-TW.md)、[開發指南](../docs/DEVELOPMENT.zh-TW.md)和[驗收記錄](../docs/VALIDATION-v0.2.zh-TW.md)。

大檔案下載 `transferOpenRead/transferRead`（含 CLI download）本版在 Host 派發前回傳 `feature_unavailable`。約 1.1 MB 的實際下載多次使終端停住，等待可靠傳輸方案；不要迴圈小塊讀取繞過。小檔案位元組讀取和大檔案上傳仍可用。
