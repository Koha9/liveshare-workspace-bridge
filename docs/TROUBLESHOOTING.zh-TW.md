# 故障排查

[English](TROUBLESHOOTING.md) | [简体中文](TROUBLESHOOTING.zh-CN.md) | **繁體中文** | [日本語](TROUBLESHOOTING.ja.md)

[文件](README.zh-TW.md) | [API](API.zh-TW.md)

## 連線與權限

將擴充套件安裝到 Live Share Guest 視窗的 Profile。更新後重新載入該視窗、重新連線目標工作階段，並請 agent 呼叫 `lswb_list_workspaces`。依根目錄名稱與完整 vsls URI 選擇專案。重新載入後出現繫結錯誤時需要重新探索。擴充套件 Output 通道會報告管道啟動錯誤。診斷橋接的人員可在已安裝的擴充套件目錄執行 `node extension/cli.cjs instances` 或 `diagnose`；agent 則使用 MCP 工具。

重新載入或當機的視窗可能留下探索記錄。當其管道不存在且擁有者處理程序已結束時，探索會將該探測回報為 `stale` 並附 `ownerProcess: "exited"`，不計為失敗；若只剩此類記錄，狀態為 `no_records`。擴充套件會在下次啟用時移除這些記錄。

打開 **Live Share Workspace Bridge: Configure Agent Permissions**。agent 存取預設開啟；Host 存取（`host.enabled`）預設關閉。檢查組態權限與有效權限。這些設定由使用者控制；agent 不得自行啟用來繞過拒絕。權限變更只阻止新工作，不撤銷已派發的效果。

## 執行中斷線與復原

broken pipe 清理：用戶端逾時後，遲到回應的寫入失敗不再讓監聽器空轉。writer 清理錯誤會被隔離，損壞的連線會被中斷，監聽器故障時會結束而非空轉。真實 Windows 管道測試涵蓋此情境；尚未確認視窗失焦是觸發原因。

先前已 ready 的 IPC 輔助程式結束後，會在 1／2／4 秒後重新啟動，連續不穩定時最多三次；穩定 ready 一分鐘後重設次數。不需要焦點事件或 Host 輪詢。啟動／原則／存取失敗及明確的 Stop 不會自動重新啟動。傳輸復原保留 instance／epoch、Host 工作與不確定狀態，循序處理進行中的工作，絕不重送已送出的操作。

仍斷線時，檢查 `lswb_status`（若你是手動診斷，則執行一次 CLI `diagnose`）。任務已授權復原連線時，agent 可在目標 Guest 視窗的命令選擇區執行 **Live Share Workspace Bridge: Restart Connection**（`liveshareWorkspaceBridge.restart`）：按 Ctrl+Shift+P，或按 Ctrl+P 後輸入 `>`。沒有可用的 UI 工具時，只請使用者執行一次。手動重新啟動會改變 instance／epoch，並使 Host 工作／傳輸控制代碼失效；之後依根目錄名稱與完整 URI 重新探索一次。Host 不確定狀態仍保留：確認 Host 已復原後才能確認。不可繞過遭拒的存取、原則失敗或刻意的 Stop，也不可重送結果未知的修改。IPC 復原不會重新加入 Live Share，也不會修復缺失的 Host 終端。

## Host 終端缺失或無回應

Host 功能需要一個已連線、具讀寫權限的共用 Windows PowerShell 終端；它啟動一次 Host 輔助程式，之後由 Host 以「Live Share: Share Server」共用輔助程式連接埠。一般 Guest 終端不合格。缺少時，agent 只請求使用者設定 Host 一次並等待。多個候選需要已組態的準確名稱。不重複提示、不猜測終端，也不改用其他執行路徑。

繫結以自有的暫存 bootstrap 檔案驗證共用根目錄。當 `lswb_host_status` 顯示 `handshake.state: "waitingForward"` 時，請 Host 共用顯示的連接埠並輪詢狀態；其他 Host 工具回傳 `host_handshake_pending`。若交握失敗或已取消，請 Host 在任何先前的輔助程式上按 Ctrl+C，再重新繫結。已送出但結果未知的修改會使通道進入隔離狀態；不要重送修改。保留回報記錄、檢查受影響的目標，並等待使用者確認 Host 已閒置或輔助程式已重新啟動，再以明確的 acknowledgeRecovery 繫結。逾時詳細資料只包含計數，不包含擷取的檔案內容。

## 編輯與 Host 修改

讀取不存在的檔案時以 `not_found` 失敗；批次讀取中只有該項失敗。受保護的編輯請使用目前的文件版本。dirty 緩衝區受保護；只有在保留／儲存其內容屬於任務範圍時才納入。已套用的編輯若目標儲存失敗，請以回傳的版本重試 save，不要重新套用文字。批次儲存逐檔案進行，不是交易。

Host 寫入可能使既有 Guest 緩衝區過期或變為 dirty。editor_refresh_pending／external_change_dirty_document 會保留內容，而不全域還原使用者的編輯器。請與使用者一起處理受影響的緩衝區，或安全地重新開啟；明確的 hostStat withTextHash 只重新整理預期的規範化摘要，不重新整理編輯器本身。Guest 文字／EOL 與 Host 原始位元組不同。Host Git 組態可能將修補結果轉為 CRLF。

## 搜尋與語言工具

Host rg 搜尋已儲存的檔案；遇到限制／失敗時 complete 為 false，無匹配的退出碼 1 正常。dirty 緩衝區另外列出，絕不自動儲存。快照查詢仍明確不完整。語言操作需要提供者；提供者不可用時回報錯誤，空的診斷結果不能證明建置或測試通過。

## 檔案操作與限制

覆蓋位元組需要目前的 Host 原始 SHA-256。目錄複製需要新的目的地，且可能部分失敗。未實作遞迴刪除與跨檔案原子儲存。遇到 response_limit 時，請求相關範圍或較少的結果。提供者的部分文字回應不代表支援串流讀取。

大檔案下載（`transferOpenRead`／`transferRead`）回傳 `feature_unavailable`。請使用者提供可存取副本與本機路徑，不反覆小塊讀取或用原始命令繞過限制；小檔案位元組讀取與大檔案上傳仍可用。
