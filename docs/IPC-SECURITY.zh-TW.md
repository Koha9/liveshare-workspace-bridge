# IPC 三模式接入 v0.2.2

[English](IPC-SECURITY.md) | [简体中文](IPC-SECURITY.zh-CN.md) | **繁體中文** | [日本語](IPC-SECURITY.ja.md)


## 模式與範圍

執行 **Live Share Workspace Bridge: Configure IPC Access**，或編輯英文 User 設定 `liveshareWorkspaceBridge.ipc.accessMode`。信任只採用明確 User 值；工作區與擴充套件提供的預設不能擴大授權。

| 模式 | 橋接所屬使用者以外的授權 |
|---|---|
| ownerOnly | 無，發佈預設。 |
| allLocalUsers | 目前本機 SAM 的全部使用者帳戶，包含已停用帳戶（既有處理程序仍可能存在）；不是 Everyone、Authenticated Users、本機群組或網域使用者。 |
| selectedUsers | 僅 ipc.selectedUserSids 儲存的精確 SID，且仍為目前本機使用者。 |

橋接擁有者始終保留，即使 VS Code 由網域使用者執行；額外授權只限本機帳戶。三模式都拒絕遠端連線，並要求相同 Windows 工作階段。這是 session ID 檢查，不保證不同 run-as 權杖具有相同 logon SID。網域控制站拒絕額外帳戶列舉，避免把網域 SAM 誤當本機。

信任帳戶下所有處理程序，不只 Codex／單一工作。呼叫超出 Codex 檔案系統沙箱邊界，仍受 agent／操作開關控制。Host／terminal 獨立且本設定不會啟用；若 terminal.enabled 原本為 true 且其他條件成立，獲准帳戶可能執行 Host 命令。擴大授權前選擇器會警告。

選擇器顯示目前名稱與 SID，實際儲存 SID。改名不改授權；刪除 SID 保留為不可用、不放行，同名重建的新 SID 必須重新選擇。非法、通用群組與非本機 SID 會報告於 ipc.selectionIssues，不予授權。開啟或取消選擇器不修改設定。

allLocalUsers 在橋接啟動時列舉本機 SAM；新增帳戶於重新啟動後納入。不建立、啟用、改名帳戶，不修改機器／網域策略、憑證或網路映射。

## 舊設定相容

新模式未設定且舊 ipc.allowCodexSandboxClients 為 true 時，首次僅解析既有兩個舊帳戶名稱，快取 SID、寫入 ipc.selectedUserSids，再設定 selectedUsers，不會自動選 allLocalUsers。固定後不再依名稱解析。缺少帳戶不猜替代身分；空結果不增加授權。布林值沒有歷史 SID，首次快照前刪除重建無法由布林還原；有疑問先核對遷移計畫／目前身分。

明確新模式（含 ownerOnly）優先。舊 false／未設定維持 ownerOnly，不遷移。不覆寫模糊手動 SID 清單或已觀察到的同時設定變更。舊布林保留相容，但新模式明確後 v0.2.2 忽略它；舊版視窗須重新載入才識別新規則，不能以新模式控制未升級視窗。

遷移寫入 User 設定；策略變更會重新啟動本機橋接、改變 instance/epoch，需重新探索。不主動重新載入 VS Code 或啟用 Host，不撤銷已派發效果，不重送結果未知的修改。安裝可能另需重新載入宿主／視窗及重連 Live Share；影響現有連線前需部署確認。

## 診斷與實作

```powershell
node "<client>" diagnose
node "<client>" instances
```

diagnose 僅登錄目錄與 info 探測，不繫結 Host 或寫共用檔案。區分 ready、partial、no_records、no_shared_workspace、access_denied、unavailable、invalid_registry。過期／遭拒記錄可與健康目標並存；EPERM/EACCES 不等於未啟用擴充套件。檢查模式／SID，不自行擴權、停用沙箱或自動選 allLocalUsers。

以本機 NetUserEnum／NetUserGetInfo 與機器角色檢查讀取 SAM。保留明確 DACL、遠端拒絕、同工作階段、單一持續 FIRST_PIPE_INSTANCE、有界 UTF-8／回應排空。不模擬用戶端、不開 HTTP 或複製 token。[v0.2.2 驗證](VALIDATION-v0.2.2.zh-TW.md)區分模擬、真實跨帳戶與待部署驗證。
