# 使い方

[English](USAGE.md) | [简体中文](USAGE.zh-CN.md) | [繁體中文](USAGE.zh-TW.md) | **日本語**

[ドキュメント](README.ja.md)

## インストール

確認済みの Python 3 実行ファイルでパッケージをビルドします。

```powershell
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py
```

Live Share Guest ウィンドウが使用する Profile に `dist/` 内の VSIX をインストールし、`skills/liveshare-workspace-bridge/` を Codex の skills ディレクトリへコピーします。案内に従って VS Code を再読み込みし、Guest ウィンドウを共有プロジェクトへ接続してください。

## ワークスペースの選択

```powershell
node .\extension\cli.cjs instances
```

`roots[].name` と完全な `roots[].uri` が目的のプロジェクトと一致する項目を選び、`id`、`epoch`、ルート URI を保持します。複数のウィンドウがある場合は明示的に選択し、エディターのフォーカスをウィンドウの識別に使わないでください。

```powershell
node .\extension\cli.cjs --instance '<id>' --epoch '<epoch>' `
    --workspace 'vsls:/' --request '<request.json>'
```

CLI は stdin からの JSON オブジェクトも受け付けます。利用可能なローカルディレクトリから起動してください。`vsls:` URI はローカルファイルシステムのパスではありません。

## 読み取りと編集

必要な行には `read`、複数ファイルには `readMany` を使用します。現在のバッファーの内容とドキュメントの `version` が返るため、後続の編集で再利用できます。

```json
{"op":"edit","files":[{"path":"src/main.ts","expectedVersion":4,"changes":[{"oldText":"return oldValue;","newText":"return newValue;"}]}]}
```

`oldText` は原則として一意に一致する必要があります。すべての一致箇所を置換するときだけ `all:true` を指定します。関連する複数ファイルの変更は、1 回の `edit` にまとめてください。新規テキストファイルには `create`、既存ファイルの全置換にはガード付きの `write` を使用します。

新規ファイルは内容から LF または CRLF を推定し、`eol` で明示することもできます。既存ドキュメントの改行形式は維持されます。作成、コピー、移動では不足する親ディレクトリを既定で作成します。以前の結果で親の存在が分かっている場合は `parents:false` を指定できます。

## 保存結果の確認

`applied`、`saved`、ファイルごとの `dirty` を確認します。正常終了後の再読み取りや Host 側での手動確認は不要です。変更が適用済みでも保存に失敗した場合はバッファーを保持し、返されたバージョンを指定して `save` を再試行します。変更全体を再適用しないでください。

既存の未保存ドキュメントは既定で保護されます。その未保存内容も含めて保存する場合に限り、`allowDirty:true` を指定してください。

## 検索とナビゲーション

`search` は VS Code の Search View を使用してスナップショットを返します。`searchResults` は検索を再実行せず現在のビューを読み取ります。いずれも検索完了を保証しません。`findFiles` は新規ファイルを見落とす場合があるため、正確なパスが分かる場合は検索結果への掲載を前提とせず、そのパスを直接読み取ってください。

言語に対応したナビゲーションには `symbols`、`workspaceSymbols`、`definition` を使用します。結果はプロジェクトで利用できる言語プロバイダーに依存します。

## 接続の管理

サービスは VS Code ウィンドウのライフサイクルに従います。必要に応じてコマンドパレットから `Live Share Workspace Bridge: Restart Connection` または `Live Share Workspace Bridge: Stop Connection` を実行してください。

新しいウィンドウや再読み込みではインスタンス ID が変わり、ワークスペースの変更では epoch が更新されます。`instance_mismatch`、`workspace_changed`、インスタンス利用不可のエラーが出た場合は、再検出してプロジェクトを確認してください。
