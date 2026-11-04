# Live Share Workspace Bridge

[English](README.md) | [简体中文](README.zh-CN.md) | **繁體中文** | [日本語](README.ja.md)

讓 AI agent 在已連線的 VS Code Live Share Guest 工作區中工作。agent 透過本機 MCP 伺服器與本機 Windows 具名管道存取擴充套件，不開啟任何網路連接埠。可選的 Host 通道使用 Live Share 轉送的 loopback 連接埠，並搭配每個輔助程式專屬的權杖。

## 功能

- 文件／範圍讀取、版本保護的批次編輯、僅儲存目標檔案。
- 可選 Host 通道：已儲存檔案搜尋、有界命令、檢查後套用文字修補、保留位元組的複製與大檔案上傳。
- 語言服務符號、定義、引用、重新命名與格式化；英文操作及 IPC 存取控制。

不提供遞迴刪除或跨檔案原子儲存。大檔案下載（`transferOpenRead`／`transferRead`）回傳 `feature_unavailable`。請使用者提供可存取副本與本機路徑，不反覆小塊讀取或用原始命令繞過限制；小檔案位元組讀取與大檔案上傳仍可用。

## 前置條件

- Windows、VS Code 1.101 以上版本，以及 Live Share 擴充套件。
- 執行 agent 與 VS Code 的 Windows 帳戶，其 `PATH` 中要有 Node.js。MCP 伺服器以 `node` 命令啟動。
- 本擴充套件只安裝在 **Guest** 視窗，也就是加入 Live Share 工作階段的 VS Code 視窗。Host 端不需要安裝任何東西。
- 支援 MCP stdio 伺服器的 agent，例如 Claude Code、Codex 或 VS Code 內建 agent。

## 1. 安裝與連線

