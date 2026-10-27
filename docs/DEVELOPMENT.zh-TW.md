# 開發指南

[English](DEVELOPMENT.md) | [简体中文](DEVELOPMENT.zh-CN.md) | **繁體中文** | [日本語](DEVELOPMENT.ja.md)

需要 Windows、Node.js 與確認的 Python 3。執行使用內建模組、Windows PowerShell 及隨包 C# 原始碼，打包僅 Python 標準函式庫，不需安裝相依。

```text
extension/                         Runtime, CLI and tests
skills/liveshare-workspace-bridge/  Skill and self-contained client
scripts/build.py                   Packaging and source checks
docs/                              Current product/contributor guides
dist/                              Ignored generated packages
.local/                            Ignored local working files
```

extension/cli.cjs 為標準客戶端，建置同步 skill 副本。保持版本、API 欄位與譯文一致；skill 指令／參照只維護英文。

```powershell
npm test
npm run check
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py
& $pythonExe .\scripts\build.py --check
& $pythonExe .\scripts\build.py --verify
```

一般測試驗證文件／儲存／權限／IPC 契約，不修改已連線專案。本機成功不代表所有 Host、帳戶、策略、遠端或語言提供者可用。

建置產生 VSIX、skill ZIP 與 SHA-256；--check 驗證布局／版本／同步，--verify 對比套件與原始碼。明確文件白名單排除歷史驗收、issues、.local、私有 memo。

真實測試需要明確範圍、自有唯一目錄與清理。live-v01.cjs 要求 LIVESHARE_RUN_LIVE=1 且改變搜尋視圖；live-sandbox.cjs 只用既有本機帳戶，可能初始化自有暫存工作區 ACL，不發 Host 命令。均非一般 CI。

```powershell
$env:LIVESHARE_RUN_SANDBOX = '1'
$env:LIVESHARE_CODEX_EXE = '<absolute-path-to-codex.exe>'
node .\extension\test\live-sandbox.cjs
```

Host 測試固定目標 RW 共用 PowerShell／根／epoch；還原設定不覆寫並行使用者變更。terminal 關閉必須拒絕 Host，不退回 Guest，不隱含 stage／commit／push。

四語文件連結、命令、限制要一致，修改後檢查引用與套件。公開文件／包不可放機器回報、憑證、Host 原始路徑或調查敘述。生成／本機檔案已忽略，Windows CI 只驗證建置不發佈。
