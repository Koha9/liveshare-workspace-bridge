# 構成

[English](ARCHITECTURE.md) | [简体中文](ARCHITECTURE.zh-CN.md) | [繁體中文](ARCHITECTURE.zh-TW.md) | **日本語**

[ドキュメント](README.ja.md)

- extension.cjs はローカル IPC（既定で所有者のみ）、ライフサイクル、英語の権限ステータスを担当します。
- registry-cleanup.cjs は有効化時に実行され、終了したウィンドウが残した検出記録（ファイル名、id、pid、パイプ名が一致するもの）を削除します。リンクやその他のファイルには触れません。cli.cjs の検出はそのような記録を `stale` プローブとして報告します。
- permissions.cjs はリクエスト認可層で、ディスパッチ前と Host 送信前に現在の User/machine 設定を読み取ります。agent のエンドポイントは権限を変更できません。
- workspace.cjs は文書バージョン、dirty バッファーの確認、テキスト事前検証、言語編集、対象保存を担当します。Host の変更後は、正規化内容が一致するまで影響するモデルの保護を維持します。
- host-channel.cjs は Host リクエストを直列化し、共有端末を通じて Host ヘルパーを一度起動し（ランダムな bootstrap ファイルで検証）、転送ポートをバックグラウンドで待ち、各リクエストをヘルパーごとの token と nonce を付けてループバック TCP（host-transport-tcp.cjs）で送信します。host-terminal.cjs は共有 RW 端末を選び、host-bootstrap.cjs はヘルパーを生成してその待ち受けバナーを読み取ります。リクエストを端末に入力することはありません。
- host-operations.cjs は公開 API を個別の Host アクションに変換し、ジョブ／転送を root と epoch に結び付けます。
- host-server.ps1 はフォアグラウンドのメモリ上 Host ヘルパーで、host-core.ps1（Host アクション）を埋め込みます。host-runtime.cs は所有する Windows Job Object、上限付きストリーム排出、分割バイトハンドル、SHA-256、期限を提供します。常駐 Host agent はインストールしません。ヘルパーはループバックだけで待ち受け、Ctrl+C、端末を閉じること、セッション終了、アイドルタイムアウトで終了します。
- mcp-server.cjs は stdio MCP プロトコル層（initialize、tools/list、tools/call）です。stdout にはプロトコルフレームだけを書き込みます。
- mcp-tools.cjs は MCP ツール表を定義します。cli.cjs のトランスポートを通じて Guest、Host、ローカルファイルのツールをブリッジ操作に対応付け、ルート uri から instance/epoch へのバインドを保持します。結果不明のトランスポート結果は報告し、再送しません。
- mcp-launcher.cjs は自己完結型のランチャーで、拡張が `~/.liveshare-local/mcp-server.cjs` にインストールします（mcp-launcher-install.cjs 経由。これは Copy MCP Server Configuration のスニペットも生成します）。稼働中の検出記録から mcp-server.cjs を起動するため（最新のサーバーファイルを優先し、次に最新の記録）、agent の構成は更新後も維持されます。
- mcp-definition-provider.cjs は mcp-server.cjs を VS Code に登録し（`vscode.lm.registerMcpServerDefinitionProvider`）、組み込み agent が検出できるようにします。
- cli.cjs は人が使うトラブルシューティング CLI（instances、diagnose、固定した raw JSON リクエスト）であり、mcp-tools.cjs が検出、リクエスト、分割アップロードに使うローカルトランスポートライブラリです。agent が直接呼び出すことはありません。

テキスト編集の既定は引き続き文書経路で、保存のたびにプロバイダーを再読み取りしません。任意の Host 経路は保存済みファイルの完全検索、コマンド、パッチ、バイト／ディレクトリ操作を担当します。raw Host 実行には全操作権限が必要で、個別アクションは引き続き個別に制御できます。これらの確認は任意スクリプトに対する OS サンドボックスではありません。

送信済み作業は権限の取り消しでロールバックされません。子タスクは上限付きのタイムアウトを保持します。同期ファイルシステム操作は Guest 応答のタイムアウト後も完了する場合があります。結果不明のものは再試行しません。転送にはアイドル期限と所有する一時ステージングがあり、ディレクトリコピーは途中で失敗することがあります。再帰削除や複数ファイルのディスクトランザクションは提供しません。

`pipe-security.cs` / `pipe-host.ps1`：明示的な owner／sandbox DACL、ローカル／セッションの照合、持続する単一インスタンスのパイプ、上限付き UTF-8 入力と応答の排出。

`local-accounts.cs` はローカル SAM ユーザーだけを列挙して安定した SID を選び、`ipc-access.cjs` は User 限定のモード解決、旧 SID の一度限りの移行、英語のアカウント選択画面を担当します。

大容量ダウンロード（`transferOpenRead`/`transferRead`）は `feature_unavailable` を返します。アクセス可能なコピーとローカルパスをユーザーに依頼し、小分けのバイト読み取りの反復や raw コマンドで制限を迂回しません。小容量のバイト読み取りと大容量アップロードは利用できます。
