# MCP 伺服器

[English](MCP.md) | [简体中文](MCP.zh-CN.md) | **繁體中文** | [日本語](MCP.ja.md)

[文件](README.zh-TW.md)

Live Share Workspace Bridge 隨附一個 Model Context Protocol（MCP）伺服器。你的 agent 會在 Guest 機器上以本機 stdio 處理程序啟動它。伺服器透過橋接的本機 Windows 具名管道存取執行中的 VS Code 擴充套件，不開啟任何網路連接埠。

MCP 是唯一的 agent 介面。任何能啟動 stdio 伺服器的 MCP 用戶端都能使用它，例如 Claude Code、Codex 或 VS Code 內建 agent。

## 設定

需求：Windows、VS Code 1.101 以上版本與 Live Share、`PATH` 中的 Node.js，以及已安裝在 Live Share Guest 視窗中的擴充套件。

1. 開啟 Guest 視窗並連線共用專案。
2. 從命令選擇區執行 **Live Share Workspace Bridge: Copy MCP Server Configuration**。這會將可直接貼上的片段複製到剪貼簿，同時輸出到「Live Share Workspace Bridge」輸出通道。
3. 使用下列其中一種方式將伺服器加入你的 agent。

擴充套件啟用時，會在 `<home>/.liveshare-local/mcp-server.cjs` 安裝一個小型啟動器。啟動器一律從目前執行中的擴充套件版本啟動伺服器，因此擴充套件升級後不需變更 agent 組態。複製的片段包含你的實際路徑。以下範例使用預留位置 `<home>`。

### Claude Code

```text
claude mcp add lswb -- node "<home>/.liveshare-local/mcp-server.cjs"
```

### Codex

將以下內容加入 `~/.codex/config.toml`：

```toml
[mcp_servers.lswb]
command = "node"
args = ["<home>/.liveshare-local/mcp-server.cjs"]
```

### VS Code 內建 agent

擴充套件以「Live Share Workspace Bridge」名稱向 VS Code 註冊此伺服器，因此內建 agent 不需任何設定即可發現它。若你偏好明確的項目，請將以下內容加入 `.vscode/mcp.json` 或使用者的 `mcp.json`：

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

### 第一次呼叫

請 agent 呼叫 `lswb_list_workspaces`。它會回傳共用的根目錄。其他所有工具都以該根目錄的完整 `uri`（`vsls:` URI）作為 `workspace` 引數。

### 探索結果

`lswb_list_workspaces` 回傳 `status`、`workspaces`、`probes` 與 `issues`。`status` 為下列其中之一：

- `ready`：找到共用根目錄，且每筆記錄都有回應；
- `partial`：找到共用根目錄，但部分記錄或探測失敗；
- `no_shared_workspace`：有橋接回應，但沒有共用任何根目錄；
- `no_records`：找不到有效的橋接執行個體。

探索失敗（`discovery_access_denied`、`discovery_unavailable`、`discovery_invalid_registry`）以工具錯誤回傳。

重新載入或當機的 VS Code 視窗可能留下其探索記錄。當其管道不存在且擁有者處理程序已結束時，該探測回報為 `status: "stale"` 並附 `ownerProcess: "exited"`。它不會使探索結果變成 `partial`，擴充套件也會在下次啟用時移除此類記錄。

## 工具

下表列出 v0.3.0 的 36 個工具。每個工具的 MCP 描述包含完整契約。所有工具仍受橋接權限設定約束。

