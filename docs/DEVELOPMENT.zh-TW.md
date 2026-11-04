# 開發指南

[English](DEVELOPMENT.md) | [简体中文](DEVELOPMENT.zh-CN.md) | **繁體中文** | [日本語](DEVELOPMENT.ja.md)

[文件](README.zh-TW.md)

需要 Windows、Node.js 與確認的 Python 3。執行階段使用內建模組、Windows PowerShell 及隨附的 C# 原始碼，沒有 npm 相依套件；打包僅使用 Python 標準函式庫。測試使用 `extension/package.json` 宣告的 devDependencies（MCP SDK 互通測試）：執行 `npm test` 前，先在 `extension/` 內執行一次 `npm ci`。

```text
extension/                         Runtime, CLI and tests
scripts/build.py                   Packaging and source checks
docs/                              Current product/contributor guides
dist/                              Ignored generated packages
.local/                            Ignored local working files
```

MCP 伺服器（extension/mcp-server.cjs 與 mcp-tools.cjs）是唯一的 agent 介面。extension/cli.cjs 是故障排查 CLI，也是 MCP 伺服器使用的本機傳輸函式庫；保留 mcp-tools.cjs 依賴的匯出。保持版本、API 欄位與譯文一致。

```powershell
npm test
npm run check
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py
& $pythonExe .\scripts\build.py --check
& $pythonExe .\scripts\build.py --verify
```

倉庫根目錄提供打包入口：Windows 使用 `./build.ps1` 或 `build.bat`，Unix／Git Bash 使用 `sh ./build.sh`。無參數時建置並驗證 `dist/` 中的 VSIX 及其 SHA-256 檔案；`--check`、`--verify`、`--help` 原樣傳給 `scripts/build.py`。必要時以 `LSWB_PYTHON` 指定 Python 3 執行檔完整路徑。Windows 自動偵測目前 Conda、使用者 Anaconda 或 Python Launcher；Unix 使用目前 Conda 或 Python 3。這些入口也可從其他目前目錄呼叫。

一般測試涵蓋文件／儲存／權限／IPC 契約，不修改已連線的專案。本機測試通過不代表每個 Host、帳戶、原則、遠端工作階段或語言提供者都可用。

建置產生 VSIX 及其 SHA-256 檔案。--check 驗證布局與版本；--verify 將目前套件與原始碼成員逐一比對。明確的讀者文件白名單排除歷史驗收文件、issues、.local 與私人 memo。

真實測試需要明確範圍、自有的唯一測試資料與清理。extension/test/live-v01.cjs 需要 LIVESHARE_RUN_LIVE=1，且會改變搜尋視圖。live-sandbox.cjs 使用既有本機帳戶，可能在其自有暫存工作區初始化 ACL，且不送出 Host 命令；它以 Codex 執行檔作為沙箱用戶端（`LIVESHARE_CODEX_EXE`）。這些指令碼不屬於一般 CI 測試。

```powershell
$env:LIVESHARE_RUN_SANDBOX = '1'
$env:LIVESHARE_CODEX_EXE = '<absolute-path-to-codex.exe>'
node .\extension\test\live-sandbox.cjs
```

Host 測試使用目標 RW 共用 PowerShell，固定 root／epoch，還原租用的設定時不覆寫並行的使用者變更。停用 Host 存取（`host.enabled`）時必須拒絕 Host 工作，絕不退回 Guest。不隱含 stage／commit／push。

讀者文件有四種語言版本，連結／命令／限制須一致。修改後檢查引用與套件。公開文件與產物不可包含機器回報、憑證、Host 原始路徑或調查敘述。生成／本機檔案已忽略；Windows CI 只檢查與建置，不發佈。

## Marketplace 發佈

`publish-marketplace.yml` 使用 GitHub Actions OIDC 與 `@vscode/vsce` 4.1.0 發佈正式版，不需 PAT secret。在 Marketplace 發佈者 `Koha9-Lee` 建立 Trusted Publishing 原則：owner `Koha9`、repository `liveshare-workspace-bridge`、workflow `publish-marketplace.yml`，Environment 留空。參閱[官方設定說明](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing)。

發佈正式 GitHub Release 會觸發此工作流程。補發既有版本時，在 Actions 分頁的 `main` 上執行 **Publish Marketplace**，輸入既有標籤（如 `v0.3.0`）。流程簽出該標籤、核對套件版本、執行測試與打包檢查，然後建置、驗證並發佈 VSIX。只有此工作授予 `id-token: write`。權杖交換失敗不會退回 PAT 驗證。發佈失敗時先檢查執行結果與 Marketplace 公開版本再決定重試；不要移動既有版本的標籤來取代其內容。
