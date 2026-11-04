# 使用方法

[English](USAGE.md) | [简体中文](USAGE.zh-CN.md) | [繁體中文](USAGE.zh-TW.md) | **日本語**

[ドキュメント](README.ja.md)

agent は MCP サーバーを通じてブリッジを使います。セットアップ、全ツール一覧、結果の意味は [MCP ガイド](MCP.ja.md)にあります。

1. 接続済み Guest ウィンドウの Profile に VSIX をインストールします。
2. **Live Share Workspace Bridge: Copy MCP Server Configuration** を実行し、[MCP ガイド](MCP.ja.md)の説明に従って agent にサーバーを追加します。VS Code 組み込み agent は構成なしで検出します。
3. agent に `lswb_list_workspaces` を一度呼び出してもらい、対象ルートを選びます。他のすべてのツールは、そのルートの正確な `uri` を `workspace` 引数として受け取ります。
4. **Live Share Workspace Bridge: Configure Agent Permissions** を開きます。agent アクセスは既定で有効、Host アクセス（`host.enabled`）は既定で無効です。英語の操作スイッチは手動で調整します。
5. Host 機能には、Host で Windows PowerShell 端末を読み書きモードで共有してもらい、Guest から接続します。ブリッジはその端末を一度使って Host ヘルパーを起動します。共有端末が複数ある場合は正確な端末名（`host.terminalName`）を設定します。明示的な Host ルートも任意で設定でき、パスは推測しません。
6. 許可されたタスクで agent に `lswb_host_status` と `lswb_host_bind` を呼び出してもらいます。その後 Host がブリッジに表示されたポートに対して "Live Share: Share Server" を実行し、agent はバインドされるまで `lswb_host_status` をポーリングします。端末がない場合、agent は一度依頼して待ちます。通常の Guest 端末で作業を始めたり、設定を迂回したりすることはありません。

## テキスト編集

`lswb_read_file` または `lswb_read_many` を使い、バージョンを保持します。関連する変更は一つの `lswb_edit_file` リクエストにまとめ、`applied`、`saved`、各対象の `dirty` 状態を確認します。成功後は余分な全文検証なしで続行します。新規テキストには `lswb_create_file`、保護付きの全置換には `lswb_write_file`、保存失敗の再試行にはテキストを再適用せず `lswb_save_file` を使います。

未保存バッファーは保護されます。`allowDirty:true` は既存の変更を保持して保存する意図を含める必要があります。通常の文書 EOL は Guest の状態を反映し、Host の生バイトは別の契約です。

## 検索、コマンド、パッチ

`lswb_search` と `lswb_find_files` は Host rg を使い、完全性、上限、終了コードを報告します。無一致の終了コード 1 は正常です。保存済みファイルの検索は dirty バッファーを対象にせず、自動の saveAll もしません。エディタースナップショットは明示的な限定操作のままです。

`lswb_host_exec` は出力に上限のあるジョブを返します。ビジーループではなく、有用な waitMs と出力カーソルを使って `lswb_host_job_poll` でポーリングします。キャンセルは `lswb_host_job_cancel` で所有タスクツリーだけを対象にします。実際の終了コードを報告します。raw コマンドには全操作権限が必要です。権限が制限されている場合は、制限を迂回せず許可された個別ツールを使います。

`lswb_apply_patch`（パッチテキスト）と `lswb_apply_patch_file`（ローカルパッチファイル）は、テキストパッチの適用前にパスを確認し Host Git の事前検証を実行します。checkOnly:true は確認のみを行います。パッチの改行は Git 設定に従います。commit/push を暗黙に行うことはありません。

## バイトと大きなファイル

小容量の生データには `lswb_read_bytes`/`lswb_write_bytes` を使います。Live Share テキストプロバイダーは任意のバイナリー内容を保持できないため、`lswb_copy` と `lswb_copy_dir` は Host を使います。ディレクトリコピーは新規宛先が必要です。大きなファイルには `lswb_upload_file` を使い、ファイル全体を一つのリクエストに入れません。アップロードは転送の SHA-256 を検証します。既存バイトファイルの上書きには現在の生ハッシュが必要です。

## エラーと制御

全体スイッチと Host スイッチは再起動なしでリクエストに反映されます。送信済み作業は取り消しません。無効な権限は報告され、agent が変更することはありません。結果が不明な送信済み変更（`transport_outcome_unknown`）は再試行の前に確認し、盲目的に再送しません。

Host 書き込みが Guest モデルの再読み込みより先行することがあります。ブリッジは影響する開いたバッファーを対象の正規化 Host ハッシュと照合し、エディター全体を revert することはありません。editor_refresh_pending が返された場合はバッファーを保持し、明示的な Host バイト読み取りを使うか文書を開き直します。

API は引き続き再帰削除を拒否し、複数ファイルの原子的保存を保証しません。詳細なフィールド、上限、復旧は [API](API.ja.md) と [MCP ガイド](MCP.ja.md)にあります。

タスクに未対応の操作が必要な場合、agent はユーザーに協力を依頼します。正確なパスと必要な手動の結果を示し、依存作業の前に待ちます。大容量ダウンロードにはユーザーが用意したアクセス可能なコピーが、再帰削除にはユーザーによる削除の確認が必要です。原子的保存が必要な場合は、適切な Host ツールか、ファイル単位の保存への明示的な同意が必要です。プロバイダー不足や未解決のバッファー競合も、強制 revert や raw コマンドによる迂回をせずに協力を依頼します。

大容量ダウンロード（`transferOpenRead`/`transferRead`）は `feature_unavailable` を返します。アクセス可能なコピーとローカルパスをユーザーに依頼し、小分けのバイト読み取りの反復や raw コマンドで制限を迂回しません。小容量のバイト読み取りと大容量アップロードは利用できます。

## トラブルシューティング CLI

`extension/cli.cjs` はブリッジを診断する人向けで、agent 向けではありません。`instances`、`diagnose`、固定した raw JSON リクエスト一つ（`--instance ID --epoch N --workspace URI [--request FILE]`）に対応します。[トラブルシューティング](TROUBLESHOOTING.ja.md)を参照してください。
