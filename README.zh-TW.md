# Live Share Workspace Bridge

[English](README.md) | [简体中文](README.zh-CN.md) | **繁體中文** | [日本語](README.ja.md)

透過 Windows 本機橋接，讓 Codex 在 VS Code Live Share 工作區中讀取檔案、批次編輯文件並儲存修改。

## 功能

- 讀取目錄、指定行、多個檔案及編輯器中尚未儲存的內容。
- 取代文字、依行編輯，並集中修改多份文件。
- 只儲存實際修改的文件，傳回逐檔結果。
- 建立檔案和目錄、複製檔案、移動或重新命名路徑、刪除檔案或空目錄。
- 查詢診斷、文件符號、工作區符號及定義位置。
- 使用 VS Code 原生搜尋檢視和檔名搜尋。
- 透過僅目前 Windows 使用者可存取的具名管道連線。

## 環境需求

- Windows、VS Code 和 Live Share。
- 已連線到共享專案的 Live Share Guest 視窗。
- Node.js，供 CLI 和 Codex skill 使用。
- Python 3，供建置安裝套件使用；建置僅使用標準函式庫。

擴充功能使用 Windows 內建的 Windows PowerShell，不需要 npm 相依套件，也不需要 Host 安裝配套工具。

## 快速開始

### 建置並安裝擴充功能

```powershell
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py

$vsix = Get-ChildItem .\dist\liveshare-workspace-tools-*.vsix |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
code --install-extension $vsix.FullName
```

安裝到 Guest 視窗使用的 VS Code Profile。需要指定 Profile 時，加入 `--profile '<profile-name>'`。安裝或更新後依 VS Code 提示重新載入視窗，必要時恢復 Live Share 連線。

### 加入 Codex skill

將 `skills/liveshare-workspace-bridge/` 複製到 Codex 的 skills 目錄，例如 `$env:USERPROFILE\.codex\skills\liveshare-workspace-bridge`。若同名目錄已存在，先檢查其中的本機修改。`dist/` 中的 ZIP 包含相同的獨立 skill。

在 Codex 中呼叫 `$liveshare-workspace-bridge`，並說明要在共享專案完成的工作。

### 使用 CLI

```powershell
node .\extension\cli.cjs instances

node .\extension\cli.cjs --instance '<id>' --epoch '<epoch>' `
    --workspace 'vsls:/' --request '<request.json>'
```

`request.json` 範例：

```json
{"op":"read","path":"README.md","startLine":1,"endLine":20}
```

首次選擇目標視窗後，沿用其執行個體 ID、epoch 和根 URI。共享檔案路徑相對於該根目錄。詳見[使用指南](docs/USAGE.zh-TW.md)和 [API 參考](docs/API.zh-TW.md)。

## 運作原理

```text
Codex skill / CLI → current-user Windows named pipe
                 → VS Code APIs → Live Share → shared files
```

橋接保留 `vsls:` URI，並操作目前文件的緩衝區。批次修改統一檢查後，以一份 WorkspaceEdit 提交，再逐文件儲存。儲存成功後，不自動追加提供者回讀或全文雜湊。

## 限制

- 內容搜尋傳回目前 Search View 的快照，沒有完成訊號；檔名搜尋可能遺漏剛建立的檔案。
- 多檔儲存不是跨檔案磁碟交易。儲存失敗時，應分別檢查每個檔案的結果。
- 不提供 Host shell、遠端建置或 Git 執行、遞迴刪除、目錄複製、二進位寫入或通用 unified diff 解析。
- 具名管道是同一 Windows 使用者權限範圍內的自動化介面，不隔離以該使用者身分執行的其他程式。

## 文件

從[文件目錄](docs/README.zh-TW.md)查看安裝、API、架構、開發及疑難排解說明。

## 開發

```powershell
npm test
npm run check
& $pythonExe .\scripts\build.py --check
& $pythonExe .\scripts\build.py --verify
```

建置產物輸出至 `dist/`。原始碼結構和封裝流程請參閱[開發指南](docs/DEVELOPMENT.zh-TW.md)。

## 授權

採用 MIT 授權條款。詳見 [LICENSE](LICENSE)。
