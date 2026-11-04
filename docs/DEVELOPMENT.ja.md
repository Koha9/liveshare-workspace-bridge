# 開発

[English](DEVELOPMENT.md) | [简体中文](DEVELOPMENT.zh-CN.md) | [繁體中文](DEVELOPMENT.zh-TW.md) | **日本語**

Windows、Node.js、確認済みの Python 3 が必要です。実行時は組み込みモジュール、Windows PowerShell、同梱の C# ソースを使い、npm 依存はありません。パッケージ作成は Python 標準ライブラリだけを使います。テストは `extension/package.json` で宣言された devDependencies（MCP SDK 相互運用テスト）を使います。`npm test` の前に `extension/` 内で `npm ci` を一度実行してください。

```text
extension/                         Runtime, CLI and tests
scripts/build.py                   Packaging and source checks
docs/                              Current product/contributor guides
dist/                              Ignored generated packages
.local/                            Ignored local working files
```

MCP サーバー（extension/mcp-server.cjs と mcp-tools.cjs）が唯一の agent インターフェースです。extension/cli.cjs はトラブルシューティング CLI であり、MCP サーバーが使うローカルトランスポートライブラリです。mcp-tools.cjs が依存するエクスポートは維持してください。バージョン、API フィールド、翻訳を一致させます。

```powershell
npm test
npm run check
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py
& $pythonExe .\scripts\build.py --check
& $pythonExe .\scripts\build.py --verify
```

リポジトリ直下のパッケージ作成用の入口は、Windows では `./build.ps1` または `build.bat`、Unix／Git Bash では `sh ./build.sh` です。引数なしの場合は `dist/` に VSIX とその SHA-256 ファイルを作成して検証します。`--check`、`--verify`、`--help` は `scripts/build.py` に渡されます。必要に応じて `LSWB_PYTHON` に Python 3 実行ファイルの完全なパスを設定します。Windows は有効な Conda、ユーザーの Anaconda、Python Launcher を検出し、Unix は有効な Conda または Python 3 を使います。これらの入口は別のカレントディレクトリからも動作します。

通常テストは文書／保存／権限／IPC の契約を、接続中のプロジェクトを変更せずに検査します。ローカルのテストが通っても、すべての Host、アカウント、ポリシー、リモートセッション、言語プロバイダーで動作する証拠にはなりません。

ビルドは VSIX とその SHA-256 ファイルを作成します。--check は構成とバージョンを検証し、--verify は現在のパッケージを正確なソースメンバーと照合します。明示的な文書 whitelist は、過去の受け入れ文書、issues、.local、私的なメモを除外します。

実環境テストには明示的な範囲、所有する一意のフィクスチャー、後片付けが必要です。extension/test/live-v01.cjs は LIVESHARE_RUN_LIVE=1 が必要で、検索ビューを変更します。live-sandbox.cjs は既存のローカルアカウントを使い、所有する一時ワークスペースで ACL を初期化することがありますが、Host コマンドは送信しません。サンドボックス化されたクライアントとして Codex の実行ファイル（`LIVESHARE_CODEX_EXE`）を使います。これらのスクリプトは通常の CI テストではありません。

```powershell
$env:LIVESHARE_RUN_SANDBOX = '1'
$env:LIVESHARE_CODEX_EXE = '<absolute-path-to-codex.exe>'
node .\extension\test\live-sandbox.cjs
```

Host テストでは対象の RW 共有 PowerShell を使い、root/epoch を固定し、同時に行われたユーザーの編集を上書きせずに一時的に変更した設定を復元します。Host アクセス（`host.enabled`）が無効なら Host 作業を拒否し、Guest へ代替してはいけません。stage/commit/push を暗黙に行いません。

読者向け文書は四つのロケール版があり、リンク／コマンド／上限を一致させます。編集後は参照とパッケージを確認します。機械固有の記録、資格情報、Host の生パス、調査の経緯は公開文書や成果物に含めません。生成ファイル／ローカルファイルは無視され、Windows CI は公開せずに確認とビルドを行います。

## Marketplace 公開

`publish-marketplace.yml` は GitHub Actions OIDC と `@vscode/vsce` 4.1.0 で安定版を公開し、PAT secret は不要です。Marketplace 発行者 `Koha9-Lee` で、owner `Koha9`、repository `liveshare-workspace-bridge`、workflow `publish-marketplace.yml`、Environment 空欄の Trusted Publishing ポリシーを作成します。[公式設定手順](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing)を参照してください。

安定版の GitHub Release を公開するとワークフローが起動します。作成済みのリリースを公開するには、Actions タブから `main` で **Publish Marketplace** を実行し、既存のタグ（例 `v0.3.0`）を入力します。そのタグをチェックアウトし、パッケージのバージョンを確認し、テストとパッケージ検査を実行してから、VSIX をビルド・検証して公開します。`id-token: write` を持つのはこのジョブだけです。トークン交換に失敗しても PAT 認証に切り替えません。失敗した公開を再試行する前に、実行結果と Marketplace の公開バージョンを確認してください。既存バージョンのタグを変更して内容を置き換えてはいけません。