- **修改檔案**：工具是否可能變更工作區檔案。
- **Host 通道**：工具是否需要 [Host 工具](#host-工具)所述的可選 Host 通道。

| 工具 | 用途 | 修改檔案 | Host 通道 |
|---|---|---|---|
| `lswb_list_workspaces` | 列出可透過本機橋接存取的 Live Share Guest 工作區。 | 否 | 否 |
| `lswb_status` | 回報工作區的橋接狀態：執行個體身分、epoch、根目錄、權限、dirty 文件與 MCP 伺服器身分。 | 否 | 否 |
| `lswb_list_dir` | 列出共用目錄的項目（名稱與檔案類型）。 | 否 | 否 |
| `lswb_read_file` | 從編輯器緩衝區讀取文字文件，可指定從 1 開始、兩端包含的行範圍。 | 否 | 否 |
| `lswb_read_many` | 在一次請求中讀取最多 50 份文字文件。 | 否 | 否 |
| `lswb_create_file` | 建立新文字檔並儲存；檔案已存在時失敗。 | 是 | 否 |
| `lswb_write_file` | 替換既有文件的全部文字並儲存。 | 是 | 否 |
| `lswb_edit_file` | 以單一工作區編輯對最多 100 份文件套用文字替換，然後儲存每個目標。 | 是 | 否 |
| `lswb_save_file` | 儲存一份有未儲存編輯器變更的文件。 | 是 | 否 |
| `lswb_mkdir` | 建立目錄，包括缺少的父目錄。 | 是 | 否 |
| `lswb_stat` | 回傳路徑的提供者中繼資料：類型、大小、mtime、ctime。 | 否 | 否 |
| `lswb_move` | 在工作區內移動或重新命名檔案或目錄。 | 是 | 否 |
| `lswb_delete` | 刪除單一檔案或空目錄（不經資源回收筒）。 | 是 | 否 |
| `lswb_diagnostics` | 回傳文件或整個根目錄的語言診斷。 | 否 | 否 |
| `lswb_document_symbols` | 回傳文件的符號大綱。 | 否 | 否 |
| `lswb_workspace_symbols` | 依名稱在工作區中搜尋符號。 | 否 | 否 |
| `lswb_definition` | 尋找指定位置符號的定義位置。 | 否 | 否 |
| `lswb_references` | 尋找指定位置符號的引用位置。 | 否 | 否 |
| `lswb_rename_symbol` | 透過語言服務重新命名符號，然後儲存每份變更的文件。 | 是 | 否 |
| `lswb_format` | 以文件的語言格式化工具格式化，然後儲存。 | 是 | 否 |
| `lswb_host_status` | 回報 Host 通道是否可用及已繫結，以及合格的共用終端與 Host 輔助程式的交握狀態。 | 否 | 僅狀態 |
| `lswb_host_bind` | 透過共用 Host 終端啟動 Host 輔助程式，並以隨機交握檔案驗證。輔助程式一開始監聽即回傳 `waitingForward`；見[繫結 Host 通道](#繫結-host-通道)。 | 否（僅暫存交握檔案） | 是 |
| `lswb_search` | 在 Host 上搜尋已儲存檔案的文字，支援 include／exclude glob。 | 否 | 是 |
| `lswb_find_files` | 尋找符合 glob 模式的已儲存 Host 檔案路徑。 | 否 | 是 |
| `lswb_host_stat` | 回傳路徑的 Host 磁碟中繼資料，可選擇附上原始位元組 SHA-256 與編輯器文字狀態。 | 否 | 是 |
| `lswb_copy` | 在 Host 上逐位元組複製單一檔案。 | 是 | 是 |
| `lswb_copy_dir` | 在 Host 上複製目錄樹。 | 是 | 是 |
| `lswb_read_bytes` | 以 base64 讀取已儲存的 Host 檔案，並附上大小與 SHA-256。 | 否 | 是 |
| `lswb_write_bytes` | 在一次請求中將 base64 位元組寫入 Host 檔案（最多 `transfer.chunkBytes`）。 | 是 | 是 |
| `lswb_host_exec` | 在有界的 Host PowerShell 子處理程序中啟動命令。 | 可能（任意命令） | 是 |
| `lswb_host_job_poll` | 輪詢 Host 工作的狀態、退出碼與輸出。 | 否 | 是 |
| `lswb_host_job_cancel` | 取消執行中的 Host 工作；只終止橋接自有的處理程序樹。 | 否 | 是 |
| `lswb_host_job_forget` | 釋放已結束的 Host 工作及其保留的輸出。 | 否 | 是 |
| `lswb_apply_patch` | 在 Host 上套用 Git unified-diff 文字修補（1..100 個檔案，最多 1 MiB）。 | 是 | 是 |
| `lswb_apply_patch_file` | 在 Host 上套用從本機檔案讀取的 Git unified-diff 修補（最多 1 MiB）。 | 是 | 是 |
| `lswb_upload_file` | 將本機檔案分塊上傳到 Host 工作區路徑，並以 SHA-256 驗證。 | 是 | 是 |

## 結果語義

成功結果以結構化內容回傳。失敗時設定 `isError`，並附 `code` 與 `message`。

- **已套用與已儲存。** 編輯工具將 `applied`（VS Code 已將編輯納入文件）與逐文件儲存結果（`saved`、`dirty`）分開回報。結果可能已套用但未儲存。一般編輯只儲存其目標。
- **`transport_outcome_unknown`。** 請求已送達橋接，但結果未獲確認。修改可能已經發生。重試前請先檢查目標，例如使用 `lswb_read_file`、`lswb_stat` 或 `lswb_host_stat`。伺服器絕不自動重送修改。`transport_unavailable` 表示請求未送出。
- **`workspace_changed`**（以及 `workspace_mismatch`、`instance_mismatch`、`epoch_mismatch`）。工作區繫結已過期：共用工作階段、VS Code 執行個體或橋接 epoch 已改變。請再次呼叫 `lswb_list_workspaces` 並使用新的根目錄 `uri`。若失敗的呼叫是修改，請先檢查目標。
- **`not_found`。** 檔案不存在時，`lswb_read_file` 以 `not_found` 失敗。在 `lswb_read_many` 中只有該項失敗，其他檔案仍會回傳。
- **搜尋在設計上不完整。** Host 搜尋與尋找只涵蓋已儲存的 Host 檔案。依賴結果前，請檢查 `complete`、`truncated` 與 `unsavedDocuments`。

### Host 工具

Host 通道欄標示的工具在 Live Share Host 上執行。它們需要以下全部條件：

- Host 共用一個可讀寫的 Windows PowerShell 終端；
- 橋接設定中已開啟 `host.enabled`，以及該操作本身的權限（已淘汰的 `terminal.enabled` 仍會再讀取一個版本）；
- 已繫結的通道：以 `lswb_host_status` 檢查，以 `lswb_host_bind` 繫結。

搜尋與修補另需 Host 上的 ripgrep 與 Git。共用終端只用來啟動一次前景 Host 輔助程式；之後的請求經由 Live Share 轉送的連接埠傳送。見[設定說明](SETTINGS.zh-TW.md)。

#### 繫結 Host 通道

繫結分兩步，因為 Host 使用者必須手動共用輔助程式連接埠：

1. 呼叫 `lswb_host_bind`。Host 輔助程式開始監聽後，它回傳 `bound: false`，附 `handshake.state: "waitingForward"`、要共用的 `hostPort` 與 `next` 提示。它不等待 Host。
2. 請 Host 執行 **Live Share: Share Server** 並輸入該連接埠。然後呼叫 `lswb_host_status`，直到它回報 `bound: true`。即使交握仍在進行，`lswb_host_status` 也會立即回應。

交握進行期間：

- 再次呼叫 `lswb_host_bind` 只會回報同一個交握，不會啟動第二個輔助程式。
- 其他 Host 工具回傳 `host_handshake_pending` 並附 `hostPort`，且不送出任何內容。不要重試這些工具來等待交握；改為輪詢 `lswb_host_status`。
- 交握最多等待 `host.handshakeTimeoutMinutes`。在通知中按 Cancel、工作區變更或關閉視窗也會停止交握。

若交握失敗或被取消，`lswb_host_status` 會顯示 `handshake.state` 為 `failed` 或 `cancelled`，並附 `handshake.code` 與 `handshake.message`。重新繫結前，若先前的輔助程式仍在執行，請 Host 在共用終端按 Ctrl+C。下一次 `lswb_host_bind` 會啟動新的輔助程式。

Guest IPC 輔助程式一次只轉送一個請求。因此 `lswb_host_bind` 會在 Host 動作前回傳，而不是佔住連線數分鐘。

## MCP 與 CLI

- MCP 伺服器是唯一的 agent 介面。先前的 Codex skill 已於 0.3.0 移除。
- `cli.cjs` 是供人員使用的故障排查工具。它保留 `instances`、`diagnose` 與固定繫結的原始 JSON 請求。其 upload、download 與 apply-patch 命令已移除；請改用 `lswb_upload_file` 與 `lswb_apply_patch_file`。
- MCP 伺服器在內部重用 `cli.cjs` 的本機傳輸層。

兩者都經由同一個本機管道與同一個擴充套件通訊，並遵循相同的權限。

## 已知限制

- **不支援大檔案下載。** 大檔案下載回傳 `feature_unavailable`。請改為請使用者提供可存取副本及其本機路徑。不要以反覆的位元組讀取或原始命令繞過限制。小檔案位元組讀取與大檔案上傳仍可用。
- **本機路徑。** `lswb_upload_file` 與 `lswb_apply_patch_file` 在執行 MCP 伺服器的機器上讀取 `localPath`。路徑必須是絕對路徑。
- **管道存取。** IPC 存取模式（預設僅限擁有者）決定哪些本機 Windows 帳戶能存取管道，因而決定哪些帳戶能執行 MCP 伺服器。見 [IPC 存取](IPC-SECURITY.zh-TW.md)。
- **不支援遞迴刪除**，也沒有多檔案磁碟交易。
- **僅支援 Windows。**
