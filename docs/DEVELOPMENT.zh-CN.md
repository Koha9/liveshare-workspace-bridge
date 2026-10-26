# 开发指南 v0.2

[English](DEVELOPMENT.md) | **简体中文** | [繁體中文](DEVELOPMENT.zh-TW.md) | [日本語](DEVELOPMENT.ja.md)

v0.2.2：**Configure IPC Access** 提供 ownerOnly（默认）、allLocalUsers 和按稳定 SID 保存的 selectedUsers。旧 true 只迁移原有指定账号，不自动放行全部账号。见 [IPC 三模式](IPC-SECURITY.zh-CN.md)，Host 权限仍独立。

[文档](README.zh-CN.md)

## 环境

使用 Windows、Node.js 和已确认的 Python 3 可执行文件。扩展使用 Node 内置模块和 Windows PowerShell；Host 内存运行时由 PowerShell 编译 C#。构建只使用 Python 标准库，不需要安装 npm 依赖。

## 源码布局

```text
extension/                    Extension, CLI, and tests
skills/liveshare-workspace-bridge/    Codex skill and self-contained client
scripts/build.py              Synchronization, packaging, and package checks
docs/                         User and contributor documentation
dist/                         Generated packages and SHA-256 files
.local/                       Local-only working files
```

`extension/cli.cjs` 是唯一规范客户端；构建同步到 skill。接口变化必须同步 API 和各语言文档。skill 指令与引用只维护英文，不在 skill 目录添加语言副本。

## 检查与构建

```powershell
npm test
npm run check

$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py --check
```

测试覆盖编辑预检、部分保存失败、dirty 保护、实时权限依赖、补丁路径、过期模型保护、真实 Windows IPC、Host 字节原语、有界输出、取消和进程清理。普通测试不修改已连接的 Live Share 项目。

```powershell
& $pythonExe .\scripts\build.py
& $pythonExe .\scripts\build.py --verify
```

`dist/` 输出 VSIX、自包含 skill ZIP 和 SHA-256 文件。`--check` 只检查布局、版本和客户端同步；`--verify` 只对比现有包成员、源码与校验和。包包含多语言读者文档和验收记录。

## 实际 Live Share 验证

`extension/test/live-v01.cjs` 是显式启用的旧版集成测试；仅在授权的连接和隔离测试范围内设置 `LIVESHARE_RUN_LIVE=1` 运行。它创建并清理唯一目录、将本机回执保存到 `.local/evidence/`，还会改变搜索视图。不要加入默认测试或 CI。

v0.2 Host 验证需要专用 RW 共享 PowerShell 和自有唯一测试目录。临时设置必须记录原值并恢复，不能覆盖用户同时做出的更改。终端权限关闭时所有 Host 功能必须被拒绝，不能退回 Guest 终端。测试不 stage/commit/push。37 项本地测试通过不代表实际大文件下载通过；分项证据和未完成验收见[验收记录](VALIDATION-v0.2.zh-CN.md)。

## 文档与仓库卫生

英文无语言后缀，翻译使用 `.zh-CN`、`.zh-TW`、`.ja`，对应页面互链。保持命令、API 字段、数值限制、权限默认值和失败边界一致；不要翻译实际设置名称或 API 标识符。翻译更新后检查链接与代码示例，并重新构建验证包。

`dist/`、`.local/`、依赖和本地配置不进 Git。不要提交 token、本机回执、用户目录或 Host 原始路径。`.github/workflows/ci.yml` 在 Windows 上检查和构建，不发布。验收文档只记录可分享的结果，不包含私有回执内容。

显式启用的本机沙箱 IPC 验收：只使用已有账户，初始化仅针对自有临时工作区，不发 Host 命令。

```powershell
$env:LIVESHARE_RUN_SANDBOX = '1'
$env:LIVESHARE_CODEX_EXE = '<absolute-path-to-codex.exe>'
node .\extension\test\live-sandbox.cjs
```
