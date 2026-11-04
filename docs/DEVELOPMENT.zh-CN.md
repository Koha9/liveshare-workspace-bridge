# 开发指南

[English](DEVELOPMENT.md) | **简体中文** | [繁體中文](DEVELOPMENT.zh-TW.md) | [日本語](DEVELOPMENT.ja.md)

需要 Windows、Node.js 和已确认的 Python 3。运行时使用内置模块、Windows PowerShell 和随包 C# 源码，没有 npm 依赖；打包只依赖 Python 标准库。测试使用 `extension/package.json` 中声明的 devDependencies（MCP SDK 互通测试）：运行 `npm test` 之前先在 `extension/` 中执行一次 `npm ci`。

```text
extension/                         Runtime, CLI and tests
scripts/build.py                   Packaging and source checks
docs/                              Current product/contributor guides
dist/                              Ignored generated packages
.local/                            Ignored local working files
```

MCP server（extension/mcp-server.cjs 和 mcp-tools.cjs）是唯一的 agent 接口。extension/cli.cjs 是排障 CLI，也是 MCP server 使用的本机传输库；请保留 mcp-tools.cjs 依赖的导出。保持版本、API 字段和译文一致。

```powershell
npm test
npm run check
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py
& $pythonExe .\scripts\build.py --check
& $pythonExe .\scripts\build.py --verify
```

仓库根目录提供打包入口：Windows 使用 `./build.ps1` 或 `build.bat`，Unix／Git Bash 使用 `sh ./build.sh`。无参数时构建并校验 `dist/` 中的 VSIX 及其 SHA-256 文件；`--check`、`--verify`、`--help` 原样传给 `scripts/build.py`。需要时可用 `LSWB_PYTHON` 指定 Python 3 可执行文件的完整路径。Windows 自动选择当前 Conda、用户 Anaconda 或 Python Launcher；Unix 使用当前 Conda 或 Python 3。这些入口也支持从其他当前目录调用。

常规测试覆盖文档／保存／权限／IPC 约定，不修改已连接的项目。本地测试通过不代表所有 Host、账号、策略、远端会话或语言提供者都可用。

构建生成 VSIX 及其 SHA-256 文件。--check 验证布局和版本；--verify 把当前包与源码的精确成员对比。读者文档采用明确的白名单，不包含历史验收文档、issues、.local 或私有 memo。

真实测试需要明确的范围、唯一的自有测试目录和清理。extension/test/live-v01.cjs 要求 LIVESHARE_RUN_LIVE=1，并会改变搜索视图。live-sandbox.cjs 只使用已有的本机账号，可能在其自有临时工作区中初始化 ACL，不发送 Host 命令；它使用 Codex 可执行文件作为沙箱客户端（`LIVESHARE_CODEX_EXE`）。这些脚本不属于常规 CI 测试。

```powershell
$env:LIVESHARE_RUN_SANDBOX = '1'
$env:LIVESHARE_CODEX_EXE = '<absolute-path-to-codex.exe>'
node .\extension\test\live-sandbox.cjs
```

Host 测试使用目标 RW 共享 PowerShell，固定根目录／epoch，恢复临时设置时不覆盖用户的并发修改。关闭 Host 权限（`host.enabled`）必须拒绝 Host 工作，绝不退回 Guest。不隐含 stage／commit／push。

读者文档有四种语言版本，链接、命令和限制需保持一致。修改后检查引用和包。不要把机器回执、凭据、Host 原始路径和调查叙述放入公开文档和产物。生成文件和本地文件已被忽略；Windows CI 只检查和构建，不发布。

## Marketplace 发布

`publish-marketplace.yml` 使用 GitHub Actions OIDC 和 `@vscode/vsce` 4.1.0 发布正式版，无需 PAT secret。在 Marketplace 发布者 `Koha9-Lee` 中创建 Trusted Publishing 策略：owner `Koha9`、repository `liveshare-workspace-bridge`、workflow `publish-marketplace.yml`，Environment 留空。参见[官方配置说明](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing)。

发布正式 GitHub Release 会触发此工作流。要发布已创建的版本，在 Actions 中从 `main` 运行 **Publish Marketplace**，并输入已有标签，例如 `v0.3.0`。流程检出该标签、核对包版本、运行测试和打包检查，然后构建、校验并发布 VSIX。只有此任务授予 `id-token: write`。令牌交换失败不会退回 PAT 认证。发布失败时，先检查运行结果和 Marketplace 公开版本再决定是否重试；不要移动已有版本的标签来替换其内容。
