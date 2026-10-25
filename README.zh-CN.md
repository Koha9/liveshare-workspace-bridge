# Live Share Workspace Bridge

[English](README.md) | **简体中文** | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md)

通过 Windows 本机桥接，让 Codex 在 VS Code Live Share 工作区中读取文件、批量编辑文档和保存修改。

## 功能

- 读取目录、指定行、多个文件及编辑器中尚未保存的内容。
- 替换文本、按行编辑，并集中修改多个文档。
- 只保存实际修改的文档，返回逐文件结果。
- 创建文件和目录、复制文件、移动或重命名路径、删除文件或空目录。
- 查询诊断、文档符号、工作区符号及定义位置。
- 使用 VS Code 原生搜索视图和文件名搜索。
- 通过仅当前 Windows 用户可访问的命名管道连接。

## 环境要求

- Windows、VS Code 和 Live Share。
- 已连接共享项目的 Live Share Guest 窗口。
- Node.js，用于 CLI 和 Codex skill。
- Python 3，用于构建安装包；构建仅使用标准库。

扩展使用 Windows 自带的 Windows PowerShell，不需要 npm 依赖，也不需要 Host 安装配套工具。

## 快速开始

### 构建并安装扩展

```powershell
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py

$vsix = Get-ChildItem .\dist\liveshare-workspace-tools-*.vsix |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
code --install-extension $vsix.FullName
```

安装到 Guest 窗口使用的 VS Code Profile。需要指定 Profile 时，追加 `--profile '<profile-name>'`。安装或更新后按 VS Code 提示重载窗口，必要时恢复 Live Share 连接。

### 添加 Codex skill

将 `skills/liveshare-workspace-bridge/` 复制到 Codex 的 skills 目录，例如 `$env:USERPROFILE\.codex\skills\liveshare-workspace-bridge`。如果同名目录已存在，先检查其中的本地修改。`dist/` 中的 ZIP 包含相同的独立 skill。

在 Codex 中调用 `$liveshare-workspace-bridge`，并说明要在共享项目中完成的任务。

### 使用 CLI

```powershell
node .\extension\cli.cjs instances

node .\extension\cli.cjs --instance '<id>' --epoch '<epoch>' `
    --workspace 'vsls:/' --request '<request.json>'
```

`request.json` 示例：

```json
{"op":"read","path":"README.md","startLine":1,"endLine":20}
```

首次选择目标窗口后，沿用它的实例 ID、epoch 和根 URI。共享文件路径相对于该根目录。详见[使用指南](docs/USAGE.zh-CN.md)和 [API 参考](docs/API.zh-CN.md)。

## 工作原理

```text
Codex skill / CLI → current-user Windows named pipe
                 → VS Code APIs → Live Share → shared files
```

桥接保留 `vsls:` URI，并操作当前文档缓冲区。批量修改统一检查后，以一份 WorkspaceEdit 提交，再逐文档保存。保存成功后不自动追加提供者回读或全文哈希。

## 限制

- 内容搜索返回当前 Search View 快照，没有完成信号；文件名搜索可能遗漏刚创建的文件。
- 多文件保存不是跨文件磁盘事务。保存失败时，应分别检查各文件结果。
- 不提供 Host shell、远程构建或 Git 执行、递归删除、目录复制、二进制写入或通用 unified diff 解析。
- 命名管道属于同一 Windows 用户权限范围内的自动化接口，不隔离以该用户身份运行的其他程序。

## 文档

通过[文档目录](docs/README.zh-CN.md)查看安装、API、架构、开发及故障排查说明。

## 开发

```powershell
npm test
npm run check
& $pythonExe .\scripts\build.py --check
& $pythonExe .\scripts\build.py --verify
```

构建产物输出到 `dist/`。源码结构与打包流程见[开发指南](docs/DEVELOPMENT.zh-CN.md)。

## 许可证

采用 MIT 许可证。详见 [LICENSE](LICENSE)。
