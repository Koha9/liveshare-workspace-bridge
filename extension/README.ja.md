# Live Share Workspace Tools

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | **日本語**

Windows の名前付きパイプを通じて、Codex または付属の CLI から、接続済みの Live Share Guest ワークスペース内のファイルを読み取り、編集、保存できます。

- HTTP リスナーポート、トークンのコピー、npm ランタイム依存、Host 側の追加インストールは不要です。
- バッファーの読み取り、複数ファイルの編集、対象ドキュメントの保存、ファイル操作、診断、言語機能への問い合わせに対応します。
- 標準の内容検索はスナップショットを返します。ファイル名検索では新規ファイルが見つからない場合があります。

Guest ウィンドウが使用する Profile にインストールし、更新後は VS Code の案内に従って再読み込みしてください。

コマンド：

- `Live Share Workspace Tools: Restart Connection`
- `Live Share Workspace Tools: Stop Connection`

[使い方](../docs/USAGE.ja.md)、[API リファレンス](../docs/API.ja.md)、[トラブルシューティング](../docs/TROUBLESHOOTING.ja.md)を参照してください。

パイプは同じ Windows ユーザーとして実行されるプログラムから利用できます。Host shell や同一ユーザーのプログラム間の隔離は提供しません。

MIT ライセンスです。詳しくは [LICENSE](../LICENSE) を参照してください。
