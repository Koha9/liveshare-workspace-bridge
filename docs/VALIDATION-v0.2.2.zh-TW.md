# v0.2.2 候選版驗證

[English](VALIDATION-v0.2.2.md) | [简体中文](VALIDATION-v0.2.2.zh-CN.md) | **繁體中文** | [日本語](VALIDATION-v0.2.2.ja.md)


本記錄是原始碼／套件驗證，不是已安裝 v0.2.2 的生產驗收。保留既有 v0.2.1 WIP，本輪未更新已安裝擴充套件、本機 skill 或 User 設定。安裝／實際遷移可能重新啟動橋接或視窗，等待額外部署確認。

| 證據 | 結果 |
|---|---|
| 本機套件 | Windows 53 項測試通過、無跳過；語法、建置、skill 與套件驗證通過。 |
| 原生策略模擬 | ownerOnly 忽略額外選擇；allLocalUsers 僅映射本機目錄；selectedUsers 精確比對 SID。改名保留授權，刪除同名重建不繼承；非法、群組及外域 SID 拒絕。 |
| 真實本機 API | 既有本機 SAM 列舉成功，指定帳戶 DACL 無通用群組授權；第二伺服器執行個體／異工作階段邏輯遭拒。網域控制站拒絕只測角色／策略，非真實網域控制站。 |
| 遷移／UI 模擬 | 舊 true 只固定原有兩 SID 為 selectedUsers，false 不遷移；快取 SID 不按名稱重新解析。User 明確模式優先，工作區／預設注入不擴權。取消不寫，確認儲存 SID，不改 terminal。 |
| 真實跨帳戶回顯 | 既有 CodexSandboxOffline／Online 在 ownerOnly 傳送前遭拒，selectedUsers 依捕獲 SID 完成 Unicode 往返；僅自有獨立暫存管道，非已安裝 Live Share。 |
| 未執行 | 未在目前環境部署 allLocalUsers，未建立／改名／刪除帳戶，無生產／Host 命令或資料庫操作、無機器／網域策略修復；尚未驗收已安裝 v0.2.2 遷移與 Live Share 寫檔。 |

v0.2.1 的真實驗收是歷史證據，不能替代新版安裝後驗收。未真實改名帳戶、登入外域、建立第二 Windows 工作階段或做遠端滲透。UI 只做模擬，未套用至目前 VS Code。全部本機帳戶只測目錄／策略映射，不代表全部帳戶逐一登入驗證。

本機計畫記錄兩個目前舊 SID 與 User 設定雜湊，安裝前須重新核對，身分／設定改變後不可直接套用。首次快照前刪除重建的 SID 無法從舊布林恢復。確認後安裝、必要時重新載入、核對 selectedUsers／精確 SID、按需重連目標 Live Share，再做自有目錄驗收，不新增 Host 權限。

後續補充的針對性測試亦已通過：跨處理程序輸出分片的 Unicode 帳戶名稱可正確解碼。
