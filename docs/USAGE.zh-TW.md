# 使用指南

[English](USAGE.md) | [简体中文](USAGE.zh-CN.md) | **繁體中文** | [日本語](USAGE.ja.md)

[文件](README.zh-TW.md)

## 安裝

使用已確認的 Python 3 執行檔建置安裝套件：

```powershell
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py
```

在 Live Share Guest 視窗使用的 Profile 中安裝 `dist/` 下的 VSIX，將 `skills/liveshare-workspace-bridge/` 複製到 Codex skills 目錄。依提示重新載入 VS Code，並將 Guest 視窗連線到共享專案。

## 選擇工作區

```powershell
node .\extension\cli.cjs instances
```

依 `roots[].name` 和完整的 `roots[].uri` 選擇目標專案，記住 `id`、`epoch` 和根 URI。有多個視窗時應明確選擇，不以目前編輯器焦點代替視窗身分。

```powershell
node .\extension\cli.cjs --instance '<id>' --epoch '<epoch>' `
    --workspace 'vsls:/' --request '<request.json>'
```

CLI 也接受從 stdin 輸入的 JSON 物件。請從可用的本機目錄啟動；`vsls:` URI 不是本機檔案系統路徑。

## 讀取與編輯

使用 `read` 讀取相關行，或透過 `readMany` 讀取多個檔案。讀取會傳回目前緩衝區內容和文件 `version`，後續編輯可沿用該版本。

```json
{"op":"edit","files":[{"path":"src/main.ts","expectedVersion":4,"changes":[{"oldText":"return oldValue;","newText":"return newValue;"}]}]}
```

`oldText` 預設必須唯一；只有明確要取代所有符合項目時才設定 `all:true`。相關的多檔修改優先集中到一次 `edit` 請求。新檔案使用 `create`，完整取代既有檔案則使用附帶保護條件的 `write`。

新檔案從內容推斷 LF 或 CRLF，也可用 `eol` 明確指定。既有文件保留原有換行格式。建立、複製與移動預設建立缺少的父目錄；若先前結果已確認父目錄存在，可傳入 `parents:false`。

## 檢查儲存結果

檢查 `applied`、`saved` 和逐檔 `dirty` 狀態。正常成功後不需要再次讀取，也不需要 Host 人工確認。若修改已套用但儲存失敗，保留緩衝區，重試時使用 `save` 和傳回的版本，不要重新提交整批修改。

既有未儲存文件預設受到保護。只有明確希望納入並儲存這些原有修改時，才設定 `allowDirty:true`。

## 搜尋與導覽

`search` 使用 VS Code 的 Search View 並傳回快照；`searchResults` 只讀取目前檢視，不重新發起搜尋。兩者都不保證搜尋已完成。`findFiles` 可能遺漏新檔案；已知正確路徑時應直接讀取，不要求它先出現在搜尋結果中。

使用 `symbols`、`workspaceSymbols` 和 `definition` 進行語言感知導覽，結果取決於專案可用的語言提供者。

## 管理連線

服務隨 VS Code 視窗執行。需要時，可在命令選擇區執行 `Live Share Workspace Tools: Restart Connection` 或 `Live Share Workspace Tools: Stop Connection`。

新視窗或重新載入會改變執行個體 ID，工作區變更會更新 epoch。出現 `instance_mismatch`、`workspace_changed` 或執行個體不可用錯誤時，重新探索並核對專案。
