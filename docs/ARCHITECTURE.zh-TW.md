# 架構

[English](ARCHITECTURE.md) | [简体中文](ARCHITECTURE.zh-CN.md) | **繁體中文** | [日本語](ARCHITECTURE.ja.md)

[文件](README.zh-TW.md)

- extension.cjs 負責本機 IPC（預設僅限擁有者）、生命週期與英文權限狀態。
- registry-cleanup.cjs 在啟用時執行，移除已結束視窗留下的探索記錄（比對檔案名稱、id、pid 與管道名稱）；連結與其他檔案不受影響。cli.cjs 的探索會將此類記錄回報為 `stale` 探測。
- permissions.cjs 是請求授權層；在派發與 Host 送出前讀取即時的 User／machine 設定。agent 端點不能更新權限。
- workspace.cjs 負責文件版本、dirty 緩衝區檢查、文字預檢、語言編輯與目標儲存。Host 修改後保留受影響模型的保護，直到規範化內容相符。
- host-channel.cjs 循序處理 Host 請求，透過共用終端啟動一次 Host 輔助程式（以隨機 bootstrap 檔案驗證），在背景等待轉送的連接埠，並以 loopback TCP（host-transport-tcp.cjs）搭配每個輔助程式專屬的權杖與 nonce 送出每個請求。host-terminal.cjs 選擇共用 RW 終端；host-bootstrap.cjs 產生輔助程式並讀取其監聽橫幅。不向終端輸入任何請求。
- host-operations.cjs 將公開 API 對應到窄 Host 操作，並將工作／傳輸繫結到 root 與 epoch。
- host-server.ps1 是前景、僅存於記憶體的 Host 輔助程式；它內嵌 host-core.ps1（Host 操作）。host-runtime.cs 提供自有的 Windows Job Object、有界串流排空、分塊位元組控制代碼、SHA-256 與過期機制。不安裝常駐 Host agent；輔助程式只在 loopback 監聽，並在 Ctrl+C、終端關閉、工作階段結束或閒置逾時時結束。
- mcp-server.cjs 是 stdio MCP 協定層（initialize、tools/list、tools/call）。它只向 stdout 寫入協定訊框。
- mcp-tools.cjs 定義 MCP 工具表。它透過 cli.cjs 傳輸層將 Guest、Host 與本機檔案工具對應到橋接操作，並維護 root uri 到 instance／epoch 的繫結。未知的傳輸結果只報告，絕不重送。
- mcp-launcher.cjs 是自足的啟動器，由擴充套件安裝到 `~/.liveshare-local/mcp-server.cjs`（透過 mcp-launcher-install.cjs，它同時產生 Copy MCP Server Configuration 的片段）。它依據有效的探索記錄啟動 mcp-server.cjs（優先最新的伺服器檔案，其次最新的記錄），因此 agent 組態在升級後仍可使用。
- mcp-definition-provider.cjs 向 VS Code 註冊 mcp-server.cjs（`vscode.lm.registerMcpServerDefinitionProvider`），讓內建 agent 能發現它。
- cli.cjs 是供人員使用的故障排查 CLI（instances、diagnose、固定繫結的原始 JSON 請求），也是 mcp-tools.cjs 用於探索、請求與分塊上傳的本機傳輸函式庫。agent 不直接呼叫它。

文字編輯預設仍走文件路徑，每次儲存後不重新讀取提供者。可選的 Host 路徑負責已儲存檔案的完整搜尋、命令、修補與位元組／目錄操作。原始 Host 執行需要全部操作權限；窄操作仍可分別控制。這些檢查不是任意指令碼的作業系統沙箱。

撤銷權限不會回復已派發的工作。子工作保留有界逾時；同步檔案系統操作可能在 Guest 回應逾時後仍完成。未知結果不重試。傳輸有閒置過期與自有暫存；目錄複製可能部分失敗。不提供遞迴刪除或多檔案磁碟交易。

`pipe-security.cs` / `pipe-host.ps1`：明確的 owner／沙箱 DACL、本機與工作階段門檻、持續的單一執行個體管道、有界 UTF-8 輸入與回應排空。

`local-accounts.cs` 僅列舉本機 SAM 使用者並依穩定 SID 選擇；`ipc-access.cjs` 負責僅限 User 的模式解析、一次性舊 SID 遷移及英文帳戶選擇器。

大檔案下載（`transferOpenRead`／`transferRead`）回傳 `feature_unavailable`。請使用者提供可存取副本與本機路徑，不反覆小塊讀取或用原始命令繞過限制；小檔案位元組讀取與大檔案上傳仍可用。
