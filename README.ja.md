# Live Share Workspace Bridge

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | **日本語**

Windows 上のローカルブリッジを通じて、Codex から VS Code Live Share ワークスペースのファイルを読み取り、複数のドキュメントを編集して保存できます。

## 機能

- ディレクトリ、指定行、複数ファイル、未保存のエディターバッファーの読み取り。
- 文字列の置換、行単位の編集、複数ドキュメントへの変更。
- 変更対象のドキュメントだけを保存し、ファイルごとの結果を返却。
- ファイルやディレクトリの作成、ファイルのコピー、移動・名前変更、ファイルや空ディレクトリの削除。
- 診断、ドキュメントシンボル、ワークスペースシンボル、定義位置の取得。
- VS Code 標準の検索ビューとファイル名検索の利用。
- 現在の Windows ユーザーだけがアクセスできる名前付きパイプでの接続。

## 必要な環境

- Windows、VS Code、Live Share。
- 共有プロジェクトに接続した Live Share Guest ウィンドウ。
- CLI と Codex skill を実行する Node.js。
- パッケージをビルドする Python 3。ビルドは標準ライブラリのみを使用します。

拡張機能は Windows 標準の Windows PowerShell を使用します。npm の依存パッケージや Host 側の追加インストールは不要です。

## クイックスタート

### 拡張機能のビルドとインストール

```powershell
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py

$vsix = Get-ChildItem .\dist\liveshare-workspace-bridge-*.vsix |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
code --install-extension $vsix.FullName
```

Guest ウィンドウが使用する VS Code Profile にインストールしてください。必要に応じて `--profile '<profile-name>'` を追加します。インストールや更新後は VS Code の案内に従ってウィンドウを再読み込みし、必要なら Live Share に再接続します。

### Codex skill の追加

`skills/liveshare-workspace-bridge/` を Codex の skills ディレクトリ（例：`$env:USERPROFILE\.codex\skills\liveshare-workspace-bridge`）へコピーします。同名ディレクトリがある場合は、置き換える前にローカルの変更を確認してください。`dist/` の ZIP にも同じ自己完結型の skill が含まれます。

Codex で `$liveshare-workspace-bridge` を呼び出し、共有プロジェクトで行いたい作業を伝えてください。

### CLI の利用

```powershell
node .\extension\cli.cjs instances

node .\extension\cli.cjs --instance '<id>' --epoch '<epoch>' `
    --workspace 'vsls:/' --request '<request.json>'
```

`request.json` の例：

```json
{"op":"read","path":"README.md","startLine":1,"endLine":20}
```

最初に対象ウィンドウを選び、インスタンス ID、epoch、ルート URI を以後のリクエストで再利用します。共有ファイルのパスは、そのルートからの相対パスです。[使い方](docs/USAGE.ja.md)と [API リファレンス](docs/API.ja.md)を参照してください。

## 仕組み

```text
Codex skill / CLI → current-user Windows named pipe
                 → VS Code APIs → Live Share → shared files
```

ブリッジは `vsls:` URI を維持し、現在のドキュメントバッファーを操作します。複数ファイルの変更をまとめて事前確認し、1 つの WorkspaceEdit で適用した後、ドキュメントごとに保存します。正常に保存できた場合、プロバイダーからの再読み取りや全文ハッシュ計算は自動で行いません。

## 制限事項

- 内容検索は現在の Search View のスナップショットを返し、完了通知はありません。ファイル名検索では、新規ファイルが見つからない場合があります。
- 複数ファイルの保存は、ファイル間で不可分なディスクトランザクションではありません。保存に失敗した場合は、各ファイルの結果を確認してください。
- Host shell、リモートでのビルドや Git 実行、再帰的な削除、ディレクトリのコピー、バイナリ書き込み、汎用 unified diff の解析は提供しません。
- 名前付きパイプは同一 Windows ユーザーの権限内で動く自動化インターフェースです。そのユーザーとして実行される別のプログラムを隔離するものではありません。

## ドキュメント

[ドキュメント一覧](docs/README.ja.md)に、セットアップ、API、アーキテクチャ、開発、トラブルシューティングのガイドがあります。

## 開発

```powershell
npm test
npm run check
& $pythonExe .\scripts\build.py --check
& $pythonExe .\scripts\build.py --verify
```

ビルド成果物は `dist/` に出力されます。ソース構成とパッケージ作成の手順は[開発ガイド](docs/DEVELOPMENT.ja.md)を参照してください。

## ライセンス

MIT ライセンスです。詳しくは [LICENSE](LICENSE) を参照してください。
