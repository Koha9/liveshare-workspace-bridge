# Live Share Workspace Bridge

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | **日本語**

接続済みの VS Code Live Share Guest ワークスペースで AI agent が作業できるようにします。agent はローカル MCP サーバーとローカル Windows 名前付きパイプを通じて拡張に到達し、ネットワークポートは開きません。任意の Host 経路は、ヘルパーごとの token を使う Live Share 転送のループバックポートを使います。

## 機能

- 文書／範囲読み取り、バージョン保護付き一括編集、対象だけの保存。
- 任意 Host 経路：保存済みファイル検索、上限付きコマンド、検証付きテキストパッチ、バイト保持コピー、大容量アップロード。
- 言語サービスのシンボル、定義、参照、名前変更、整形。操作／IPC アクセスの設定は英語です。

再帰削除と複数ファイルの原子的保存は未対応です。大容量ダウンロード（`transferOpenRead`/`transferRead`）は `feature_unavailable` を返します。アクセス可能なコピーとローカルパスをユーザーに依頼し、小分けのバイト読み取りの反復や raw コマンドで制限を迂回しません。小容量のバイト読み取りと大容量アップロードは利用できます。

## 前提条件

- Windows、VS Code 1.101 以降、Live Share 拡張。
- agent と VS Code を実行する Windows アカウントの `PATH` に Node.js があること。MCP サーバーは `node` コマンドで起動します。
- この拡張は **Guest** ウィンドウ、つまり Live Share セッションに参加する VS Code ウィンドウにだけ入れます。Host 側には何もインストールしません。
- MCP stdio サーバーに対応する agent（Claude Code、Codex、VS Code 組み込み agent など）。

## 1. インストールと接続

