# 開発 v0.2

[English](DEVELOPMENT.md) | [简体中文](DEVELOPMENT.zh-CN.md) | [繁體中文](DEVELOPMENT.zh-TW.md) | **日本語**

v0.2.2：**Configure IPC Access** は ownerOnly（既定）、allLocalUsers、安定 SID の selectedUsers を提供します。旧 true は既存の選択アカウントだけへ移行し、全員を自動許可しません。[IPC モード](IPC-SECURITY.ja.md)を参照してください。Host 権限は独立です。

[ドキュメント](README.ja.md)

## 要件

Windows、Node.js、確認済み Python 3 を使用します。拡張は Node 組み込みモジュールと Windows PowerShell を使い、Host のメモリ内ランタイムは PowerShell が C# をコンパイルします。パッケージ生成は Python 標準ライブラリのみで、npm 依存関係のインストールは不要です。

## ソース構成

```text
extension/                    Extension, CLI, and tests
skills/liveshare-workspace-bridge/    Codex skill and self-contained client
scripts/build.py              Synchronization, packaging, and package checks
docs/                         User and contributor documentation
dist/                         Generated packages and SHA-256 files
.local/                       Local-only working files
```

`extension/cli.cjs` が唯一の正規クライアントで、ビルドが skill へ同期します。インターフェース変更は API と全翻訳へ反映します。skill の指示と参照は英語のみで管理し、skill 内に言語別ファイルを追加しません。

## チェックとビルド

```powershell
npm test
npm run check

$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py --check
```

テストは編集の事前検証、部分保存失敗、dirty 保護、即時権限依存、パッチパス、古いモデルの保護、実 Windows IPC、Host バイト基本処理、上限付き出力、キャンセル、プロセス終了を確認します。通常テストは接続済み Live Share プロジェクトを変更しません。

```powershell
& $pythonExe .\scripts\build.py
& $pythonExe .\scripts\build.py --verify
```

`dist/` に VSIX、自己完結型 skill ZIP、SHA-256 ファイルを生成します。`--check` は構成、バージョン、クライアント同期を読み取り専用で確認します。`--verify` は既存パッケージのメンバー、ソース、チェックサムを照合します。パッケージには翻訳済み利用文書と検証記録を含めます。

## 実 Live Share 検証

`extension/test/live-v01.cjs` は明示的に有効にする旧版統合テストです。許可された接続と隔離範囲でのみ `LIVESHARE_RUN_LIVE=1` を設定します。一意なディレクトリを作成／削除し、ローカル記録を `.local/evidence/` に保存し、検索ビューのクエリも変更します。通常テストや CI に入れません。

v0.2 Host 検証には専用 RW 共有 PowerShell と所有する一意なテストディレクトリを使います。テスト設定は元値を記録して復元し、同時に行われたユーザー変更を上書きしません。端末権限無効時は全 Host 操作を拒否し、Guest 端末へフォールバックしません。テストで stage/commit/push は行いません。37 件のローカル成功は実ダウンロード成功を意味しません。[検証記録](VALIDATION-v0.2.ja.md)で項目別の証拠と未完了の受け入れ条件を確認してください。

## 文書とリポジトリ管理

英語は言語接尾辞なし、翻訳は `.zh-CN/.zh-TW/.ja` で対応ページを相互リンクします。コマンド、API 識別子、数値上限、既定権限、失敗条件を一致させます。実際の設定名と API 名は翻訳しません。文書変更後にリンクとコード例を検証し、パッケージを再ビルドします。

`dist/`、`.local/`、依存関係、ローカル設定は Git 対象外です。token、ローカル受領記録、ユーザーディレクトリ、Host の生パスをコミットしません。`.github/workflows/ci.yml` は Windows 上で検査／ビルドし、公開はしません。検証文書には共有可能な結果だけを記載します。

明示実行のローカル sandbox IPC 検証（既存アカウント、所有一時領域の初期化、Host コマンドなし）：

```powershell
$env:LIVESHARE_RUN_SANDBOX = '1'
$env:LIVESHARE_CODEX_EXE = '<absolute-path-to-codex.exe>'
node .\extension\test\live-sandbox.cjs
```