1. 在 Guest 的 VS Code 視窗中，從 Marketplace 安裝 [Live Share Workspace Bridge](https://marketplace.visualstudio.com/items?itemName=Koha9-Lee.liveshare-workspace-bridge)，或用 **Extensions: Install from VSIX...** 安裝 VSIX。
2. 在該視窗中加入 Host 的 Live Share 工作階段。

## 2. 設定 MCP

在命令選擇區執行 **Live Share Workspace Bridge: Copy MCP Server Configuration**。它會把 Claude Code、Codex 與 VS Code 可直接貼上的設定片段複製到剪貼簿，同時輸出到「Live Share Workspace Bridge」輸出通道。複製的片段包含你的實際路徑；下面的範例以預留位置 `<home>` 代表你的使用者設定檔資料夾。

所有設定都指向啟動器 `<home>/.liveshare-local/mcp-server.cjs`。擴充套件啟用時會安裝並更新這個檔案。啟動器一律啟動目前執行中擴充套件版本的 MCP 伺服器，因此擴充套件升級後不需要修改 agent 設定。

### Claude Code

```text
claude mcp add lswb -- node "<home>/.liveshare-local/mcp-server.cjs"
```

在 `add` 後加上 `--scope user`，即可讓所有專案都能使用此伺服器。

### Codex

在 `~/.codex/config.toml` 中加入：

```toml
[mcp_servers.lswb]
command = "node"
args = ["<home>/.liveshare-local/mcp-server.cjs"]
```

### VS Code 內建 agent

不需要設定：擴充套件會以「Live Share Workspace Bridge」的名稱向 VS Code 註冊此伺服器，它會出現在 VS Code 的 MCP 伺服器清單中。如果你偏好明確寫出設定，可改在 `.vscode/mcp.json` 或使用者 `mcp.json` 中加入：

```json
{
  "servers": {
    "lswb": {
      "type": "stdio",
      "command": "node",
      "args": ["<home>/.liveshare-local/mcp-server.cjs"]
    }
  }
}
```

### 其他 MCP 用戶端

任何能啟動 stdio 伺服器的用戶端都可以使用。command 填 `node`，參數只有一個，即啟動器路徑 `<home>/.liveshare-local/mcp-server.cjs`。不需要環境變數。

加入伺服器後，請重新啟動或重新載入 agent，讓它啟動此伺服器：開啟新的 Claude Code 工作階段、重新啟動 Codex，或在 VS Code 的 MCP 伺服器清單中啟動它。

## 3. 第一次呼叫

請 agent 先呼叫 `lswb_list_workspaces`。它會回傳共用根目錄；其他所有工具都以準確的根 `uri`（`vsls:` URI）作為 `workspace` 參數。提示詞範例：

> 使用 lswb 工具。先呼叫 lswb_list_workspaces，選擇共用專案，然後讀取其中的 README.md。

完整工具清單與結果語義見 [MCP 指南](docs/MCP.zh-TW.md)。MCP 是唯一的 agent 介面。

## 4. 可選：Host 通道

搜尋、命令、修補、位元組複製與上傳在 Host 上執行。使用方式：

1. **Guest：** 執行 **Live Share Workspace Bridge: Configure Agent Permissions**。它會開啟本擴充套件的設定；開啟 **Allow Host Access**（`host.enabled`，預設關閉）。各操作開關預設開啟；原始命令（`lswb_host_exec`）需要全部開啟。
2. **Host：** 在 Live Share 中以讀寫權限共用一個 Windows PowerShell 終端。**Guest：** 開啟該共用終端。如果有多個共用終端，請將 `host.terminalName` 設為準確的名稱。
3. **agent：** 呼叫 `lswb_host_bind`。橋接會在共用終端輸入一行啟動命令來啟動 Host 輔助程式；輔助程式在前景、記憶體中執行，不安裝任何東西。此呼叫回傳 `handshake.state: "waitingForward"` 與 `hostPort`，Guest 視窗也會在通知中顯示同一個連接埠。
4. **Host：** 執行 **Live Share: Share Server** 並輸入該連接埠。
5. **agent：** 呼叫 `lswb_host_status`，直到它回報 `bound: true`。之後即可使用 Host 工具。

要停止 Host 輔助程式，請在共用終端按 Ctrl+C。終端關閉、工作階段結束，或連續 `host.idleTimeoutMinutes`（預設 30）分鐘沒有請求時，它也會結束。搜尋需要 Host 上有 ripgrep（`rg`），修補需要 Git。見[設定說明](docs/SETTINGS.zh-TW.md)。

## 常見問題速查

- **`lswb_list_workspaces` 找不到工作區（`no_records`），或啟動器回報找不到執行中的執行個體：** 確認 Guest 視窗已開啟、擴充套件已啟用並已加入工作階段，且 agent 與 VS Code 在同一個 Windows 帳戶下執行（IPC 存取預設僅限擁有者）。必要時重新載入 Guest 視窗。見[故障排查](docs/TROUBLESHOOTING.zh-TW.md)與 [IPC 存取](docs/IPC-SECURITY.zh-TW.md)。
- **agent 無法啟動伺服器，或無法辨識 `node`：** 安裝 Node.js 或將它加入 `PATH`，然後重新啟動 agent 與 VS Code。也可以在設定中把 `node` 換成 `node.exe` 的完整路徑。
- **Host 通道一直停在 `waitingForward`：** Host 還沒有共用連接埠。請在 Host 上以準確的 `hostPort` 執行 **Live Share: Share Server**。如果 Live Share 把它轉送到 Guest 上的其他本機連接埠，請設定 `host.guestPort`。等待會在 `host.handshakeTimeoutMinutes` 後結束。見[設定說明](docs/SETTINGS.zh-TW.md)。
- **擴充套件升級後：** 重新載入 Guest 視窗並重新啟動 agent，讓它啟動新版本的伺服器。啟動器路徑不變，不需要修改設定。
- **狀態列顯示「LSWB: IPC failed」：** 執行 **Live Share Workspace Bridge: Show Startup Diagnostics**。見[啟動診斷](docs/STARTUP-DIAGNOSTICS.zh-TW.md)。

## 指南

[MCP](docs/MCP.zh-TW.md) | [設定說明](docs/SETTINGS.zh-TW.md) | [使用](docs/USAGE.zh-TW.md) | [API](docs/API.zh-TW.md) | [IPC 存取](docs/IPC-SECURITY.zh-TW.md) | [啟動診斷](docs/STARTUP-DIAGNOSTICS.zh-TW.md) | [故障排查](docs/TROUBLESHOOTING.zh-TW.md) | [開發](docs/DEVELOPMENT.zh-TW.md) | [更新記錄](docs/CHANGELOG.zh-TW.md)

[MIT](LICENSE)
