# Live Share Workspace Bridge v0.2

[English](README.md) | [简体中文](README.zh-CN.md) | **繁體中文** | [日本語](README.ja.md)

v0.2.2：**Configure IPC Access** 提供 ownerOnly（預設）、allLocalUsers 及穩定 SID 的 selectedUsers。舊 true 僅遷移既有指定帳戶，不自動允許全部帳戶。見 [IPC 三模式](docs/IPC-SECURITY.zh-TW.md)，Host 權限獨立。

通過 Windows 本機橋接，讓 Codex 操作已經連線的 VS Code Live Share 工作區。v0.2 將文件編輯與可選的、經過驗證的 Host RW PowerShell 通道結合起來，無需 HTTP 連接埠或複製 token。

## 功能

- 讀取文件及指定範圍、批量編輯、只儲存目標檔案並回傳明確結果。
- Host ripgrep 內容搜尋和路徑枚舉，報告完成狀態、退出碼和截斷。
- Host 子處理程序命令、stdout/stderr 游標、超時及自有處理程序樹取消。
- 經過 Git 檢查的文字補丁、尋找引用、純文字符號重新命名和語言服務格式化。
- 保持原始位元組的讀寫、檔案複製、複製到新目錄，以及帶 SHA-256 校驗的分塊大檔案上傳。
- 英文權限設定：agent 總開關、各項操作開關及聯動的終端總開關。

遞歸刪除和跨檔案“全成或全敗”儲存不提供。Host 搜尋覆蓋已儲存檔案，不覆蓋未儲存的編輯器緩衝區。顯式搜尋快照仍不完整。**大檔案下載本版停用**；小檔案位元組讀取和大檔案上傳仍可用。

## 環境與安裝

Guest 需要 Windows、VS Code、Live Share 和 Node.js。Host 功能需要 Windows Host 上共用的可讀寫 PowerShell，並在 Guest 連線；搜尋需要 ripgrep，補丁需要 Git。橋接可從 Host VS Code 安裝中發現 ripgrep。無需安裝常駐 Host agent，繫結時只載入記憶體中的工作階段輔助程式。

使用已確認的 Python 3 可執行檔案建置；只依賴標準函式庫：

```powershell
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py
$vsix = Get-ChildItem .\dist\liveshare-workspace-bridge-*.vsix |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
code --install-extension $vsix.FullName
```

將擴充套件安裝到 Guest 視窗使用的 Profile；按提示重新載入並重新連線 Live Share。檢查已有本機自訂後，將 `skills/liveshare-workspace-bridge/` 安裝到 Codex skills 目錄，使用 `$liveshare-workspace-bridge`。

## 權限

執行 **Live Share Workspace Bridge: Configure Agent Permissions**，或在 VS Code 設定中搜尋 `@ext:Koha9-Lee.liveshare-workspace-bridge`。設定名稱保留英文。

- **Allow Agent Access**：agent 總開關，預設開啟。
- **Allow Shared Host Terminal Access**：預設關閉；開啟後仍受各項操作權限約束。
- 單項開關覆蓋讀取、編輯、儲存、檔案操作、搜尋、語言工具、補丁、位元組、上傳和 Host 命令。
- 關閉終端存取會停用所有 Host 功能，但保留單項組態；Guest 文件功能仍受各自權限控制。
- 原始 Host 命令要求全部操作權限開啟，因為任意程式碼能夠繞過細分檔案操作限制。

狀態欄顯示 **Agent off**、**Guest only** 或 **Host allowed**；Host allowed 表示權限允許，不代表終端已連線或驗證。設定即時作用於後續請求，不復原已派發工作；子命令仍受超時限制。

缺少 Host RW 終端時，skill 請求使用者開啟並共用一次，然後等待。它不創建普通 Guest 終端、不猜測替代終端，也不自行改設定繞過拒絕。需要尚未支援的操作時，它說明準確路徑和目標結果，請使用者協助，並等待回覆後再繼續依賴該步驟的工作。大檔案下載、遞歸刪除、原子儲存、缺少語言服務及未解決的編輯器衝突均適用。

## CLI

```powershell
node .\extension\cli.cjs instances
node .\extension\cli.cjs --instance '<id>' --epoch '<epoch>' --workspace 'vsls:/' --request '<request.json>'
node .\extension\cli.cjs upload --instance '<id>' --epoch '<epoch>' --workspace 'vsls:/' --input '<local.bin>' --path 'assets/file.bin'
```

選定專案後沿用 instance/epoch/root；固定繫結的請求不會額外發送 info 探測。參見[使用指南](docs/USAGE.zh-TW.md)和[API](docs/API.zh-TW.md)。

## 設計與限制

普通編輯重用文件版本，集中應用相關修改，只儲存目標；成功後不預設重讀提供者或計算全文雜湊。Host 位元組操作避開 Live Share 文字提供者的有損二進位通道。受影響的已打開緩衝區會與定向 Host 文字摘要核對，版本變化本身不足以證明已刷新；不會全域還原編輯器。

Guest 文件 EOL 不證明 Host 原始位元組一致。Git 補丁行尾受 Host Git 組態影響。搜尋采用 rg 忽略規則，不完全重現 VS Code 條件排除。目錄複製只允許新目標，可能部分失敗，不合併或遞歸覆蓋已有目錄。

具名管道預設僅當前 Windows 使用者可存取；明確選擇額外本機帳戶接入時，接入範圍見前述 IPC 安全說明。操作權限不是任意 Host 程式碼的作業系統沙箱。Host 子處理程序使用 Windows Job Object，超時和取消針對自有處理程序樹，不針對共用 PowerShell。上傳臨時資源有空閑過期和完整性校驗。

約 1.1 MB 的實際下載曾多次使共用終端停止回應，根因未解決。`transferOpenRead`／`transferRead`（含 CLI download）在派發 Host 命令前回傳 `feature_unavailable`。不要迴圈小塊讀取繞過；請使用者提供可存取副本。具體證據見[驗收記錄](docs/VALIDATION-v0.2.zh-TW.md)。

## 開發

```powershell
npm test
npm run check
& $pythonExe .\scripts\build.py --check
& $pythonExe .\scripts\build.py --verify
```

無需 npm 依賴。原始碼與 skill 一起維護，建置同步自足式客戶端。參見[開發指南](docs/DEVELOPMENT.zh-TW.md)、[架構](docs/ARCHITECTURE.zh-TW.md)和[文件目錄](docs/README.zh-TW.md)。許可證：[MIT](LICENSE)。
