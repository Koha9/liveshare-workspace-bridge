# Live Share Workspace Bridge v0.2

[English](README.md) | **简体中文** | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md)

v0.2.2：**Configure IPC Access** 提供 ownerOnly（默认）、allLocalUsers 和按稳定 SID 保存的 selectedUsers。旧 true 只迁移原有指定账号，不自动放行全部账号。见 [IPC 三模式](docs/IPC-SECURITY.zh-CN.md)，Host 权限仍独立。

通过 Windows 本机桥接，让 Codex 操作已经连接的 VS Code Live Share 工作区。v0.2 将文档编辑与可选的、经过验证的 Host RW PowerShell 通道结合起来，无需 HTTP 端口或复制 token。

## 功能

- 读取文档及指定范围、批量编辑、只保存目标文件并返回明确结果。
- Host ripgrep 内容搜索和路径枚举，报告完成状态、退出码和截断。
- Host 子进程命令、stdout/stderr 游标、超时及自有进程树取消。
- 经过 Git 检查的文本补丁、查找引用、纯文本符号重命名和语言服务格式化。
- 保持原始字节的读写、文件复制、复制到新目录，以及带 SHA-256 校验的分块大文件上传。
- 英文权限设置：agent 总开关、各项操作开关及联动的终端总开关。

递归删除和跨文件“全成或全败”保存不提供。Host 搜索覆盖已保存文件，不覆盖未保存的编辑器缓冲区。显式搜索快照仍不完整。**大文件下载本版禁用**；小文件字节读取和大文件上传仍可用。

## 环境与安装

Guest 需要 Windows、VS Code、Live Share 和 Node.js。Host 功能需要 Windows Host 上共享的可读写 PowerShell，并在 Guest 连接；搜索需要 ripgrep，补丁需要 Git。桥接可从 Host VS Code 安装中发现 ripgrep。无需安装常驻 Host agent，绑定时只加载内存中的会话辅助程序。

使用已确认的 Python 3 可执行文件构建；只依赖标准库：

```powershell
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py
$vsix = Get-ChildItem .\dist\liveshare-workspace-bridge-*.vsix |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
code --install-extension $vsix.FullName
```

将扩展安装到 Guest 窗口使用的 Profile；按提示重载并重新连接 Live Share。检查已有本地定制后，将 `skills/liveshare-workspace-bridge/` 安装到 Codex skills 目录，使用 `$liveshare-workspace-bridge`。

## 权限

运行 **Live Share Workspace Bridge: Configure Agent Permissions**，或在 VS Code 设置中搜索 `@ext:Koha9-Lee.liveshare-workspace-bridge`。设置名称保留英文。

- **Allow Agent Access**：agent 总开关，默认开启。
- **Allow Shared Host Terminal Access**：默认关闭；开启后仍受各项操作权限约束。
- 单项开关覆盖读取、编辑、保存、文件操作、搜索、语言工具、补丁、字节、上传和 Host 命令。
- 关闭终端访问会禁用所有 Host 功能，但保留单项配置；Guest 文档功能仍受各自权限控制。
- 原始 Host 命令要求全部操作权限开启，因为任意代码能够绕过细分文件操作限制。

状态栏显示 **Agent off**、**Guest only** 或 **Host allowed**；Host allowed 表示权限允许，不代表终端已连接或验证。设置即时作用于后续请求，不回滚已派发工作；子命令仍受超时限制。

缺少 Host RW 终端时，skill 请求用户开启并共享一次，然后等待。它不创建普通 Guest 终端、不猜测替代终端，也不自行改设置绕过拒绝。需要尚未支持的操作时，它说明准确路径和目标结果，请用户协助，并等待回复后再继续依赖该步骤的工作。大文件下载、递归删除、原子保存、缺少语言服务及未解决的编辑器冲突均适用。

## CLI

```powershell
node .\extension\cli.cjs instances
node .\extension\cli.cjs --instance '<id>' --epoch '<epoch>' --workspace 'vsls:/' --request '<request.json>'
node .\extension\cli.cjs upload --instance '<id>' --epoch '<epoch>' --workspace 'vsls:/' --input '<local.bin>' --path 'assets/file.bin'
```

选定项目后沿用 instance/epoch/root；固定绑定的请求不会额外发送 info 探测。参见[使用指南](docs/USAGE.zh-CN.md)和[API](docs/API.zh-CN.md)。

## 设计与限制

普通编辑复用文档版本，集中应用相关修改，只保存目标；成功后不默认重读提供者或计算全文哈希。Host 字节操作避开 Live Share 文本提供者的有损二进制通道。受影响的已打开缓冲区会与定向 Host 文本摘要核对，版本变化本身不足以证明已刷新；不会全局回退编辑器。

Guest 文档 EOL 不证明 Host 原始字节一致。Git 补丁行尾受 Host Git 配置影响。搜索采用 rg 忽略规则，不完全复刻 VS Code 条件排除。目录复制只允许新目标，可能部分失败，不合并或递归覆盖已有目录。

命名管道默认仅当前 Windows 用户可访问；明确选择额外本机账号接入时，接入范围见前述 IPC 安全说明。操作权限不是任意 Host 代码的操作系统沙箱。Host 子进程使用 Windows Job Object，超时和取消针对自有进程树，不针对共享 PowerShell。上传临时资源有空闲过期和完整性校验。

约 1.1 MB 的实际下载曾多次使共享终端停止回应，根因未解决。`transferOpenRead`／`transferRead`（含 CLI download）在派发 Host 命令前返回 `feature_unavailable`。不要循环小块读取绕过；请用户提供可访问副本。具体证据见[验收记录](docs/VALIDATION-v0.2.zh-CN.md)。

## 开发

```powershell
npm test
npm run check
& $pythonExe .\scripts\build.py --check
& $pythonExe .\scripts\build.py --verify
```

无需 npm 依赖。源码与 skill 一起维护，构建同步自包含客户端。参见[开发指南](docs/DEVELOPMENT.zh-CN.md)、[架构](docs/ARCHITECTURE.zh-CN.md)和[文档目录](docs/README.zh-CN.md)。许可证：[MIT](LICENSE)。
