# 設定說明

[English](SETTINGS.md) | [简体中文](SETTINGS.zh-CN.md) | **繁體中文** | [日本語](SETTINGS.ja.md)

本文對應目前倉庫 schema，已安裝發佈版可能有不同命令／欄位，以版本、Settings UI 和匹配資產為準。表格省略 liveshareWorkspaceBridge. 前綴，scope 為 machine（VS Code 允許的 User／Remote，不是 Workspace／Folder）。UI 擴充套件在 Windows Guest 執行，改 Host 設定不是同件事。IPC 信任只讀明確 User global，不採工作區或擴充套件預設覆蓋。

## 一般、IPC 與 Host 參數

| 設定（省略前綴） | 型別／預設／範圍 | 用途與安全 | 生效 |
|---|---|---|---|
| `agent.enabled` | `boolean` / `true` | 工作區操作總開關。info／hostStatus 與安全診斷資料仍可檢查；關閉不撤銷已派發效果。 | 後續即時生效，並使 Host 繫結／資源參照失效。 |
| `terminal.enabled` | `boolean` / `false` | 允許 Host API，仍須單項權限及驗證共用 RW 終端。繫結可建立／刪除自有 bootstrap 暫存檔，不把一般 Guest shell 當 Host。 | 後續即時生效，並使 Host 繫結／資源參照失效。 |
| `powershell` | `string` / `""` | Guest 本機 IPC／帳戶輔助程式 PowerShell 路徑；空值用系統 Windows PowerShell。不選 Host shell、不改執行策略。 | 下次本機橋接啟動使用，不自動切換目前程式。 |
| `ipc.accessMode` | `string` / `"ownerOnly"` | ownerOnly／allLocalUsers／selectedUsers。擁有者始終保留，額外只限目前本機 SAM／同 Windows session ID，不是 Everyone、群組或全部網域使用者，網域控制站拒絕列舉。信任帳戶全部處理程序，超出 Codex 檔案系統沙箱但仍受橋接權限限制。 | 重啟 IPC、改變執行個體／epoch，需重新探索。 |
| `ipc.selectedUserSids` | `array` / `[]` | selectedUsers 專用穩定 SID，其他模式不依此授權。唯一清單最多 256 字串；UI 格式檢查，執行時每項最多 184 字元且驗證本機 SAM。名稱只顯示，改名保留，刪除重建不替代。 | 重啟 IPC、改變執行個體／epoch，需重新探索。 |
| `ipc.allowCodexSandboxClients` | `boolean` / `false` | 已淘汰相容項。未明確 User 模式時，true 固定原兩個沙箱 SID 到 selectedUsers，false／未設定為 ownerOnly；明確模式優先。不自動 allLocalUsers 或開 Host。首次寫 User 設定，布林不能恢復快照前刪除重建的 SID。 | 重啟 IPC、改變執行個體／epoch，需重新探索。 |
| `terminal.name` | `string` / `""` | 目標共用終端精確名稱；空值需唯一合格共用 PTY，仍檢查唯讀並驗證繫結。標題非實際 shell／版本證明。 | Host 繫結失效，後續允許的呼叫重綁。 |
| `terminal.hostWorkspacePath` | `string` / `""` | 可選 Host 根目錄；空值驗證共用 PowerShell 目前目錄與 Guest 根。非 Guest 本機路徑，hostBind 參數可覆蓋。 | Host 繫結失效，後續允許的呼叫重綁。 |
| `terminal.commandTimeoutMs` | `integer` / `120000` / 1000..3600000 | Host 子命令預設毫秒期限；hostExec timeoutMs 可合法覆蓋。既有工作期限不變，非所有 IPC／握手逾時。 | Host 繫結失效，後續允許的呼叫重綁。 |
| `terminal.maxOutputCharacters` | `integer` / `65536` / 1024..262144 | stdout／stderr 分別保留字元上限；超出排空並標截斷，不是完整輸出。 | Host 繫結失效，後續允許的呼叫重綁。 |
| `transfer.chunkBytes` | `integer` / `32768` / 1024..65536 | 每塊原始位元組／小位元組 API 上限。Guest 與 Host 都用；修改使繫結失效，後續 Host 重新繫結。不啟用下載。 | Host 繫結失效，後續允許的呼叫重綁。 |
| `transfer.idleTimeoutMs` | `integer` / `120000` / 10000..900000 | Host 傳輸控制代碼／暫存閒置毫秒期限。新繫結用新值，舊資源保留原期限。 | Host 繫結失效，後續允許的呼叫重綁。 |

## 操作開關

