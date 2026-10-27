# Live Share Workspace Bridge

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | **日本語**

ローカル Windows IPC で接続済み VS Code Live Share Guest を操作します。HTTP ポートや token コピーは不要です。

## 機能

- 文書／範囲読み取り、バージョン保護付き一括編集、対象だけの保存。
- 任意 Host 経路：保存済み検索、上限付きコマンド、検証付きテキストパッチ、バイト保持コピー、大容量アップロード。
- 言語サービスのシンボル、定義、参照、名前変更、整形。操作／IPC 設定は英語です。

再帰削除と複数ファイルの原子的保存は未対応です。 大容量ダウンロード（`transferOpenRead/transferRead`、CLI download を含む）は `feature_unavailable` です。アクセス可能なコピーとローカルパスを依頼し、小分け読み取り反復や raw コマンドで迂回しません。小容量読み取りと大容量アップロードは利用できます。

## 使い始める

Windows、VS Code Live Share、Node.js が必要です。

1. Live Share Guest ウィンドウに[拡張](https://marketplace.visualstudio.com/items?itemName=Koha9-Lee.liveshare-workspace-bridge)を入れ、共有プロジェクトへ接続します。
2. agent に [Releases](https://github.com/Koha9/liveshare-workspace-bridge/releases) から拡張と同じ版の skill をインストールしてもらいます。
3. agent に `$liveshare-workspace-bridge` で作業を始めてもらいます。

Host 機能は接続済み共有 RW Windows PowerShell と権限が必要で、検索／パッチには Host ripgrep／Git も必要です。端末アクセスは既定無効です。[設定](docs/SETTINGS.ja.md)を参照してください。

## ガイド

[設定](docs/SETTINGS.ja.md) | [使用方法](docs/USAGE.ja.md) | [API](docs/API.ja.md) | [IPC アクセス](docs/IPC-SECURITY.ja.md) | [起動診断](docs/STARTUP-DIAGNOSTICS.ja.md) | [開発](docs/DEVELOPMENT.ja.md) | [変更履歴](docs/CHANGELOG.ja.md)

[MIT](LICENSE)
