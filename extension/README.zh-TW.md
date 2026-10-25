# Live Share Workspace Bridge

[English](README.md) | [简体中文](README.zh-CN.md) | **繁體中文** | [日本語](README.ja.md)

透過 Windows 具名管道，讓 Codex 或隨附 CLI 讀取、編輯及儲存已連線的 Live Share Guest 工作區檔案。

- 不需要 HTTP 監聽連接埠、複製權杖、npm 執行階段相依套件或 Host 安裝。
- 支援緩衝區讀取、多檔編輯、指定文件儲存、檔案操作、診斷與語言查詢。
- 原生內容搜尋傳回快照；檔名搜尋可能遺漏新檔案。

安裝到 Guest 視窗使用的 Profile，更新後依 VS Code 提示重新載入視窗。

命令：

- `Live Share Workspace Bridge: Restart Connection`
- `Live Share Workspace Bridge: Stop Connection`

詳見[使用指南](../docs/USAGE.zh-TW.md)、[API 參考](../docs/API.zh-TW.md)和[疑難排解](../docs/TROUBLESHOOTING.zh-TW.md)。

管道可供同一 Windows 使用者執行的程式存取，不提供 Host shell，也不隔離同使用者程式。

本專案採用 MIT 授權條款。詳見 [LICENSE](../LICENSE)。
