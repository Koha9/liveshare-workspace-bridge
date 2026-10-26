# 開發指南 v0.2

[English](DEVELOPMENT.md) | [简体中文](DEVELOPMENT.zh-CN.md) | **繁體中文** | [日本語](DEVELOPMENT.ja.md)

[文件](README.zh-TW.md)

## 環境

使用 Windows、Node.js 和已確認的 Python 3 可執行檔案。擴充套件使用 Node 內置模塊和 Windows PowerShell；Host 記憶體執行階段由 PowerShell 編譯 C#。建置只使用 Python 標準函式庫，不需要安裝 npm 依賴。

## 原始碼布局

```text
extension/                    Extension, CLI, and tests
skills/liveshare-workspace-bridge/    Codex skill and self-contained client
scripts/build.py              Synchronization, packaging, and package checks
docs/                         User and contributor documentation
dist/                         Generated packages and SHA-256 files
.local/                       Local-only working files
```

`extension/cli.cjs` 是唯一規范客戶端；建置同步到 skill。接口變化必須同步 API 和各語言文件。skill 指令與引用只維護英文，不在 skill 目錄添加語言副本。

## 檢查與建置

```powershell
npm test
npm run check

$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py --check
```

測試覆蓋編輯預檢、部分儲存失敗、dirty 保護、實時權限依賴、補丁路徑、過期模型保護、真實 Windows IPC、Host 位元組基礎操作、有界輸出、取消和處理程序清理。普通測試不修改已連線的 Live Share 專案。

```powershell
& $pythonExe .\scripts\build.py
& $pythonExe .\scripts\build.py --verify
```

`dist/` 輸出 VSIX、自足式 skill ZIP 和 SHA-256 檔案。`--check` 只檢查布局、版本和客戶端同步；`--verify` 只對比現有包成員、原始碼與校驗和。包包含多語言讀者文件和驗收記錄。

## 實際 Live Share 驗證

`extension/test/live-v01.cjs` 是顯式啟用的舊版集成測試；僅在授權的連線和隔離測試範圍內設定 `LIVESHARE_RUN_LIVE=1` 執行。它創建並清理唯一目錄、將本機回報紀錄儲存到 `.local/evidence/`，還會改變搜尋視圖。不要加入預設測試或 CI。

v0.2 Host 驗證需要專用 RW 共用 PowerShell 和自有唯一測試目錄。臨時設定必須記錄原值並復原，不能覆蓋使用者同時做出的更改。終端權限關閉時所有 Host 功能必須被拒絕，不能退回 Guest 終端。測試不 stage/commit/push。37 項本機測試通過不代表實際大檔案下載通過；分項證據和未完成驗收見[驗收記錄](VALIDATION-v0.2.zh-TW.md)。

## 文件與倉庫衛生

英文無語言後綴，翻譯使用 `.zh-CN`、`.zh-TW`、`.ja`，對應頁面互鏈。保持命令、API 字段、數值限制、權限預設值和失敗邊界一致；不要翻譯實際設定名稱或 API 標識符。翻譯更新後檢查鏈接與程式碼示例，並重新建置驗證包。

`dist/`、`.local/`、依賴和本機組態不進 Git。不要提交 token、本機回報紀錄、使用者目錄或 Host 原始路徑。`.github/workflows/ci.yml` 在 Windows 上檢查和建置，不發佈。驗收文件只記錄可分享的結果，不包含私有回報紀錄內容。
