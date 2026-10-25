# 開發指南

[English](DEVELOPMENT.md) | [简体中文](DEVELOPMENT.zh-CN.md) | **繁體中文** | [日本語](DEVELOPMENT.ja.md)

[文件](README.zh-TW.md)

## 環境需求

使用 Windows、Node.js 和已確認的 Python 3 執行檔。擴充功能僅使用 Node 內建模組及 Windows PowerShell，建置僅使用 Python 標準函式庫，不需要安裝相依套件。

## 原始碼結構

```text
extension/                    Extension, CLI, and tests
skills/liveshare-workspace-bridge/    Codex skill and self-contained client
scripts/build.py              Synchronization, packaging, and package checks
docs/                         User and contributor documentation
dist/                         Generated packages and SHA-256 files
.local/                       Local-only working files
```

`extension/cli.cjs` 是用戶端的唯一維護原始碼，建置時同步至 skill。介面變更時，應同步 API 參考及各語言譯本。

## 執行檢查

```powershell
npm test
npm run check

$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py --check
```

測試涵蓋編輯預檢、儲存失敗、未儲存緩衝區保護、工作區繫結、IPC 行為與程序清理。一般測試不修改已連線的 Live Share 專案。

## 建置安裝套件

```powershell
& $pythonExe .\scripts\build.py
& $pythonExe .\scripts\build.py --verify
```

建置會在 `dist/` 產生 VSIX、獨立 skill ZIP 和 SHA-256 檔案。`--check` 只檢查目錄、版本和用戶端同步，不寫入檔案；`--verify` 比較既有套件與目前原始碼及校驗值。套件包含多語言使用文件。

## 共享工作區測試

`extension/test/live-v01.cjs` 需要明確啟用。在已連線且允許測試的工作區中，設定 `LIVESHARE_RUN_LIVE=1` 後再執行。它建立並清理唯一命名目錄，將本機回應記錄寫入 `.local/evidence/`，並會變更 Search View 查詢。請勿將它加入一般 CI。

## 文件

英語檔案不帶語言後綴，譯本使用 `.zh-CN`、`.zh-TW` 和 `.ja`。各頁面互相連結，命令、欄位、限制和行為說明應保持一致。

## 儲存庫維護

`dist/`、`.local/`、相依套件目錄和本機設定由 Git 忽略。請勿提交存取權杖、本機回應記錄或電腦專用路徑。`.github/workflows/ci.yml` 中的 Windows 工作流程執行檢查與建置，不發佈套件。

skill 的操作指引和參考資料僅維護英語，不在 skill 目錄中加入多語言副本。
