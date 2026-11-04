# 更新記錄

[English](CHANGELOG.md) | [简体中文](CHANGELOG.zh-CN.md) | **繁體中文** | [日本語](CHANGELOG.ja.md)

- 0.3.0
  - 升級注意事項：`terminal.*` 設定已改為 `host.*`；新鍵未設定時，仍會讀取舊的 User 值一個版本，且不改寫任何設定，請自行重新命名。已儲存的 `allLocalUsers` IPC 模式以 ownerOnly 執行並顯示一次通知。Codex skill 已移除：請用 **Copy MCP Server Configuration** 將 MCP 伺服器加入你的 agent。Host 功能現在需要 Host 針對橋接顯示的輔助程式連接埠執行一次「Live Share: Share Server」。需要 VS Code 1.101 以上版本。
  - 新增：MCP stdio 伺服器，提供 36 個 `lswb_` 工具，隨 VSIX 發佈（`mcp-server.cjs`、`mcp-tools.cjs`）；位於 `~/.liveshare-local/mcp-server.cjs` 的穩定啟動器，會跟隨執行中的擴充套件版本；以及 **Copy MCP Server Configuration** 命令。複製的組態使用正斜線路徑。若打包的模組 require 了未打包的檔案，建置會失敗。新增 [MCP 指南](MCP.zh-TW.md)。
  - 新增：擴充套件透過 `vscode.lm.registerMcpServerDefinitionProvider` 向 VS Code 註冊其 MCP 伺服器，讓內建 agent 能發現它。
  - 新增：經由 Live Share 轉送連接埠的 Host 通道。共用終端啟動一次前景、僅存於記憶體的 Host 輔助程式，請求則使用轉送的 loopback 連接埠並搭配每個輔助程式專屬的權杖。新設定 `host.guestPort`、`host.idleTimeoutMinutes` 與 `host.handshakeTimeoutMinutes`。新錯誤碼 `host_transport_unavailable`、`host_request_too_large`、`host_bind_cancelled`、`host_port_forward_required` 與 `host_port_unavailable`。
  - 新增：Host 輔助程式一開始監聽，`hostBind` 就回傳 `waitingForward`（附 `hostPort` 與 `next`），轉送連接埠的交握在背景完成。`hostStatus` 如同 `info` 一樣略過派發佇列，並回報 `handshake.state` 與 `handshake.code`。交握完成前，其他 Host 請求回傳新的 `host_handshake_pending`。
  - 新增：擴充套件在啟用時移除已結束視窗留下的探索記錄（比對名稱、id、pid 與管道名稱；連結與其他檔案不受影響）。
  - 新增：info 與 lswb_status 回報 ipc.requestedMode 與 ipc.deprecatedModeIgnored。
  - 變更：最低 VS Code 版本為 1.101。
  - 變更：啟用事件限縮為 `onFileSystem:vsls` 與 `onStartupFinished`，不再使用 `*`。
  - 變更：`terminal.*` 設定重新命名為 `host.enabled`、`host.terminalName`、`host.workspacePath`、`host.commandTimeoutMs` 與 `host.maxOutputCharacters`；新鍵未設定時，仍會讀取舊的 User 值一個版本，且絕不改寫設定。錯誤碼 `terminal_access_disabled` 改為 `host_access_disabled`，info.permissions 改為回報 `hostEnabled` 而非 `terminalEnabled`。
  - 移除：共用終端資料傳輸。共用 Host 終端只啟動一次 Host 輔助程式，所有 Host 請求都使用 Live Share 轉送的連接埠。已移除 `host.transport` 設定；已儲存的 `sharedTerminal` 值以 portForward 執行，並在輸出通道寫入一行。
  - 移除：Codex skill；agent 改經由 MCP 伺服器連線。CLI 保留 instances／diagnose／原始請求以供故障排查。
  - 移除：allLocalUsers IPC 存取模式；只保留 ownerOnly 與 selectedUsers。已儲存的 allLocalUsers 值以 ownerOnly 執行，每個視窗工作階段顯示一次通知，且不改寫。見 [IPC 存取](IPC-SECURITY.zh-TW.md)。
  - 修正：read 與 readMany 將不存在的檔案回報為 `not_found`，而非一般的 `vscode_error`；readMany 中只有該項失敗，其他檔案仍會回傳。
  - 修正：重新載入或當機的視窗留下的探索記錄不再使探索結果變成 `partial`。管道不存在且擁有者處理程序已結束時，回報為 `stale` 探測並附 `ownerProcess: "exited"`（CLI 探索也會計入 `staleRecordCount`）；若只剩此類記錄，狀態為 `no_records`。

- 0.2.4 — 修正 broken pipe 清理，加入有限自動重連，保留 Host 不確定狀態，並行探索及 agent 重啟指引。

- 0.2.3 — 本機啟動摘要、安全 shell 資料及目前／歷史區分。

- 0.2.2 — 擁有者／本機使用者／指定 SID 與舊設定遷移。

- 0.2.1 — 明確探索錯誤與本機 IPC 訊框。

- 0.2 — 可選 Host 搜尋、工作、文字修補、位元組與上傳。
