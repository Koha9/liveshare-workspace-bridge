# IPC 存取與遷移

[English](IPC-SECURITY.md) | [简体中文](IPC-SECURITY.zh-CN.md) | **繁體中文** | [日本語](IPC-SECURITY.ja.md)

[文件](README.zh-TW.md)

透過 **Live Share Workspace Bridge: Configure IPC Access** 組態英文 User 設定。只有明確的 User 值控制信任；工作區設定與擴充套件提供的預設值無法擴大信任。

| 模式 | 橋接擁有者以外的存取範圍 |
|---|---|
| ownerOnly | 無；發佈預設值。 |
| selectedUsers | 符合已儲存 ipc.selectedUserSids 的現有本機使用者。 |

即使擁有者是網域使用者也會保留；額外授權僅限本機帳戶。遠端連線一律拒絕，所有用戶端都必須與橋接位於相同的 Windows session ID。網域控制站拒絕列舉額外帳戶。

信任涵蓋允許帳戶下的所有處理程序，而非單一 agent 工作。橋接呼叫不受任何 agent 檔案系統沙箱邊界約束，但仍受 agent／操作權限限制。Host 存取彼此獨立；啟用且其他條件成立時，可能允許 Host 命令。選擇器在擴大存取前會警告。絕不將較寬的模式當作自動錯誤處理手段。

選擇器顯示目前名稱，但儲存的是 SID。改名後仍保留存取；刪除後重建的帳戶不會依名稱繼承選取。不可用／無效／非本機的 SID 會報告且不授權。取消不變更設定。

## 相容性遷移

當 ipc.accessMode 沒有明確的 User 值，且舊的 ipc.allowCodexSandboxClients 為 true 時，初次遷移只解析既有的 CodexSandboxOffline／Online 身分，快取其 SID，並儲存 ipc.selectedUserSids 與 selectedUsers。已快取的 SID 不再依名稱重新解析；缺少的帳戶不增加存取。布林值無法還原在首次快照前已刪除／重建的歷史 SID：若不確定，請核對身分。

明確的模式優先於舊旗標。false／未設定維持 ownerOnly。模糊的手動選取或觀察到的並行變更不會被覆寫。舊旗標仍保持相容，但模式明確後新版會忽略它；仍在執行的舊視窗須更新／重新載入才會套用這些模式。

操作權限開關即時套用到後續請求。IPC 信任變更與遷移會寫入 User 設定並重新啟動橋接，改變 instance／epoch。請取得所需的部署核准、暫停相依工作並重新探索。此流程不變更任何 Host 權限、帳戶、憑證、ACL 原則或執行原則；已派發的效果不會撤銷。

## 已移除的 allLocalUsers 模式

0.3.0 版移除了 allLocalUsers。agent 透過 MCP 伺服器存取橋接，而該伺服器由你的 agent 以你自己的 Windows 帳戶啟動，因此 ownerOnly 已涵蓋此路徑。其他帳戶請使用 selectedUsers。

若你的 User 設定仍包含 allLocalUsers，橋接不會失敗。它以 ownerOnly 執行，每次啟動時在輸出通道寫入一行，並在每個視窗工作階段顯示一次附有 Configure IPC Access 按鈕的通知。它不會改寫你的設定；請自行修改該值以停止通知。info 與 lswb_status 將 ipc.mode 回報為 ownerOnly，並附 ipc.requestedMode allLocalUsers 與 ipc.deprecatedModeIgnored true。其他未知值仍會以設定錯誤停止橋接。原生輔助程式拒絕 allLocalUsers。

## 設計邊界

原生管道使用明確的 SID 授權、遠端拒絕、相同工作階段檢查、單一持續伺服器執行個體，以及有界的輸入／回應處理。本機 SAM 列舉拒絕網域控制站。這些是目前的限制，並不保證已測試所有 Windows 原則、遠端主機或帳戶類型。存取／錯誤分類請見[啟動診斷](STARTUP-DIAGNOSTICS.zh-TW.md)。
