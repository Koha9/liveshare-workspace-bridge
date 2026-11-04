# Live Share Workspace Bridge

[English](README.md) | [简体中文](README.zh-CN.md) | **繁體中文** | [日本語](README.ja.md)

讓 AI agent 在已連線的 VS Code Live Share Guest 工作區中工作。agent 透過本機 MCP 伺服器與本機 Windows 具名管道存取擴充套件，不開啟任何網路連接埠。可選的 Host 通道使用 Live Share 轉送的 loopback 連接埠，並搭配每個輔助程式專屬的權杖。

## 功能

- 文件／範圍讀取、版本保護的批次編輯、僅儲存目標檔案。
- 可選 Host 通道：已儲存檔案搜尋、有界命令、檢查後套用文字修補、保留位元組的複製與大檔案上傳。
- 語言服務符號、定義、引用、重新命名與格式化；英文操作及 IPC 存取控制。

不提供遞迴刪除或跨檔案原子儲存。大檔案下載（`transferOpenRead`／`transferRead`）回傳 `feature_unavailable`。請使用者提供可存取副本與本機路徑，不反覆小塊讀取或用原始命令繞過限制；小檔案位元組讀取與大檔案上傳仍可用。

## 開始使用

需要 Windows、VS Code 1.101 以上版本與 Live Share，以及 Node.js。任何支援 MCP stdio 伺服器的 agent 都能使用本橋接，例如 Claude Code、Codex 或 VS Code 內建 agent。

1. 在 Live Share Guest 視窗安裝[擴充套件](https://marketplace.visualstudio.com/items?itemName=Koha9-Lee.liveshare-workspace-bridge)，並連線共用專案。
2. 執行 **Live Share Workspace Bridge: Copy MCP Server Configuration**，將複製的項目加入你的 agent。VS Code 內建 agent 會自動發現此伺服器。
3. 請 agent 呼叫 `lswb_list_workspaces` 並開始工作。

[MCP 指南](docs/MCP.zh-TW.md)說明各 agent 的設定方式、工具清單與結果語義。MCP 是唯一的 agent 介面。

Host 功能需要已連線的共用 RW Windows PowerShell、Host 存取（`host.enabled`，預設關閉）及相應權限；搜尋／修補另需 Host ripgrep／Git。共用終端只用來啟動一次 Host 輔助程式，之後由 Host 針對橋接顯示的連接埠執行一次「Live Share: Share Server」。見[設定說明](docs/SETTINGS.zh-TW.md)。

## 指南

[MCP](docs/MCP.zh-TW.md) | [設定說明](docs/SETTINGS.zh-TW.md) | [使用](docs/USAGE.zh-TW.md) | [API](docs/API.zh-TW.md) | [IPC 存取](docs/IPC-SECURITY.zh-TW.md) | [啟動診斷](docs/STARTUP-DIAGNOSTICS.zh-TW.md) | [開發](docs/DEVELOPMENT.zh-TW.md) | [更新記錄](docs/CHANGELOG.zh-TW.md)

[MIT](LICENSE)
