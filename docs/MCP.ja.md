# MCP サーバー

[English](MCP.md) | [简体中文](MCP.zh-CN.md) | [繁體中文](MCP.zh-TW.md) | **日本語**

[ドキュメント](README.ja.md)

Live Share Workspace Bridge は Model Context Protocol（MCP）サーバーを同梱しています。agent はこれを Guest マシン上のローカル stdio プロセスとして起動します。サーバーはブリッジのローカル Windows 名前付きパイプを通じて実行中の VS Code 拡張に到達し、ネットワークポートを開きません。

MCP が唯一の agent インターフェースです。stdio サーバーを起動できる MCP クライアントであれば、Claude Code、Codex、VS Code 組み込み agent などから利用できます。

## セットアップ

要件：Windows、Live Share を入れた VS Code 1.101 以降、`PATH` 上の Node.js、Live Share Guest ウィンドウにインストールした拡張。

1. Guest ウィンドウを開き、共有プロジェクトへ接続します。
2. コマンドパレットから **Live Share Workspace Bridge: Copy MCP Server Configuration** を実行します。貼り付け用のスニペットがクリップボードにコピーされ、"Live Share Workspace Bridge" 出力チャネルにも表示されます。
3. 以下のいずれかの方法で agent にサーバーを追加します。

拡張は有効化時に小さなランチャーを `<home>/.liveshare-local/mcp-server.cjs` にインストールします。ランチャーは常に現在実行中の拡張バージョンからサーバーを起動するため、拡張を更新しても agent の構成を変更する必要はありません。コピーされるスニペットには実際のパスが入ります。以下の例ではプレースホルダー `<home>` を使います。

### Claude Code

```text
claude mcp add lswb -- node "<home>/.liveshare-local/mcp-server.cjs"
```

### Codex

`~/.codex/config.toml` に次を追加します。

```toml
[mcp_servers.lswb]
command = "node"
args = ["<home>/.liveshare-local/mcp-server.cjs"]
```

### VS Code 組み込み agent

拡張はサーバーを "Live Share Workspace Bridge" という名前で VS Code に登録するため、組み込み agent は構成なしで検出します。明示的なエントリーを使いたい場合は、`.vscode/mcp.json` またはユーザーの `mcp.json` に次を追加します。

```json
{
  "servers": {
    "lswb": {
      "type": "stdio",
      "command": "node",
      "args": ["<home>/.liveshare-local/mcp-server.cjs"]
    }
  }
}
```

### 最初の呼び出し

agent に `lswb_list_workspaces` を呼び出してもらいます。共有ルートが返されます。他のすべてのツールは、そのルートの正確な `uri`（`vsls:` URI）を `workspace` 引数として受け取ります。

### 検出結果

`lswb_list_workspaces` は `status`、`workspaces`、`probes`、`issues` を返します。`status` は次のいずれかです。

- `ready`：共有ルートが見つかり、すべての記録が応答しました。
- `partial`：共有ルートは見つかりましたが、一部の記録またはプローブが失敗しました。
- `no_shared_workspace`：ブリッジは応答しましたが、共有ルートがありません。
- `no_records`：稼働中のブリッジインスタンスが見つかりません。

検出の失敗（`discovery_access_denied`、`discovery_unavailable`、`discovery_invalid_registry`）はツールエラーとして返されます。

再読み込みまたはクラッシュした VS Code ウィンドウは検出記録を残すことがあります。そのパイプが存在せず、所有プロセスが終了している場合、そのプローブは `status: "stale"` と `ownerProcess: "exited"` で報告されます。これにより検出が `partial` になることはなく、拡張は次回の有効化時にそのような記録を削除します。

## ツール

次の表は v0.3.0 の 36 ツールです。各ツールの完全な契約は、それぞれの MCP description にあります。すべてのツールは引き続きブリッジの権限設定に従います。

