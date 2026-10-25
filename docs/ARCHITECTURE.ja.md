# アーキテクチャ

[English](ARCHITECTURE.md) | [简体中文](ARCHITECTURE.zh-CN.md) | [繁體中文](ARCHITECTURE.zh-TW.md) | **日本語**

[ドキュメント](README.ja.md)

## リクエストの流れ

```text
Codex skill or CLI
    → current-user Windows named pipe
    → PowerShell transport process
    → VS Code extension APIs
    → Live Share file provider
```

## コンポーネント

| コンポーネント | 役割 |
|---|---|
| `extension/extension.cjs` | 有効化、通信のライフサイクル、インスタンス検出、ワークスペース epoch |
| `extension/pipe-host.ps1` | 現在のユーザー向けパイプ権限と JSON フレームの転送 |
| `extension/workspace.cjs` | 固定のファイル、ドキュメント、検索、言語操作 |
| `extension/core.cjs` | パス検査、内容のガード、改行処理、編集計画 |
| `extension/cli.cjs` | 検出、リクエスト送信、CLI の終了状態 |
| `skills/liveshare-workspace-bridge/` | Codex 向けの手順と自己完結型クライアント |

## ワークスペースとの紐付け

VS Code ウィンドウごとにインスタンス ID があり、ワークスペースの変更で epoch が更新されます。リクエストはインスタンスと epoch を正確なルート URI に紐付けるため、同じ `vsls:/` を使う別プロジェクトへ古い選択が意図せず移ることを防ぎます。

検出レコードは `~/.liveshare-local/instances/` にあり、接続メタデータを保持します。アクセストークンではありません。パイプの補助プロセスはコンソールを表示せずに起動し、所有プロセスとともに終了します。

## ドキュメント操作

共有 URI は `vsls:` scheme を保持します。読み取りには現在のエディターバッファーを使用します。複数のテキスト編集をまとめて事前確認し、1 つの WorkspaceEdit として適用してから個別に保存します。複数ファイルの保存は不可分なディスクトランザクションではありません。

通常の操作はドキュメントのバージョンと保存結果を再利用します。プロバイダーの再読み取りやテキストハッシュは明示的な操作であり、自動の確認手順ではありません。送信後の通信失敗は結果不明として扱い、自動で再送しません。

## アクセス境界

Windows PowerShell は現在のユーザーに限定したパイプ ACL を使用し、PowerShell 7 では `CurrentUserOnly` を使用できます。公開するのは固定の操作であり、任意の shell や VS Code コマンドは実行しません。同じ Windows ユーザーとして動作する他のプログラムも、このインターフェースにアクセスできます。

Node のファイルシステム API はローカルのリクエストファイルと検出レコードだけを扱います。仮想リソースは VS Code と Live Share により解決されます。Host の実行環境は提供しません。
