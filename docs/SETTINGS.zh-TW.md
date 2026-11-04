# 設定說明

[English](SETTINGS.md) | [简体中文](SETTINGS.zh-CN.md) | **繁體中文** | [日本語](SETTINGS.ja.md)

[文件](README.zh-TW.md)

本文對應目前倉庫 schema，已安裝發佈版可能有較少或不同的命令／欄位，以其版本、Settings UI 和匹配的發佈資產為準。以下所有鍵都有 liveshareWorkspaceBridge. 前綴，schema scope 為 machine（VS Code 允許的 User／Remote 設定，不是 Workspace／Folder）。UI 擴充套件在 Windows Guest 執行，變更 Host 機器的設定不是同一件事。IPC 信任只讀明確的 User global 值，忽略工作區與擴充套件提供的預設值。

## 一般、IPC 與 Host 參數

| 設定（省略前綴） | 型別／預設／範圍 | 用途與安全 | 生效 |
|---|---|---|---|
| `agent.enabled` | `boolean` / `true` | 工作區操作總開關。info／hostStatus 與安全診斷資料仍可檢查；關閉不撤銷已派發效果。 | 後續請求生效，並使 Host 繫結／資源失效。 |
| `host.enabled` | `boolean` / `false` | 允許依賴 Host 的 API，仍須單項操作開關及已驗證的共用 RW 終端；該終端只用來啟動一次 Host 輔助程式。繫結可建立／刪除自有的暫存 bootstrap 檔案；絕不把一般 Guest shell 當成 Host。取代 `terminal.enabled`。 | 後續請求生效，並使 Host 繫結／資源失效。 |
| `powershell` | `string` / `""` | Guest 本機 IPC／帳戶輔助程式的 PowerShell 執行檔覆寫；空值使用內建 Windows PowerShell。不選擇 Host 終端 shell，也不變更執行原則。 | 下次本機橋接啟動時使用；不自動切換執行中的輔助程式。 |
| `ipc.accessMode` | `string` / `"ownerOnly"` | ownerOnly／selectedUsers。已儲存的 allLocalUsers 值（0.3.0 移除）以 ownerOnly 執行；不改寫設定，info 以 ipc.requestedMode 與 ipc.deprecatedModeIgnored 回報。擁有者始終保留。額外授權只限同一 Windows session ID 中目前的本機 SAM 使用者，不是 Everyone／群組／全部網域使用者；拒絕列舉網域控制站。信任涵蓋其所有處理程序，不受任何 agent 檔案系統沙箱限制，但仍受橋接權限約束。 | 重新啟動 IPC 橋接／新的 instance+epoch；需重新探索。 |
| `ipc.selectedUserSids` | `array` / `[]` | 僅 selectedUsers 使用的穩定 SID 選取；其他模式不依此授權。唯一清單最多 256 個字串；UI 驗證本機使用者 SID 格式，執行階段另限制每個字串最多 184 字元並驗證本機 SAM 成員資格。名稱只用於顯示；改名後保留，刪除重建絕不替代身分。 | 重新啟動 IPC 橋接／新的 instance+epoch；需重新探索。 |
| `ipc.allowCodexSandboxClients` | `boolean` / `false` | 已淘汰的相容旗標。沒有明確 User 模式時，true 將兩個既有的舊沙箱身分固定到 selectedUsers；false／未設定維持 ownerOnly。明確模式優先。絕不啟用 Host 存取。初次遷移會寫入 User 設定；布林值無法還原快照前已刪除／重建的 SID。 | 重新啟動 IPC 橋接／新的 instance+epoch；需重新探索。 |
| `host.terminalName` | `string` / `""` | 用來啟動 Host 輔助程式的共用終端準確名稱。空值需要唯一合格的共用 PTY 候選。仍會檢查唯讀提示並驗證繫結；終端標題不能證明實際 shell／版本。 | Host 繫結失效；下次允許的 Host 呼叫重新繫結。 |
| `host.workspacePath` | `string` / `""` | 可選的明確 Host 根目錄；空值時以 Guest 根目錄驗證共用 PowerShell 的目前目錄。這是 Host 路徑，不是 Guest 本機路徑。hostBind 請求引數可覆寫它。 | Host 繫結失效；下次允許的 Host 呼叫重新繫結。 |
| `host.commandTimeoutMs` | `integer` / `120000` / 1000..3600000 | Host 子命令的預設逾時（毫秒）。hostExec timeoutMs 可在支援範圍內覆寫。已啟動的工作保留原期限；這不是通用的 IPC／交握逾時。 | Host 繫結失效；下次允許的 Host 呼叫重新繫結。 |
| `host.maxOutputCharacters` | `integer` / `65536` / 1024..262144 | stdout 與 stderr 各自保留的字元數。超出部分會排空並標記截斷，不是完整輸出。 | Host 繫結失效；下次允許的 Host 呼叫重新繫結。 |
| `transfer.chunkBytes` | `integer` / `32768` / 1024..65536 | 每個傳輸區塊與小位元組 API 的原始位元組上限。Guest 驗證與 Host 工作階段都使用它；變更後會在後續 Host 工作前使繫結失效。不啟用下載。 | Host 繫結失效；下次允許的 Host 呼叫重新繫結。 |
| `transfer.idleTimeoutMs` | `integer` / `120000` / 10000..900000 | Host 傳輸控制代碼／暫存的閒置壽命（毫秒）。新繫結使用此值；舊資源保留已建立的期限。 | Host 繫結失效；下次允許的 Host 呼叫重新繫結。 |
| `host.guestPort` | `integer` / `0` / 0..65535 | Guest 連線的本機連接埠；0 表示與 Host 輔助程式相同的連接埠。只有在 Live Share 將 Host 連接埠轉送到不同的本機連接埠時才設定：若 Host 輔助程式連接埠在 Guest 上已被佔用，Live Share 會選擇另一個本機連接埠，且只在 Guest 端 Live Share 檢視的共用伺服器清單中顯示（或執行「Live Share: Show Shared Servers」）。找到 Host 輔助程式連接埠的項目，將其 Guest 本機連接埠填入此處。橋接不會自動探索重新對應的連接埠，因為 Live Share 的轉送器在同時承載其他本機服務的 VS Code 處理程序中執行，而橋接絕不探測它們。 | 每次交握嘗試時讀取：繫結等待期間輸入的值會在下一次嘗試（約 2 秒）時使用，不需重新繫結；已建立的繫結保留其連接埠。 |
| `host.idleTimeoutMinutes` | `integer` / `30` / 1..1440 | Host 輔助程式在這麼多分鐘沒有請求後結束。 | 下次啟動的輔助程式。 |
| `host.handshakeTimeoutMinutes` | `integer` / `5` / 1..60 | hostBind 啟動的背景交握等待 Host 共用輔助程式連接埠的時間；hostBind 本身會先回傳。逾時後 hostStatus 顯示 `handshake.state: "failed"` 與 `handshake.code: "host_port_forward_required"`。逾時、取消或連接埠上的外部服務都不會使通道標記為不確定。 | 下次 Host 繫結。 |

