# 开发指南

[English](DEVELOPMENT.md) | **简体中文** | [繁體中文](DEVELOPMENT.zh-TW.md) | [日本語](DEVELOPMENT.ja.md)

需要 Windows、Node.js 和已确认的 Python 3。运行时使用内置模块、Windows PowerShell 和随包 C# 源码；打包只依赖 Python 标准库，不需安装依赖。

```text
extension/                         Runtime, CLI and tests
skills/liveshare-workspace-bridge/  Skill and self-contained client
scripts/build.py                   Packaging and source checks
docs/                              Current product/contributor guides
dist/                              Ignored generated packages
.local/                            Ignored local working files
```

extension/cli.cjs 是规范客户端，构建同步其 skill 副本。保持源码与 skill 版本、API 字段和译文一致；skill 指令／引用只维护英文。

```powershell
npm test
npm run check
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py
& $pythonExe .\scripts\build.py --check
& $pythonExe .\scripts\build.py --verify
```

常规测试覆盖文档／保存／权限／IPC 契约，不修改已连接项目。本地通过不代表所有 Host、账号、策略、远端会话或语言提供者可用。

构建生成 VSIX、skill ZIP 和 SHA-256。--check 验证布局／版本／客户端同步，--verify 对比包与源码精确成员。读者文档采用明确白名单，不包含历史验收、issues、.local 或私有 memo。

真实测试需明确范围、唯一自有目录和清理。extension/test/live-v01.cjs 要求 LIVESHARE_RUN_LIVE=1，并会改变搜索视图；live-sandbox.cjs 只用已有本机账号，可能初始化自有临时工作区 ACL，不发送 Host 命令。它们不属于常规 CI。

```powershell
$env:LIVESHARE_RUN_SANDBOX = '1'
$env:LIVESHARE_CODEX_EXE = '<absolute-path-to-codex.exe>'
node .\extension\test\live-sandbox.cjs
```

Host 测试使用目标 RW 共享 PowerShell，固定根目录／epoch；临时设置恢复时不覆盖用户并发改动。关闭 terminal 必须拒绝 Host，不退回 Guest，不隐含 stage／commit／push。

四语言读者文档的链接、命令和限制需一致，修改后检查引用和包。不要把机器回执、凭据、Host 原始路径或调查叙述放入公开文档／包。生成文件和本地工作文件已忽略，Windows CI 只检查构建不发布。
