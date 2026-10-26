# 構成 v0.2

[English](ARCHITECTURE.md) | [简体中文](ARCHITECTURE.zh-CN.md) | [繁體中文](ARCHITECTURE.zh-TW.md) | **日本語**

v0.2.2：**Configure IPC Access** は ownerOnly（既定）、allLocalUsers、安定 SID の selectedUsers を提供します。旧 true は既存の選択アカウントだけへ移行し、全員を自動許可しません。[IPC モード](IPC-SECURITY.ja.md)を参照してください。Host 権限は独立です。

[ドキュメント](README.ja.md)

## モジュールの役割

- `extension.cjs`：既定で現在ユーザー専用のローカル IPC、ライフサイクル、英語の権限ステータス。
- `permissions.cjs`：認可層。リクエスト処理前と Host 送信前に現在の User/machine 設定を確認します。agent API は権限を変更できません。
- `workspace.cjs`：文書バージョン、dirty 保護、テキスト事前検証、言語編集、対象保存。Host 変更後は正規化内容が一致するまでモデル保護を維持します。
- `host-channel.cjs`：共有端末操作を直列化し、ランダム bootstrap でルートを確認し、nonce と終了マーカーで応答を区切ります。大入力は準備確認後に非エコーのコンソール経路で送信します。
- `host-operations.cjs`：公開 API を個別 Host アクションへ変換し、ジョブ／転送を root と epoch に結び付けます。
- `host-actions.ps1`：メモリ上の Host ヘルパーを読み込みます。`host-runtime.cs` は Windows Job Object、上限付きストリーム排出、分割バイトハンドル、SHA-256、期限を提供します。常駐 Host agent や HTTP サービスは不要です。
- `cli.cjs`：唯一の正規クライアント。ビルド時 skill に複製し、JSON、パッチ、分割アップロードを扱います。残されている download 入口は本版のサーバー認可で拒否します。

## 文書経路と Host 経路

通常のテキスト編集は文書 API を使い、保存成功後のプロバイダー再読み取りを加えません。任意の Host 経路は保存済み検索、コマンド、パッチ、バイト／ディレクトリ操作を担当します。raw 実行には全操作権限、個別 API には個別権限が必要です。これは任意スクリプトの OS サンドボックスではありません。

`vsls:` URI は保持し、Node のローカルファイルシステムへ渡しません。instance/epoch/root で結び付け、ワークスペース変更後に旧リソースを別プロジェクトへ流用しません。結果不明の送信済み変更を自動再送しません。

## 権限撤回、障害、制約

権限撤回は新規作業を止め、送信済み処理はロールバックしません。子タスクのタイムアウトは有効です。同期ファイル操作は Guest 応答タイムアウト後も完了する場合があります。転送の一時資源にはアイドル期限があり、ディレクトリコピーは途中失敗があり得ます。再帰削除と複数ファイルの保存トランザクションは提供しません。

Host 書き込みが Guest 更新に先行する場合、影響する開いた文書だけを確認します。不一致や dirty 競合は保持して報告し、全体 revert はしません。継続する競合や未対応の手順は skill がユーザーへ協力を依頼し、返答後に依存作業を続行します。

大容量ダウンロードは実端末で繰り返し停止したため、本版は `feature_unavailable` で拒否します。小分け読み取りの反復で迂回しません。小容量バイト読み取りと大容量アップロードは利用できます。出力ペーシングのローカルテスト成功は障害解決の証明ではありません。[検証記録](VALIDATION-v0.2.ja.md)を参照してください。

`pipe-security.cs` / `pipe-host.ps1`: 明示 owner／sandbox DACL、ローカル／セッション照合、単一ハンドル維持、入力上限、応答排出。

`local-accounts.cs` はローカル SAM と安定 SID の選択、`ipc-access.cjs` は User モード、旧 SID の一度限り移行、英語の選択画面を担当します。
