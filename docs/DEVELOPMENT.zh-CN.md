# 开发指南

[English](DEVELOPMENT.md) | **简体中文** | [繁體中文](DEVELOPMENT.zh-TW.md) | [日本語](DEVELOPMENT.ja.md)

[文档](README.zh-CN.md)

## 环境要求

使用 Windows、Node.js 和已确认的 Python 3 可执行文件。扩展仅使用 Node 内置模块和 Windows PowerShell，构建仅使用 Python 标准库，不需要安装依赖。

## 源码结构

```text
extension/                    Extension, CLI, and tests
skills/liveshare-workspace-bridge/    Codex skill and self-contained client
scripts/build.py              Synchronization, packaging, and package checks
docs/                         User and contributor documentation
dist/                         Generated packages and SHA-256 files
.local/                       Local-only working files
```

`extension/cli.cjs` 是客户端的唯一维护源码，构建时同步到 skill。接口变化时，应同步 API 参考及各语言译本。

## 执行检查

```powershell
npm test
npm run check

$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py --check
```

测试覆盖编辑预检、保存失败、未保存缓冲区保护、工作区绑定、IPC 行为和进程清理。普通测试不修改已连接的 Live Share 项目。

## 构建安装包

```powershell
& $pythonExe .\scripts\build.py
& $pythonExe .\scripts\build.py --verify
```

构建在 `dist/` 中生成 VSIX、独立 skill ZIP 和 SHA-256 文件。`--check` 只检查目录、版本和客户端同步，不写入文件；`--verify` 比较已有安装包与当前源码及校验值。安装包包含多语言使用文档。

## 共享工作区测试

`extension/test/live-v01.cjs` 需要显式启用。在已连接且允许测试的工作区中，设置 `LIVESHARE_RUN_LIVE=1` 后再运行。它创建并清理唯一命名目录，将本机回执写入 `.local/evidence/`，并会改变 Search View 查询。不要将它加入普通 CI。

## 文档

英语文件不带语言后缀，译本使用 `.zh-CN`、`.zh-TW` 和 `.ja`。各页面互相链接，命令、字段、限制和行为说明应保持一致。

## 仓库维护

`dist/`、`.local/`、依赖目录和本机配置由 Git 忽略。不要提交访问令牌、本机回执或机器专用路径。`.github/workflows/ci.yml` 中的 Windows 工作流运行检查和构建，不发布安装包。

skill 的操作指令和参考资料仅维护英语，不在 skill 目录中添加多语言副本。
