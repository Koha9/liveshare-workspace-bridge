# 架構

[English](ARCHITECTURE.md) | [简体中文](ARCHITECTURE.zh-CN.md) | **繁體中文** | [日本語](ARCHITECTURE.ja.md)

[文件](README.zh-TW.md)

## 請求路徑

```text
Codex skill or CLI
    → current-user Windows named pipe
    → PowerShell transport process
    → VS Code extension APIs
    → Live Share file provider
```

## 元件

| 元件 | 職責 |
|---|---|
| `extension/extension.cjs` | 啟用、通訊生命週期、執行個體探索與工作區 epoch |
| `extension/pipe-host.ps1` | 目前使用者的管道權限及 JSON 訊框轉送 |
| `extension/workspace.cjs` | 固定的檔案、文件、搜尋與語言操作 |
| `extension/core.cjs` | 路徑檢查、內容保護、換行處理及編輯規劃 |
| `extension/cli.cjs` | 探索、請求傳輸與 CLI 結束狀態 |
| `skills/liveshare-workspace-bridge/` | Codex 使用說明及獨立用戶端 |

## 工作區繫結

每個 VS Code 視窗都有執行個體 ID，工作區變更會更新 epoch。請求將選取的執行個體和 epoch 繫結到正確的根 URI，避免舊選擇悄悄指向另一個同樣使用 `vsls:/` 的專案。

探索記錄位於 `~/.liveshare-local/instances/`，只儲存連線中繼資料，不是存取權杖。擴充功能以隱藏視窗啟動管道輔助程序，該程序隨擁有者結束而退出。

## 文件操作

共享 URI 保留 `vsls:` scheme。讀取使用目前編輯器緩衝區。批次文字修改統一預檢後，以一份 WorkspaceEdit 提交，再逐文件儲存；多檔儲存不是不可分割的磁碟交易。

日常操作沿用文件版本與儲存回應。提供者回讀和文字雜湊只在明確要求時使用。請求送出後傳輸失敗會保留為結果未知，不自動重送。

## 存取邊界

Windows PowerShell 使用明確的目前使用者管道 ACL，PowerShell 7 可使用 `CurrentUserOnly`。橋接只開放固定操作，不執行任意 shell 或 VS Code 命令。同一 Windows 使用者執行的其他程式也可存取此介面。

Node 檔案系統 API 只處理本機請求檔案和探索記錄；虛擬資源透過 VS Code 與 Live Share 解析。橋接不提供 Host 執行環境。
