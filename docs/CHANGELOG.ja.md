# 変更履歴

[English](CHANGELOG.md) | [简体中文](CHANGELOG.zh-CN.md) | [繁體中文](CHANGELOG.zh-TW.md) | **日本語**

- 0.3.0
  - アップグレード時の注意：`terminal.*` 設定は `host.*` になりました。新しいキーが未設定の間は旧 User 値を 1 版の間読み取り続けますが、何も書き換えないため、名前は自分で変更してください。保存済みの `allLocalUsers` IPC モードは、通知を一度表示して ownerOnly として動作します。Codex skill はなくなりました。**Copy MCP Server Configuration** で MCP サーバーを agent に追加してください。Host 機能では、ブリッジに表示されたヘルパーポートに対して Host が "Live Share: Share Server" を一度実行する必要があります。VS Code 1.101 以降が必要です。
  - 追加：36 個の `lswb_` ツールを持つ MCP stdio サーバーを VSIX に同梱（`mcp-server.cjs`、`mcp-tools.cjs`）。実行中の拡張バージョンに追従する `~/.liveshare-local/mcp-server.cjs` の安定ランチャーと、**Copy MCP Server Configuration** コマンド。コピーされる構成はスラッシュ区切りのパスを使います。パッケージ化されたモジュールがパッケージに含まれないファイルを require するとビルドが失敗します。新しい [MCP ガイド](MCP.ja.md)。
  - 追加：拡張は `vscode.lm.registerMcpServerDefinitionProvider` で MCP サーバーを VS Code に登録し、組み込み agent が検出できるようにしました。
  - 追加：Live Share 転送ポート上の Host 経路。共有端末がフォアグラウンドのメモリ上 Host ヘルパーを一度起動し、リクエストはヘルパーごとの token を使って転送ループバックポートを通ります。新しい設定 `host.guestPort`、`host.idleTimeoutMinutes`、`host.handshakeTimeoutMinutes`。新しいエラーコード `host_transport_unavailable`、`host_request_too_large`、`host_bind_cancelled`、`host_port_forward_required`、`host_port_unavailable`。
  - 追加：`hostBind` は Host ヘルパーが待ち受けを始めるとすぐに `waitingForward`（`hostPort` と `next` 付き）を返し、転送ポートのハンドシェイクはバックグラウンドで完了します。`hostStatus` は `info` と同様にディスパッチキューを迂回し、`handshake.state` と `handshake.code` を報告します。ハンドシェイクが完了するまで、他の Host リクエストは新しい `host_handshake_pending` を返します。
  - 追加：有効化時に、終了したウィンドウが残した検出記録（名前、id、pid、パイプ名が一致するもの。リンクやその他のファイルには触れません）を削除します。
  - 追加：info と lswb_status が ipc.requestedMode と ipc.deprecatedModeIgnored を報告します。
  - 変更：VS Code の最小バージョンは 1.101 です。
  - 変更：有効化イベントを `*` から `onFileSystem:vsls` と `onStartupFinished` に限定しました。
  - 変更：`terminal.*` 設定の名前を `host.enabled`、`host.terminalName`、`host.workspacePath`、`host.commandTimeoutMs`、`host.maxOutputCharacters` に変更しました。新しいキーが未設定の間は旧 User 値を 1 版の間読み取り続け、設定を書き換えることはありません。エラーコード `terminal_access_disabled` は `host_access_disabled` になり、info.permissions は `terminalEnabled` の代わりに `hostEnabled` を報告します。
  - 削除：共有端末によるデータ転送。共有 Host 端末は Host ヘルパーを一度起動するだけで、すべての Host リクエストは Live Share 転送ポートを使います。`host.transport` 設定は削除されました。保存済みの `sharedTerminal` 値は、出力チャネルに一行を記録して portForward として動作します。
  - 削除：Codex skill。agent は MCP サーバーを通じて接続します。CLI はトラブルシューティング用に instances/diagnose/raw リクエストを残しています。
  - 削除：allLocalUsers IPC アクセスモード。残るのは ownerOnly と selectedUsers だけです。保存済みの allLocalUsers 値は ownerOnly として動作し、ウィンドウセッションごとに一度通知を表示し、書き換えられません。[IPC アクセス](IPC-SECURITY.ja.md)を参照してください。
  - 修正：read と readMany は、存在しないファイルを汎用の `vscode_error` ではなく `not_found` として報告します。readMany ではそのエントリーだけが失敗し、他のファイルは引き続き返されます。
  - 修正：再読み込みまたはクラッシュしたウィンドウが残した検出記録により、検出が `partial` になることはなくなりました。所有プロセスが終了したパイプの欠落は `ownerProcess: "exited"` 付きの `stale` プローブとして報告されます（CLI の検出では `staleRecordCount` にも数えます）。そのような記録しか残っていない場合、状態は `no_records` です。

- 0.2.4 — broken pipe 後処理、回数制限付き自動再接続、Host 結果不明状態の保持、並列検出と agent 再起動手順。

- 0.2.3 — ローカル起動要約、安全な shell 情報、現在と履歴の区別。

- 0.2.2 — 所有者／ローカル／選択 SID と旧設定移行。

- 0.2.1 — 明示的な検出エラーと IPC フレーム。

- 0.2 — 任意 Host 検索、ジョブ、パッチ、バイト、アップロード。