1. Guest の VS Code ウィンドウで、Marketplace から [Live Share Workspace Bridge](https://marketplace.visualstudio.com/items?itemName=Koha9-Lee.liveshare-workspace-bridge) をインストールするか、**Extensions: Install from VSIX...** で VSIX をインストールします。
2. そのウィンドウで Host の Live Share セッションに参加します。

## 2. MCP の設定

コマンドパレットで **Live Share Workspace Bridge: Copy MCP Server Configuration** を実行します。Claude Code、Codex、VS Code 用にそのまま貼り付けられる設定スニペットがクリップボードにコピーされ、"Live Share Workspace Bridge" 出力チャネルにも表示されます。コピーされたスニペットには実際のパスが入ります。以下の例ではユーザープロファイルフォルダーをプレースホルダー `<home>` で表します。

どの設定もランチャー `<home>/.liveshare-local/mcp-server.cjs` を指します。拡張は有効化のたびにこのファイルをインストール・更新します。ランチャーは常に実行中の拡張バージョンの MCP サーバーを起動するため、拡張をアップグレードしても agent の設定を変える必要はありません。

### Claude Code

```text
claude mcp add lswb -- node "<home>/.liveshare-local/mcp-server.cjs"
```

`add` の後に `--scope user` を付けると、すべてのプロジェクトでこのサーバーを使えます。

### Codex

`~/.codex/config.toml` に次を追加します。

```toml
[mcp_servers.lswb]
command = "node"
args = ["<home>/.liveshare-local/mcp-server.cjs"]
```

### VS Code 組み込み agent

設定は不要です。拡張がサーバーを "Live Share Workspace Bridge" という名前で VS Code に登録し、VS Code の MCP サーバー一覧に表示されます。明示的なエントリーを使いたい場合は、代わりに `.vscode/mcp.json` またはユーザーの `mcp.json` に次を追加します。

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

### その他の MCP クライアント

stdio サーバーを起動できるクライアントなら利用できます。command は `node`、引数はランチャーパス `<home>/.liveshare-local/mcp-server.cjs` の 1 つだけです。環境変数は不要です。

サーバーを追加したら、agent を再起動または再読み込みしてサーバーを起動させます。Claude Code は新しいセッションを開始し、Codex は再起動し、VS Code では MCP サーバー一覧からサーバーを起動します。

## 3. 最初の呼び出し

まず agent に `lswb_list_workspaces` を呼び出してもらいます。共有ルートが返され、ほかのすべてのツールは正確なルート `uri`（`vsls:` URI）を `workspace` 引数に取ります。プロンプトの例：

> lswb ツールを使ってください。lswb_list_workspaces を呼び出して共有プロジェクトを選び、その中の README.md を読んでください。

ツールの完全な一覧と結果の意味は [MCP ガイド](../docs/MCP.ja.md)にあります。MCP が唯一の agent インターフェースです。

## 4. 任意：Host 経路

検索、コマンド、パッチ、バイトコピー、アップロードは Host 上で実行されます。使い方：

1. **Guest：** **Live Share Workspace Bridge: Configure Agent Permissions** を実行します。拡張の設定が開くので、**Allow Host Access**（`host.enabled`、既定は無効）をオンにします。個々の操作スイッチは既定でオンです。raw コマンド（`lswb_host_exec`）にはそのすべてが必要です。
2. **Host：** Live Share で Windows PowerShell 端末を読み書き可能として共有します。**Guest：** その共有端末を開きます。共有端末が複数ある場合は `host.terminalName` に正確な名前を設定します。
3. **agent：** `lswb_host_bind` を呼び出します。ブリッジが共有端末に起動コマンドを 1 行入力して Host ヘルパーを起動します。ヘルパーはフォアグラウンドのメモリ上で動作し、何もインストールしません。呼び出しは `handshake.state: "waitingForward"` と `hostPort` を返し、Guest ウィンドウにも同じポートが通知として表示されます。
4. **Host：** **Live Share: Share Server** を実行し、そのポートを入力します。
5. **agent：** `bound: true` になるまで `lswb_host_status` を呼び出します。以降は Host ツールを利用できます。

Host ヘルパーを止めるには、共有端末で Ctrl+C を押します。端末を閉じたとき、セッションが終わったとき、リクエストがないまま `host.idleTimeoutMinutes`（既定 30）分経過したときにも終了します。検索には Host 上の ripgrep（`rg`）、パッチには Git が必要です。[設定](../docs/SETTINGS.ja.md)を参照してください。

## トラブルシューティング早見表

- **`lswb_list_workspaces` で何も見つからない（`no_records`）、またはランチャーが実行中のインスタンスが見つからないと報告する：** Guest ウィンドウが開いていて拡張が有効で、セッションに参加していること、そして agent が VS Code と同じ Windows アカウントで動いていること（IPC アクセスの既定は所有者のみ）を確認します。必要なら Guest ウィンドウを再読み込みします。[トラブルシューティング](../docs/TROUBLESHOOTING.ja.md)と [IPC アクセス](../docs/IPC-SECURITY.ja.md)を参照してください。
- **agent がサーバーを起動できない、または `node` が認識されない：** Node.js をインストールするか `PATH` に追加し、agent と VS Code を再起動します。設定の `node` を `node.exe` のフルパスに置き換えることもできます。
- **Host 経路が `waitingForward` のまま進まない：** Host がまだポートを共有していません。Host で正確な `hostPort` を指定して **Live Share: Share Server** を実行します。Live Share が Guest 上の別のローカルポートに転送した場合は `host.guestPort` を設定します。待機は `host.handshakeTimeoutMinutes` で終了します。[設定](../docs/SETTINGS.ja.md)を参照してください。
- **拡張のアップグレード後：** Guest ウィンドウを再読み込みし、agent を再起動して新しいバージョンのサーバーを起動させます。ランチャーパスは変わらないので設定の変更は不要です。
- **ステータスバーに "LSWB: IPC failed" と表示される：** **Live Share Workspace Bridge: Show Startup Diagnostics** を実行します。[起動診断](../docs/STARTUP-DIAGNOSTICS.ja.md)を参照してください。

## ガイド

[MCP](../docs/MCP.ja.md) | [設定](../docs/SETTINGS.ja.md) | [使用方法](../docs/USAGE.ja.md) | [API](../docs/API.ja.md) | [IPC アクセス](../docs/IPC-SECURITY.ja.md) | [起動診断](../docs/STARTUP-DIAGNOSTICS.ja.md) | [トラブルシューティング](../docs/TROUBLESHOOTING.ja.md) | [開発](../docs/DEVELOPMENT.ja.md) | [変更履歴](../docs/CHANGELOG.ja.md)

[MIT](../LICENSE)
