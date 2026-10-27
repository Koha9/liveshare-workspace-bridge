# IPC 接入與遷移

[English](IPC-SECURITY.md) | [简体中文](IPC-SECURITY.zh-CN.md) | **繁體中文** | [日本語](IPC-SECURITY.ja.md)


以英文 User 設定及 **Live Share Workspace Bridge: Configure IPC Access** 配置。僅明確 User 值控制信任，工作區與擴充套件預設不能擴權。

| 模式 | 橋接擁有者以外的範圍 |
|---|---|
| ownerOnly | 無，發佈預設。 |
| allLocalUsers | 目前本機 SAM 使用者，含可能仍有處理程序的停用帳戶；不是 Everyone、群組或全部網域使用者。 |
| selectedUsers | 精確匹配 ipc.selectedUserSids 的現有本機使用者。 |

擁有者即使是網域使用者也保留，額外授權僅本機。拒絕遠端，客戶端與橋接須相同 Windows session ID。網域控制站拒絕額外列舉。全部本機帳戶於啟動刷新，不建立或監控帳戶。

信任帳戶下全部處理程序，不限 Codex 單一工作；呼叫超出 Codex 檔案系統沙箱，仍受 agent／操作權限約束。Host 獨立，已開啟且條件成立時可能執行 Host 命令。選擇器擴權前警告，禁止自動選更廣模式。

介面顯示名稱、保存 SID。改名保留授權，刪除重建不按同名繼承。不合法、非本機、不可用 SID 報告且不放行；取消無變更。

## 相容遷移

新模式無明確 User 值且舊 ipc.allowCodexSandboxClients=true，首次只解析既有 CodexSandboxOffline／Online，快取 SID 並保存 ipc.selectedUserSids／selectedUsers，不選 allLocalUsers。固定後不依名稱重解，缺少帳戶不增加授權。首次快照前刪除重建的歷史 SID 無法由布林還原，不確定時先核對。

明確新模式優先，舊 false／未設定維持 ownerOnly。不覆寫模糊手選或已觀察到的同時變更。舊布林保留，但明確模式後新版忽略；舊視窗須更新／重新載入才適用新模式。

操作權限即時生效；IPC 信任／遷移寫 User 設定並重啟，改變 instance/epoch。取得所需部署許可、暫停依賴並重新探索。不啟用 Host、不建立帳戶／憑證或改 ACL／執行策略；已派發效果不撤銷。

## 設計邊界

原生管道使用明確 SID、遠端拒絕、同工作階段、單一持續伺服器與有界輸入／回應；SAM 不接受網域控制站。這不是所有 Windows 策略／遠端／帳戶均驗證的承諾。見[啟動診斷](STARTUP-DIAGNOSTICS.zh-TW.md)。