Host 通道的運作方式：共用 RW 終端啟動一次前景 Host 輔助程式（在 Ctrl+C、終端關閉、工作階段結束或閒置逾時時結束）。接著 Host 針對橋接顯示的連接埠執行一次「Live Share: Share Server」。輔助程式一開始監聽，hostBind 就回傳（`handshake.state: "waitingForward"`）；交握在背景完成並由 hostStatus 回報，期間其他 Host 請求回傳 `host_handshake_pending`。之後的請求使用轉送的 loopback 連接埠並搭配每個輔助程式專屬的權杖。不向終端輸入任何請求。

## 已淘汰的設定鍵

0.3.0 重新命名了 `terminal.*` 鍵，舊鍵只再讀取一個版本。新鍵未明確設定時，橋接仍會讀取舊鍵的 User 值，並針對每個舊鍵在「Live Share Workspace Bridge Host」輸出通道寫入一行。它絕不改寫你的設定；請自行重新命名。

| 舊鍵 | 新鍵 |
|---|---|
| `terminal.enabled` | `host.enabled` |
| `terminal.name` | `host.terminalName` |
| `terminal.hostWorkspacePath` | `host.workspacePath` |
| `terminal.commandTimeoutMs` | `host.commandTimeoutMs` |
| `terminal.maxOutputCharacters` | `host.maxOutputCharacters` |

明確設定的新鍵永遠優先，即使其值為 `false`。`host.transport` 已移除：Host 通道一律使用轉送的連接埠。已儲存的 `sharedTerminal` 值以 portForward 執行，並在同一輸出通道記錄一行；其他值會被忽略。

## 操作開關

以下每一列均為 boolean、預設 true、machine scope，套用於後續權限檢查，不需重新啟動本機 IPC。這些開關授權的是 API，而非資料類型或作業系統沙箱：例如即使停用文字 read，readBytes 仍可讀取文字檔的位元組；agent 不得以其他路徑繞過使用者意圖。

