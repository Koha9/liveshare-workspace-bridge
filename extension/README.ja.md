# Live Share Workspace Bridge

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | **日本語**

接続済みの VS Code Live Share Guest ワークスペースで AI agent が作業できるようにします。agent はローカル MCP サーバーとローカル Windows 名前付きパイプを通じて拡張に到達し、ネットワークポートは開きません。任意の Host 経路は、ヘルパーごとの token を使う Live Share 転送のループバックポートを使います。

- 文書／範囲読み取り、バージョン保護付き一括編集、対象だけの保存。
- 任意 Host 経路：保存済みファイル検索、上限付きコマンド、検証付きテキストパッチ、バイト保持コピー、大容量アップロード。
- 言語サービスのシンボル、定義、参照、名前変更、整形。操作／IPC アクセスの設定は英語です。

再帰削除と複数ファイルの原子的保存は未対応です。大容量ダウンロード（`transferOpenRead`/`transferRead`）は `feature_unavailable` を返します。アクセス可能なコピーとローカルパスをユーザーに依頼し、小分けのバイト読み取りの反復や raw コマンドで制限を迂回しません。小容量のバイト読み取りと大容量アップロードは利用できます。

[MCP](../docs/MCP.ja.md) | [使用方法](../docs/USAGE.ja.md) | [API](../docs/API.ja.md) | [IPC アクセス](../docs/IPC-SECURITY.ja.md) | [起動診断](../docs/STARTUP-DIAGNOSTICS.ja.md) | [開発](../docs/DEVELOPMENT.ja.md) | [変更履歴](../docs/CHANGELOG.ja.md)

## 使い始める

Windows、Live Share を入れた VS Code 1.101 以降、Node.js が必要です。MCP stdio サーバーに対応する agent であれば、Claude Code、Codex、VS Code 組み込み agent などからブリッジを利用できます。

1. Live Share Guest ウィンドウに[拡張](https://marketplace.visualstudio.com/items?itemName=Koha9-Lee.liveshare-workspace-bridge)を入れ、共有プロジェクトへ接続します。
2. **Live Share Workspace Bridge: Copy MCP Server Configuration** を実行し、コピーされたエントリーを agent に追加します。VS Code 組み込み agent はサーバーを自動で検出します。
3. agent に `lswb_list_workspaces` を呼び出してもらい、作業を始めます。

agent ごとのセットアップ、ツール一覧、結果の意味は [MCP ガイド](../docs/MCP.ja.md)にあります。MCP が唯一の agent インターフェースです。

Host 機能には、接続済みの共有 RW Windows PowerShell、Host アクセス（`host.enabled`、既定は無効）、該当する権限が必要で、検索／パッチには Host の ripgrep／Git も必要です。共有端末は Host ヘルパーを一度起動し、その後 Host がブリッジに表示されたポートに対して "Live Share: Share Server" を一度実行します。[設定](../docs/SETTINGS.ja.md)を参照してください。
