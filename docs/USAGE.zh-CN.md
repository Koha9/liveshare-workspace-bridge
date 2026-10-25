# 使用指南

[English](USAGE.md) | **简体中文** | [繁體中文](USAGE.zh-TW.md) | [日本語](USAGE.ja.md)

[文档](README.zh-CN.md)

## 安装

使用已确认的 Python 3 可执行文件构建安装包：

```powershell
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py
```

在 Live Share Guest 窗口使用的 Profile 中安装 `dist/` 下的 VSIX，将 `skills/liveshare-workspace-bridge/` 复制到 Codex skills 目录。按提示重载 VS Code，并将 Guest 窗口连接到共享项目。

## 选择工作区

```powershell
node .\extension\cli.cjs instances
```

根据 `roots[].name` 和完整的 `roots[].uri` 选择目标项目，记住 `id`、`epoch` 和根 URI。存在多个窗口时应明确选择，不以当前编辑器焦点代替窗口身份。

```powershell
node .\extension\cli.cjs --instance '<id>' --epoch '<epoch>' `
    --workspace 'vsls:/' --request '<request.json>'
```

CLI 也接受从 stdin 输入的 JSON 对象。请从可用的本机目录启动；`vsls:` URI 不是本地文件系统路径。

## 读取和编辑

使用 `read` 读取相关行，或通过 `readMany` 读取多个文件。读取返回当前缓冲区内容和文档 `version`，后续编辑可复用该版本。

```json
{"op":"edit","files":[{"path":"src/main.ts","expectedVersion":4,"changes":[{"oldText":"return oldValue;","newText":"return newValue;"}]}]}
```

`oldText` 默认必须唯一；只有明确要替换全部匹配时才设置 `all:true`。相关的多文件修改优先集中到一次 `edit` 请求。新文件使用 `create`，完整替换已有文件使用带保护条件的 `write`。

新文件从内容推断 LF 或 CRLF，也可用 `eol` 显式指定。已有文档保留原有换行格式。创建、复制和移动默认创建缺失父目录；已通过先前结果确认父目录存在时，可传 `parents:false`。

## 检查保存结果

检查 `applied`、`saved` 和逐文件的 `dirty` 状态。正常成功后无需再次读取，也无需 Host 人工确认。若修改已应用但保存失败，保留缓冲区，重试时使用 `save` 和返回的版本，不要重新提交整批修改。

已有未保存文档默认受到保护。只有明确希望合并并保存这些原有修改时，才设置 `allowDirty:true`。

## 搜索与导航

`search` 使用 VS Code 的 Search View 并返回快照；`searchResults` 只读取当前视图，不重新发起搜索。两者都不保证搜索已完成。`findFiles` 可能遗漏新文件，已知准确路径时应直接读取，不要求它先出现在搜索结果中。

使用 `symbols`、`workspaceSymbols` 和 `definition` 进行语言感知导航，结果取决于项目可用的语言提供者。

## 管理连接

服务随 VS Code 窗口运行。需要时，可在命令面板执行 `Live Share Workspace Tools: Restart Connection` 或 `Live Share Workspace Tools: Stop Connection`。

新窗口或重载会改变实例 ID，工作区变化会更新 epoch。出现 `instance_mismatch`、`workspace_changed` 或实例不可用错误时，重新发现并核对项目。
