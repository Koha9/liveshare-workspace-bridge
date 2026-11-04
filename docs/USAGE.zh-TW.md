# 使用指南

[English](USAGE.md) | [简体中文](USAGE.zh-CN.md) | **繁體中文** | [日本語](USAGE.ja.md)

[文件](README.zh-TW.md)

agent 透過橋接的 MCP 伺服器使用本擴充套件。設定方式、完整工具清單與結果語義見 [MCP 指南](MCP.zh-TW.md)。

1. 在已連線 Guest 視窗的 Profile 安裝 VSIX。
2. 執行 **Live Share Workspace Bridge: Copy MCP Server Configuration**，依 [MCP 指南](MCP.zh-TW.md)將伺服器加入你的 agent。VS Code 內建 agent 不需設定即可發現它。
3. 請 agent 呼叫一次 `lswb_list_workspaces` 並選擇目標根目錄。其他所有工具都以該根目錄的完整 `uri` 作為 `workspace` 引數。
4. 打開 **Live Share Workspace Bridge: Configure Agent Permissions**。agent 存取預設開啟；Host 存取（`host.enabled`）預設關閉。使用者手動調整英文操作開關。
5. 使用 Host 功能時，請 Host 以讀寫模式共用 Windows PowerShell 終端，並在 Guest 連線該終端。橋接只用它啟動一次 Host 輔助程式；存在多個共用終端時，請設定準確的終端名稱（`host.terminalName`）。可另外組態明確的 Host 根目錄，不猜測路徑。
6. 在授權任務中請 agent 呼叫 `lswb_host_status` 與 `lswb_host_bind`。之後由 Host 針對橋接顯示的連接埠執行「Live Share: Share Server」，agent 則輪詢 `lswb_host_status` 直到完成繫結。終端缺失時，agent 只請求使用者一次並等待；絕不在一般 Guest 終端中開始工作，也不繞過設定。

## 文字操作

使用 `lswb_read_file` 或 `lswb_read_many` 並保留版本。相關修改合併為一次 `lswb_edit_file` 請求；檢查 `applied`、`saved` 與每個目標的 `dirty` 狀態。成功後直接繼續，不追加全文驗證。`lswb_create_file` 用於新文字檔，`lswb_write_file` 用於受保護的整份替換；儲存失敗時用 `lswb_save_file` 重試，不重新套用文字。

未儲存緩衝區受保護；allowDirty:true 必須包含保留並儲存既有編輯的意圖。一般文件 EOL 反映 Guest 狀態；Host 原始位元組是另一項保證。

## 搜尋、命令和修補

`lswb_search` 與 `lswb_find_files` 使用 Host rg，並報告完整性、限制與退出碼。無匹配的退出碼 1 正常。已儲存檔案搜尋不涵蓋 dirty 緩衝區；不自動 saveAll。編輯器快照仍是明確且有限的獨立操作。

`lswb_host_exec` 回傳輸出有界的工作。以 `lswb_host_job_poll` 搭配有意義的 waitMs 與輸出游標輪詢，避免忙迴圈；`lswb_host_job_cancel` 只取消自有的處理程序樹。報告實際退出碼。原始命令需要全部操作權限；權限受限時改用已允許的窄工具，不繞過限制。

`lswb_apply_patch`（修補文字）與 `lswb_apply_patch_file`（本機修補檔）在套用文字修補前檢查路徑並執行 Host Git 預檢。checkOnly:true 只做檢查。修補的換行行為由 Git 組態決定。不隱含 commit／push。

## 位元組和大檔案

小量原始資料用 `lswb_read_bytes`／`lswb_write_bytes`。`lswb_copy` 與 `lswb_copy_dir` 由 Host 執行，因為 Live Share 文字提供者無法保留任意二進位內容。目錄複製需要新的目的地。較大的檔案用 `lswb_upload_file`；不要把整個檔案放進單一請求。上傳會驗證傳輸 SHA-256。覆蓋既有位元組檔案需要其目前的原始雜湊。

## 錯誤與控制

總開關與 Host 開關不需重新啟動即對後續請求生效，不撤銷已派發的工作。停用的權限只報告，agent 不自行變更。已送出但結果不確定的修改（`transport_outcome_unknown`）必須先檢查再重試，絕不盲目重送。

Host 寫入可能早於 Guest 模型重新載入。橋接以針對性的規範化 Host 雜湊核對受影響的已開啟緩衝區，絕不全域還原編輯器。回傳 editor_refresh_pending 時，保留緩衝區內容，並以明確的 Host 位元組讀取或重新開啟文件處理。

API 仍拒絕遞迴刪除，也不保證跨檔案原子儲存。詳細欄位、限制與復原方式見 [API](API.zh-TW.md) 與 [MCP 指南](MCP.zh-TW.md)。

任務需要不可用的操作時，agent 應請求使用者協助：指出準確路徑與需要的手動結果，並在進行相依工作前等待。大檔案下載需要使用者提供可存取副本；遞迴刪除需要使用者確認已手動刪除。必須原子儲存時，需要合適的 Host 工具，或使用者明確接受逐檔案儲存。語言提供者缺失與未解決的緩衝區衝突同樣需要協助，不強制還原，也不用原始命令繞過。

大檔案下載（`transferOpenRead`／`transferRead`）回傳 `feature_unavailable`。請使用者提供可存取副本與本機路徑，不反覆小塊讀取或用原始命令繞過限制；小檔案位元組讀取與大檔案上傳仍可用。

## 故障排查 CLI

`extension/cli.cjs` 供人員診斷橋接使用，不供 agent 使用。它支援 `instances`、`diagnose` 與一次固定繫結的原始 JSON 請求（`--instance ID --epoch N --workspace URI [--request FILE]`）。見[故障排查](TROUBLESHOOTING.zh-TW.md)。
