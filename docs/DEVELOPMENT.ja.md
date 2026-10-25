# 開発ガイド

[English](DEVELOPMENT.md) | [简体中文](DEVELOPMENT.zh-CN.md) | [繁體中文](DEVELOPMENT.zh-TW.md) | **日本語**

[ドキュメント](README.ja.md)

## 必要な環境

Windows、Node.js、確認済みの Python 3 実行ファイルを使用してください。拡張機能は Node の組み込みモジュールと Windows PowerShell、ビルドは Python の標準ライブラリだけを使います。依存パッケージのインストールは不要です。

## ソース構成

```text
extension/                    Extension, CLI, and tests
skills/liveshare-workspace-bridge/    Codex skill and self-contained client
scripts/build.py              Synchronization, packaging, and package checks
docs/                         User and contributor documentation
dist/                         Generated packages and SHA-256 files
.local/                       Local-only working files
```

クライアントの正本は `extension/cli.cjs` です。ビルド時に skill 内のコピーへ同期します。インターフェースを変更する際は、API リファレンスと各翻訳も合わせて更新してください。

## チェックの実行

```powershell
npm test
npm run check

$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py --check
```

テストでは編集の事前確認、保存失敗、未保存バッファーの保護、ワークスペースとの紐付け、IPC 動作、プロセスの終了処理を確認します。通常のテストは接続中の Live Share プロジェクトを変更しません。

## パッケージのビルド

```powershell
& $pythonExe .\scripts\build.py
& $pythonExe .\scripts\build.py --verify
```

`dist/` に VSIX、自己完結型の skill ZIP、SHA-256 ファイルを生成します。`--check` は構成、バージョン、クライアント同期を確認し、ファイルを書き換えません。`--verify` は既存パッケージを現在のソースおよびチェックサムと照合します。パッケージには翻訳済みの利用者向けドキュメントも含まれます。

## 共有ワークスペースでのテスト

`extension/test/live-v01.cjs` は明示的に有効化するテストです。適切な共有ワークスペースに接続し、実行してよい範囲を確認したうえで `LIVESHARE_RUN_LIVE=1` を設定します。一意の名前のディレクトリを作成・削除し、ローカルの記録を `.local/evidence/` に保存します。Search View の検索条件も変更します。通常の CI では実行しないでください。

## ドキュメント

英語ファイルには言語サフィックスを付けず、翻訳には `.zh-CN`、`.zh-TW`、`.ja` を使用します。各ページは対応する翻訳へリンクします。コマンド、項目名、上限、動作の説明を言語間で一致させてください。

## リポジトリ管理

`dist/`、`.local/`、依存フォルダー、ローカル設定は Git の対象外です。アクセストークン、ローカルの記録、マシン固有のパスをコミットしないでください。`.github/workflows/ci.yml` の Windows ワークフローはチェックとビルドを実行し、パッケージは公開しません。

skill の手順と参照資料は英語のみで管理し、skill ディレクトリ内には言語別ファイルを追加しません。
