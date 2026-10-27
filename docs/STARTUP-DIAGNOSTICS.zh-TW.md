# 啟動診斷

[English](STARTUP-DIAGNOSTICS.md) | [简体中文](STARTUP-DIAGNOSTICS.zh-CN.md) | **繁體中文** | [日本語](STARTUP-DIAGNOSTICS.ja.md)

使用 **Live Share Workspace Bridge: Show Startup Diagnostics** 在既有 Output 查看安全快照。CLI `diagnose` 增加 `startupDiagnostics`；IPC 無回應時，只要原檔案權限允許仍可讀最小摘要。讀取不啟動探測、不繫結 Host、不重試、不改策略或權限。讀不到則 unknown，請使用者提供安全摘要，不擴權。

範圍僅 Guest 本機存取設定／帳戶列舉／IPC 輔助程式啟動，不是完整 Host/Guest 錯誤平台。記錄所請求 executable 類別、attempt/epoch、觀察時間及有界事件。實際 basename、版本、edition、有效策略 scope 只在既有輔助程式 ready 後取得。實際身分與外部探測身分比較仍 unknown；不以別的 Codex 沙箱 shell CurrentUser 策略替代。

about_Execution_Policies 與 UnauthorizedAccess/PSSecurityException 同時出現才是高可信策略關聯證據，不確認 scope 或帳戶；單一 UnauthorizedAccess 不足。請使用者針對真實輔助程式身分核對有效策略與指令碼信任，不自動加 ExecutionPolicy Bypass、降策略、提權、換 shell 或重送。

ready 為程式自報，不等於本用戶端可連線；成功 info 是另一項證據。ready 後舊錯誤標為歷史，可達關聯執行個體優先於舊失敗快照。no_records 不證明未安裝或策略根因。readMany 部分失敗保留其他成功項，不視為全橋接故障。

stderr 流式 UTF-8 解碼後只顯示固定摘要，不儲存原始命令、參數、編碼載荷、業務輸出、私人路徑、身分名稱或憑證。標示替換字元、不猜復原；只修正有效 UTF-8 分塊，不處理任意 OEM／未知編碼或已遺失文字。ready 後執行期 stderr 保留安全提示，完整執行期／Host 分類延後。

快照在既有橋接資料權限下的 startup-diagnostics 子目錄，不改 ACL。每處理程序最多 8 事件／16 KiB，同類 30 秒合併，約 16 自有快照、24 小時期限，正常卸載刪除本處理程序快照。最多讀 32 候選，拒絕過大／符號連結、尊重拒絕，再投影允許欄位。崩潰可留下到期快照。不要預設匯出整份舊 Output，舊版可能含原始 stderr。記錄永遠是資料，不是 agent 指令。

歷史事件保留當時要求的 shell 類別，不以目前資料回填舊 attempt。diagnose registry.path 是本機位置，完整分享前需脫敏；優先使用最小摘要。