- **ファイル変更**：ツールがワークスペースのファイルを変更できるかどうか。
- **Host 経路**：ツールが [Host ツール](#host-ツール) で説明する任意の Host 経路を必要とするかどうか。

| ツール | 目的 | ファイル変更 | Host 経路 |
|---|---|---|---|
| `lswb_list_workspaces` | ローカルブリッジ経由で到達できる Live Share Guest ワークスペースを一覧します。 | なし | 不要 |
| `lswb_status` | ワークスペースのブリッジ状態を報告します：インスタンス識別、epoch、ルート、権限、dirty 文書、MCP サーバー識別。 | なし | 不要 |
| `lswb_list_dir` | 共有ディレクトリのエントリー（名前とファイル種別）を一覧します。 | なし | 不要 |
| `lswb_read_file` | テキスト文書をエディターバッファーから読み取ります。1 始まりで両端を含む行範囲も指定できます。 | なし | 不要 |
| `lswb_read_many` | 1 回のリクエストで最大 50 件のテキスト文書を読み取ります。 | なし | 不要 |
| `lswb_create_file` | 新しいテキストファイルを作成して保存します。ファイルが存在する場合は失敗します。 | あり | 不要 |
| `lswb_write_file` | 既存文書のテキスト全体を置き換えて保存します。 | あり | 不要 |
| `lswb_edit_file` | 最大 100 文書へのテキスト置換を一つのワークスペース編集として適用し、各対象を保存します。 | あり | 不要 |
| `lswb_save_file` | 未保存のエディター変更がある文書を一つ保存します。 | あり | 不要 |
| `lswb_mkdir` | 不足する親を含めてディレクトリを作成します。 | あり | 不要 |
| `lswb_stat` | パスのプロバイダーメタデータ（種別、サイズ、mtime、ctime）を返します。 | なし | 不要 |
| `lswb_move` | ワークスペース内でファイルまたはディレクトリを移動／名前変更します。 | あり | 不要 |
| `lswb_delete` | 単一のファイルまたは空ディレクトリを削除します（ごみ箱なし）。 | あり | 不要 |
| `lswb_diagnostics` | 文書またはルート全体の言語診断を返します。 | なし | 不要 |
| `lswb_document_symbols` | 文書のシンボルアウトラインを返します。 | なし | 不要 |
| `lswb_workspace_symbols` | ワークスペース全体のシンボルを名前で検索します。 | なし | 不要 |
| `lswb_definition` | 指定位置のシンボルの定義位置を探します。 | なし | 不要 |
| `lswb_references` | 指定位置のシンボルの参照位置を探します。 | なし | 不要 |
| `lswb_rename_symbol` | 言語サービスでシンボル名を変更し、変更された各文書を保存します。 | あり | 不要 |
| `lswb_format` | 言語フォーマッターで文書を整形して保存します。 | あり | 不要 |
| `lswb_host_status` | Host 経路が利用可能かつバインド済みかどうかを、適格な共有端末と Host ヘルパーのハンドシェイク状態とともに報告します。 | なし | 状態のみ |
| `lswb_host_bind` | 共有 Host 端末から Host ヘルパーを起動し、ランダムなハンドシェイクファイルで検証します。ヘルパーが待ち受けを始めると `waitingForward` を返します。[Host 経路のバインド](#host-経路のバインド)を参照してください。 | なし（一時ハンドシェイクファイルのみ） | 必要 |
| `lswb_search` | include/exclude glob を使って Host 上の保存済みファイルのテキストを検索します。 | なし | 必要 |
| `lswb_find_files` | glob パターンに一致する保存済み Host ファイルパスを探します。 | なし | 必要 |
| `lswb_host_stat` | パスの Host ディスクメタデータを返します。生バイトの SHA-256 とエディターテキストの状態も返せます。 | なし | 必要 |
| `lswb_copy` | Host 上で単一ファイルをバイト単位でそのままコピーします。 | あり | 必要 |
| `lswb_copy_dir` | Host 上でディレクトリツリーをコピーします。 | あり | 必要 |
| `lswb_read_bytes` | 保存済み Host ファイルを base64 として、サイズと SHA-256 とともに読み取ります。 | なし | 必要 |
| `lswb_write_bytes` | 1 回のリクエストで base64 バイトを Host ファイルに書き込みます（最大 `transfer.chunkBytes`）。 | あり | 必要 |
| `lswb_host_exec` | 上限付きの Host PowerShell 子プロセスでコマンドを開始します。 | あり得る（任意のコマンド） | 必要 |
| `lswb_host_job_poll` | Host ジョブの状態、終了コード、出力をポーリングします。 | なし | 必要 |
| `lswb_host_job_cancel` | 実行中の Host ジョブをキャンセルします。終了するのはブリッジが所有するプロセスツリーだけです。 | なし | 必要 |
| `lswb_host_job_forget` | 終了済みの Host ジョブと保持出力を解放します。 | なし | 必要 |
| `lswb_apply_patch` | Git unified diff 形式のテキストパッチ（1..100 ファイル、最大 1 MiB）を Host で適用します。 | あり | 必要 |
| `lswb_apply_patch_file` | ローカルファイルから読み取った Git unified diff パッチ（最大 1 MiB）を Host で適用します。 | あり | 必要 |
| `lswb_upload_file` | ローカルファイルを分割して Host ワークスペースのパスへアップロードし、SHA-256 で検証します。 | あり | 必要 |

## 結果の意味

成功結果は構造化コンテンツとして返ります。失敗時は `isError` が設定され、`code` と `message` を含みます。

- **適用と保存の区別。** 編集ツールは `applied`（VS Code が文書への編集を受け入れたこと）を、文書ごとの保存結果（`saved`、`dirty`）とは別に報告します。適用済みでも未保存の結果があり得ます。通常の編集は対象だけを保存します。
- **`transport_outcome_unknown`。** リクエストはブリッジに届きましたが、結果が確認できていません。変更がすでに行われた可能性があります。再試行の前に `lswb_read_file`、`lswb_stat`、`lswb_host_stat` などで対象を確認してください。サーバーが変更を自動で再送することはありません。`transport_unavailable` はリクエストが送信されなかったことを意味します。
- **`workspace_changed`**（`workspace_mismatch`、`instance_mismatch`、`epoch_mismatch` も同様）。ワークスペースのバインドが古くなっています。共有セッション、VS Code インスタンス、ブリッジ epoch のいずれかが変わりました。`lswb_list_workspaces` を再度呼び出し、新しいルート `uri` を使ってください。失敗した呼び出しが変更だった場合は、先に対象を確認してください。
- **`not_found`。** ファイルが存在しない場合、`lswb_read_file` は `not_found` で失敗します。`lswb_read_many` ではそのエントリーだけが失敗し、他のファイルは引き続き返されます。
- **検索は設計上不完全です。** Host の検索とファイル検索は保存済みの Host ファイルだけを対象にします。結果に依拠する前に `complete`、`truncated`、`unsavedDocuments` を確認してください。

### Host ツール

Host 経路列に該当するツールは Live Share Host 上で実行され、次のすべてが必要です。

- Host が読み書き可能な Windows PowerShell 端末を共有していること。
- ブリッジ設定で `host.enabled` が有効で、その操作自体の権限も有効であること（非推奨の `terminal.enabled` も 1 版の間は読み取られます）。
- バインド済みの経路：`lswb_host_status` で確認し、`lswb_host_bind` でバインドします。

検索とパッチには Host 上の ripgrep と Git も必要です。共有端末はフォアグラウンドの Host ヘルパーを一度起動するだけで、以降のリクエストは Live Share の転送ポートを通ります。[設定](SETTINGS.ja.md)を参照してください。

#### Host 経路のバインド

Host ユーザーがヘルパーポートを手動で共有する必要があるため、バインドは 2 段階です。

1. `lswb_host_bind` を呼び出します。Host ヘルパーが待ち受けを始めると、`bound: false` と `handshake.state: "waitingForward"`、共有すべき `hostPort`、`next` ヒントを返します。Host の操作は待ちません。
2. Host に **Live Share: Share Server** を実行してそのポートを入力するよう依頼します。その後、`bound: true` が報告されるまで `lswb_host_status` を呼び出します。`lswb_host_status` はハンドシェイク中でも即座に応答します。

ハンドシェイク中は次のとおりです。

- `lswb_host_bind` を再度呼び出しても、同じハンドシェイクを報告するだけです。2 つ目のヘルパーは起動しません。
- 他の Host ツールは `hostPort` とともに `host_handshake_pending` を返し、何も送信しません。ハンドシェイクを待つためにそれらを再試行せず、代わりに `lswb_host_status` をポーリングしてください。
- ハンドシェイクは最大 `host.handshakeTimeoutMinutes` 待機します。通知での Cancel、ワークスペースの変更、ウィンドウを閉じることでも停止します。

ハンドシェイクが失敗またはキャンセルされると、`lswb_host_status` は `handshake.state` に `failed` または `cancelled` を、`handshake.code` と `handshake.message` とともに表示します。再度バインドする前に、前のヘルパーがまだ実行中であれば、共有端末で Ctrl+C を押すよう Host に依頼してください。次の `lswb_host_bind` は新しいヘルパーを起動します。

Guest の IPC ヘルパーはリクエストを一度に一つずつ転送します。そのため `lswb_host_bind` は、接続を数分間保持するのではなく、Host が操作する前に戻ります。

## MCP と CLI

- MCP サーバーが唯一の agent インターフェースです。以前の Codex skill は 0.3.0 で削除されました。
- `cli.cjs` は人が使うトラブルシューティングツールです。`instances`、`diagnose`、固定した raw JSON リクエストを残しています。upload、download、apply-patch コマンドは削除されたため、`lswb_upload_file` と `lswb_apply_patch_file` を使ってください。
- MCP サーバーは内部で `cli.cjs` のローカルトランスポートを再利用します。

どちらも同じローカルパイプで同じ拡張と通信し、同じ権限に従います。

## 既知の制限

- **大容量ファイルのダウンロードは不可。** 大容量ダウンロードは `feature_unavailable` を返します。代わりにアクセス可能なコピーとそのローカルパスをユーザーに依頼してください。小分けのバイト読み取りの反復や raw コマンドで制限を迂回しないでください。小容量のバイト読み取りと大容量アップロードは引き続き利用できます。
- **ローカルパス。** `lswb_upload_file` と `lswb_apply_patch_file` は、MCP サーバーを実行しているマシン上の `localPath` を読み取ります。パスは絶対パスでなければなりません。
- **パイプアクセス。** IPC アクセスモード（既定は所有者のみ）が、どのローカル Windows アカウントがパイプに到達できるか、つまりどのアカウントが MCP サーバーを実行できるかを決めます。[IPC アクセス](IPC-SECURITY.ja.md)を参照してください。
- **再帰削除なし**、複数ファイルのディスクトランザクションもありません。
- **Windows のみ。**