| 設定（省略前綴） | 用途與安全 | 需 Host |
|---|---|---|
| `permissions.list` | 目錄清單。 | 否 |
| `permissions.read` | 文字、批次與明確的提供者讀取；不控制原始位元組。 | 否 |
| `permissions.create` | 新文字檔；需要 save，缺少父目錄時需要 mkdir。 | 否 |
| `permissions.write` | 受保護的整份文件替換；位元組／檔案覆蓋也需要。 | 否 |
| `permissions.edit` | 文字替換／批次；也是檢查後修補授權的一部分。 | 否 |
| `permissions.save` | 目標儲存；create/write/edit/renameSymbol/format 均需要。不提供跨檔案交易。 | 否 |
| `permissions.mkdir` | 目錄與隱含的父目錄建立。 | 否 |
| `permissions.copy` | 保留位元組的 Host 檔案複製；覆蓋另需 write。 | 是 |
| `permissions.copyDirectory` | Host 複製到新目錄，不合併／不遞迴替換。 | 是 |
| `permissions.move` | 路徑移動／改名；覆蓋需要 write，缺少父目錄需要 mkdir。 | 否 |
| `permissions.delete` | 僅限檔案與空目錄。 | 否 |
| `permissions.stat` | 提供者中繼資料／Host stat；原始雜湊另需 readBytes。 | 視情況 |
| `permissions.diagnostics` | 語言診斷；空結果不是測試結果。 | 否 |
| `permissions.symbols` | 文件符號。 | 否 |
| `permissions.workspaceSymbols` | 工作區語言符號，不是完整的已儲存檔案搜尋。 | 否 |
| `permissions.definition` | 語言定義。 | 否 |
| `permissions.references` | 語言引用。 | 否 |
| `permissions.renameSymbol` | 僅文字的語言重新命名／預覽；需要 save 與目標保護。 | 否 |
| `permissions.format` | 提供者格式化與目標儲存。 | 否 |
| `permissions.search` | Host 已儲存檔案搜尋；明確快照有限且不需要 Host。 | 視情況 |
| `permissions.findFiles` | Host 路徑列舉；明確的提供者快照有限。 | 視情況 |
| `permissions.applyPatch` | 檢查後的 Host Git 文字修補；edit/create/move/delete 都會檢查。 | 是 |
| `permissions.readBytes` | Host 位元組／原始雜湊與下載控制代碼權限，受可用性限制。 | 是 |
| `permissions.writeBytes` | Host 位元組／上傳；覆蓋需要 write 與原始雜湊保護。 | 是 |
| `permissions.largeTransfers` | 分塊上傳；writeBytes 同樣適用。不啟用不可用的下載。 | 是 |
| `permissions.hostExec` | 任意 Host 命令以及 poll/cancel/forget；其餘 25 個操作開關也必須全部為 true。 | 是 |

## 特殊行為與非設定


- agent／host／transfer 設定變更（以及已淘汰的 terminal.* 鍵）會使 Host 繫結與 Guest 工作／傳輸參照失效；下次允許的 Host 呼叫重新繫結。這不會重新啟動本機 IPC instance／epoch、不停止已派發的子程序，也不改變其原期限。舊工作可能需要在 Host 端檢查；傳輸資源保留已建立的期限。IPC 鍵變更則會重新啟動橋接，即使變更的 SID／舊欄位目前未使用。
- 關閉權限不是回復。原始 hostExec 及其工作控制需要 host.enabled 與全部 26 項操作權限；停用其中一項也可能使 poll/cancel 無法使用，但子程序的有界逾時仍在。copy/write 覆蓋與隱含父目錄另有 write／mkdir 門檻。applyPatch 一律檢查 edit/create/move/delete；直接的 Host 磁碟操作不使用文件 save 權限。
- readMany/providerRead 共用 read；searchSnapshot/searchResults 共用 search；findFilesSnapshot 共用 findFiles；hostStat 共用 stat（雜湊另需 readBytes）；hostJobPoll/Cancel/Forget 共用 hostExec；傳輸 API 共用 largeTransfers，並依方向另需 readBytes/writeBytes。Host 搜尋／複製／修補／位元組／工作需要 host.enabled；快照／語言／文件 API 不需要。largeTransfers 無法讓不可用的大檔案下載變為可用。
- 在此公開 manifest 之外，未發現目前執行階段讀取的其他字面設定鍵。ipc.legacySidSnapshot 是內部 globalState，**不是設定**。hostExec timeoutMs/waitMs 與 hostBind hostWorkspacePath 是請求引數，不是 Settings UI 項目。啟動快照上限與固定的本機 IPC／Host 回應／交握等待時間是固定的實作限制，不是另設的設定。
- 原則旗標不會開啟／共用終端、不證明 Host RW 授權，也不解決已送出但結果未知的修改。請參閱 [IPC 存取](IPC-SECURITY.zh-TW.md)、[API](API.zh-TW.md) 與[啟動診斷](STARTUP-DIAGNOSTICS.zh-TW.md)。agent 可以說明遭拒的設定，但未經明確授權不得啟用它或擴大信任。
