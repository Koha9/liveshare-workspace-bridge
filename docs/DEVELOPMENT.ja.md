# 開発

[English](DEVELOPMENT.md) | [简体中文](DEVELOPMENT.zh-CN.md) | [繁體中文](DEVELOPMENT.zh-TW.md) | **日本語**

Windows、Node.js、確認済み Python 3 を使用します。実行は組込モジュール、Windows PowerShell、同梱 C#、パッケージは Python 標準ライブラリで、依存インストール不要です。

```text
extension/                         Runtime, CLI and tests
skills/liveshare-workspace-bridge/  Skill and self-contained client
scripts/build.py                   Packaging and source checks
docs/                              Current product/contributor guides
dist/                              Ignored generated packages
.local/                            Ignored local working files
```

extension/cli.cjs が正規クライアントでビルドが skill へ同期します。版、API、翻訳を一致させ、skill 指示／参照は英語のみ管理します。

```powershell
npm test
npm run check
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py
& $pythonExe .\scripts\build.py --check
& $pythonExe .\scripts\build.py --verify
```

通常テストは文書／保存／権限／IPC 契約を検査し、接続プロジェクトを変更しません。ローカル成功は全 Host、アカウント、ポリシー、遠隔、言語サービスの保証ではありません。

VSIX、skill ZIP、SHA-256 を生成します。--check は構成／版／同期、--verify は正確なソースメンバーを照合します。文書 whitelist は過去の受け入れ、issues、.local、私有 memo を除外します。

実テストは明示範囲、所有一意領域、後片付けが必要です。live-v01.cjs は LIVESHARE_RUN_LIVE=1 と検索ビュー変更を伴います。live-sandbox.cjs は既存アカウントだけで一時領域 ACL 初期化を行い得ますが Host コマンドなしです。通常 CI に含めません。

```powershell
$env:LIVESHARE_RUN_SANDBOX = '1'
$env:LIVESHARE_CODEX_EXE = '<absolute-path-to-codex.exe>'
node .\extension\test\live-sandbox.cjs
```

Host テストは対象 RW 端末／root／epoch を固定し、設定復元で同時ユーザー変更を上書きしません。端末無効は Host を拒否し Guest へ代替しません。stage/commit/push を暗黙実行しません。

四言語のリンク／コマンド／上限を一致させ、変更後に参照とパッケージを検査します。機械固有記録、資格情報、Host 生パス、調査経過を公開文書／包へ入れません。生成／ローカルファイルは対象外で、Windows CI は公開しません。
