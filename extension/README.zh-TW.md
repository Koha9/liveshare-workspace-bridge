# Live Share Workspace Bridge

[English](README.md) | [简体中文](README.zh-CN.md) | **繁體中文** | [日本語](README.ja.md)

透過本機 Windows IPC 操作已連線的 VS Code Live Share Guest 工作區，無需 HTTP 連接埠或複製 token。

- 文件／範圍讀取、版本保護的批次編輯、僅儲存目標檔案。
- 可選 Host 通道：已儲存檔案搜尋、有界命令、檢查後套用文字修補、保留位元組的複製與大檔案上傳。
- 語言服務符號、定義、引用、重新命名與格式化；英文操作及 IPC 設定。

不提供遞迴刪除或跨檔案原子儲存。 大檔案下載（`transferOpenRead`／`transferRead`，含 CLI download）回傳 `feature_unavailable`。請使用者提供可存取副本與本機路徑，不反覆小塊讀取或用原始命令繞過；小檔案位元組讀取與大檔案上傳仍可用。

[使用](../docs/USAGE.zh-TW.md) | [API](../docs/API.zh-TW.md) | [IPC 接入](../docs/IPC-SECURITY.zh-TW.md) | [啟動診斷](../docs/STARTUP-DIAGNOSTICS.zh-TW.md) | [開發](../docs/DEVELOPMENT.zh-TW.md) | [更新記錄](../docs/CHANGELOG.zh-TW.md)

## 開始使用

需要 Windows、VS Code Live Share 與 Node.js。

1. 在 Live Share Guest 視窗安裝[擴充套件](https://marketplace.visualstudio.com/items?itemName=Koha9-Lee.liveshare-workspace-bridge)，並連線共用專案。
2. 請 agent 從 [Releases](https://github.com/Koha9/liveshare-workspace-bridge/releases) 安裝與擴充套件版本匹配的 skill。
3. 請 agent 使用 `$liveshare-workspace-bridge` 開始工作。

Host 功能需要已連線共用 RW Windows PowerShell 和相應權限，搜尋／修補另需 Host ripgrep／Git；終端權限預設關閉。見[設定說明](../docs/SETTINGS.zh-TW.md)。