以下均 boolean、預設 true、machine scope，後續權限檢查生效，不重啟本機 IPC。這是 API 授權而非內容或 OS 沙箱；readBytes 仍可能讀取被停用文字 read 的位元組，agent 不得用其他路徑繞過意圖。

| 設定（省略前綴） | 用途與安全 | 需 Host |
|---|---|---|
| `permissions.list` | 目錄清單。 | 否 |
| `permissions.read` | 文字／批次／提供者讀取，不控制原始位元組介面。 | 否 |
| `permissions.create` | 建立文字；需 save、缺父目錄需 mkdir。 | 否 |
| `permissions.write` | 保護全文替換，位元組／複製覆蓋也需 write。 | 否 |
| `permissions.edit` | 文字替換／批次，也屬修補綜合授權。 | 否 |
| `permissions.save` | 目標儲存；create/write/edit/renameSymbol/format 均需，非跨檔交易。 | 否 |
| `permissions.mkdir` | 目錄與隱含父目錄建立。 | 否 |
| `permissions.copy` | Host 保留位元組複製，覆蓋另需 write。 | 是 |
| `permissions.copyDirectory` | Host 複製到新目錄，不合併／遞迴覆蓋。 | 是 |
| `permissions.move` | 路徑移動／改名，覆蓋需 write、父目錄需 mkdir。 | 否 |
| `permissions.delete` | 僅檔案與空目錄。 | 否 |
| `permissions.stat` | 提供者／Host 資料；原始雜湊另需 readBytes。 | 依介面 |
| `permissions.diagnostics` | 語言診斷，空結果非測試通過。 | 否 |
| `permissions.symbols` | 文件符號。 | 否 |
| `permissions.workspaceSymbols` | 工作區語言符號，非完整檔案搜尋。 | 否 |
| `permissions.definition` | 語言定義。 | 否 |
| `permissions.references` | 語言引用。 | 否 |
| `permissions.renameSymbol` | 僅文字名稱變更／預覽，需 save 與目標保護。 | 否 |
| `permissions.format` | 提供者格式化並儲存。 | 否 |
| `permissions.search` | Host 已儲存檔案搜尋，顯式快照有限且不需 Host。 | 依介面 |
| `permissions.findFiles` | Host 路徑列舉，顯式提供者快照有限。 | 依介面 |
| `permissions.applyPatch` | Host Git 文字修補，檢查 edit/create/move/delete。 | 是 |
| `permissions.readBytes` | Host 位元組／原始雜湊及下載控制代碼權限，受可用性限制。 | 是 |
| `permissions.writeBytes` | Host 位元組／上傳，覆蓋需 write 與原始雜湊。 | 是 |
| `permissions.largeTransfers` | 分塊上傳另需 writeBytes，不啟用不可用下載。 | 是 |
| `permissions.hostExec` | 任意 Host 命令與輪詢／取消／忘記；其餘25操作開關也須全 true。 | 是 |

## 特殊行為與非設定


- agent／terminal／transfer 變更使 Host 繫結及 Guest 工作／傳輸參照失效，下次允許呼叫重綁；不改本機 IPC 執行個體／epoch、不停止已派發程式或改原期限。舊工作可能需 Host 人工檢查，傳輸保留原期限。IPC 組則重啟橋接，即使改的是目前不用的 SID／舊欄位。
- 關閉不是回復。hostExec 及輪詢／取消／忘記需要 terminal.enabled 和全26操作權限；停用一項也可能無法取消，但工作原逾時仍在。覆蓋／父目錄另檢查 write／mkdir；applyPatch 檢查 edit/create/move/delete；直接 Host 寫磁碟不走文件 save 權限。
- readMany/providerRead 共用 read；searchSnapshot/searchResults 共用 search；findFilesSnapshot 共用 findFiles；hostStat 共用 stat，雜湊另需 readBytes；工作控制共用 hostExec；傳輸用 largeTransfers 及方向對應 readBytes/writeBytes。Host 搜尋／複製／修補／位元組／工作需 terminal.enabled，快照／語言／文件不需。largeTransfers 不啟用不可用的大檔下載。
- 目前讀取的字面設定鍵均在公開 manifest，未發現額外隱藏設定。ipc.legacySidSnapshot 是內部 globalState，**非設定**。timeoutMs/waitMs 與 hostBind hostWorkspacePath 是請求引數；摘要上限、固定 IPC／Host 回應與握手等待不是 UI 設定。
- 開關不建立／分享終端、不證明 Host RW，也不解決未知已送結果。見 [IPC](IPC-SECURITY.zh-TW.md)、[API](API.zh-TW.md)、[啟動診斷](STARTUP-DIAGNOSTICS.zh-TW.md)。agent 未明確獲准不得自行啟用或擴權。
