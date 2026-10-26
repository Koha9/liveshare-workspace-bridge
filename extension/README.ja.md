# Live Share Workspace Bridge v0.2

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | **日本語**

v0.2.2：**Configure IPC Access** は ownerOnly（既定）、allLocalUsers、安定 SID の selectedUsers を提供します。旧 true は既存の選択アカウントだけへ移行し、全員を自動許可しません。[IPC モード](../docs/IPC-SECURITY.ja.md)を参照してください。Host 権限は独立です。

既定で現在ユーザー専用の Windows IPC で共有文書を読み取り、編集、保存します。任意の検証済み Host RW PowerShell は保存済みファイル検索、上限付きコマンド、検証済みテキストパッチ、バイト保持コピー、分割アップロードを追加します。HTTP ポートや token コピーは不要です。

**Live Share Workspace Bridge: Configure Agent Permissions** を開きます。英語の User 設定に agent 全体、操作別、連動する端末スイッチ（既定無効）があります。状態表示の Host allowed は接続検証済みを意味しません。Host 端末がなければ skill は一度ユーザーへ依頼して待ち、通常の Guest 端末で代替しません。

再帰削除と複数ファイル保存のトランザクションは未対応です。Host 検索は保存済みファイルのみで、文書 EOL は生バイトの証明ではありません。未対応手順はユーザーへ協力を依頼し、迂回せず返答を待ちます。[使用方法](../docs/USAGE.ja.md)、[API](../docs/API.ja.md)、[開発](../docs/DEVELOPMENT.ja.md)、[検証記録](../docs/VALIDATION-v0.2.ja.md)を参照してください。

大容量ダウンロード `transferOpenRead/transferRead`（CLI download を含む）は Host 送信前に `feature_unavailable` を返します。約 1.1 MB の実転送で端末停止が繰り返されたため、信頼できる出力方式まで保留です。小分け読み取りの反復で迂回しません。小容量バイト読み取りと大容量アップロードは利用できます。
