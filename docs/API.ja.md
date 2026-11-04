# API リファレンス

[English](API.md) | [简体中文](API.zh-CN.md) | [繁體中文](API.zh-TW.md) | **日本語**

[ドキュメント](README.ja.md)

リクエストは op、instance、epoch と正確な workspace URI を使います。これらは検出（`lswb_list_workspaces`。[MCP ガイド](MCP.ja.md#検出結果)を参照）から取得します。トラブルシューティング CLI の raw リクエスト引数でもバインド情報を指定できます。共有パスは選択ルートからの相対パスです。応答は `{ok:true,result:...}` または `{ok:false,error:{code,message,details?}}` です。その上で applied/saved、各ファイル結果、complete、切り詰め、状態、終了コードを確認します。

## 権限と Host バインド

設定はすべて英語で `liveshareWorkspaceBridge.*` 配下にあり、machine scope です（User/Remote 設定。ワークスペースからは上書きできません）。

| 設定 | 意味 |
|---|---|
| agent.enabled | 全体のアクセススイッチ。既定 true。info/status は確認可能なままです。 |
| host.enabled | Host アクセス。既定 false。無効の間はすべての Host 依存機能が実質的に無効です（`host_access_disabled`）。terminal.enabled を置き換えます。 |
| permissions.OPERATION | 操作別スイッチ。別名は基本操作を継承します。info.permissions.configured/effective で確認します。 |
| host.terminalName | Host ヘルパーを起動する共有 RW 端末の正確な名前。空欄なら適格な共有端末が一つだけ必要です。Guest 端末は除外します。 |
| host.workspacePath | 任意の明示 Host ルート。未指定なら共有 PowerShell の現在ディレクトリを検証します。 |
| host.commandTimeoutMs | 既定 120000、範囲 1000..3600000。 |
| host.maxOutputCharacters | stdout/stderr ストリームごとの保持文字数。既定 65536、範囲 1024..262144。 |
| transfer.chunkBytes | 1 チャンクの生バイト数。既定 32768、範囲 1024..65536。 |
| transfer.idleTimeoutMs | ハンドル／一時資源のアイドル期限。既定 120000、範囲 10000..900000。 |

0.3.0 の名前変更では、新しいキーが未設定の間、旧 `terminal.*` の User 値を 1 版の間読み取り続けます。[設定](SETTINGS.ja.md#1-版限りで読み取る非推奨キー)を参照してください。info.permissions は `hostEnabled` を報告します。

raw Host コマンドには全操作権限の有効化が必要です。任意のコードでは個別の操作制限を強制できないためです。文書変更には save、親作成には mkdir、バイト上書きには write が必要です。これらは操作の認可であり、OS ファイルシステムのサンドボックスではありません。

```json
{"op":"hostStatus"}
{"op":"hostBind"}
```

hostStatus はコマンドを送信せず、即座に応答します。バインドは所有する一時 Guest bootstrap ファイルを書き込み、共有 Host 端末に起動行を一行入力してフォアグラウンドのメモリ上 Host ヘルパー（プロトコル 3）を起動し、ヘルパーが待ち受けを始めるとファイルを削除します。その後 hostBind は `bound:false` を `handshake.state:"waitingForward"`、`hostPort`、`next` とともに返します。Host がそのポートに対して "Live Share: Share Server" を実行すると、hostStatus は `bound:true` を報告します。それまで他の Host リクエストは `host_handshake_pending` を返します。すべてのリクエストは、ヘルパーごとの token を使って転送ループバックポートを通ります。端末にはそれ以外のものを入力しません。Host agent のインストールや認証の変更は行いません。現在の Host 対応は Windows 上の Windows PowerShell です。Host アクセスの取り消しは新規リクエストを止めますが、送信済みの効果は戻しません。

## テキスト、ファイル、言語機能

```json
{"op":"list","path":"src"}
{"op":"read","path":"src/main.ts","startLine":1,"endLine":80}
{"op":"readMany","files":[{"path":"a.txt"},{"path":"b.txt","startLine":1,"endLine":40}]}
{"op":"edit","files":[{"path":"a.txt","expectedVersion":3,"changes":[{"oldText":"old","newText":"new"}]}]}
{"op":"write","path":"a.txt","expectedVersion":4,"text":"replacement\n"}
{"op":"create","path":"new/a.txt","text":"hello\n","eol":"LF"}
{"op":"save","path":"a.txt","expectedVersion":5}
{"op":"mkdir","path":"new/nested"}
{"op":"stat","path":"a.txt"}
{"op":"move","path":"old.txt","to":"new.txt","parents":false}
{"op":"delete","path":"empty-directory"}
{"op":"references","path":"src/a.ts","line":12,"character":8}
{"op":"renameSymbol","path":"src/a.ts","line":12,"character":8,"newName":"newValue","preview":true}
{"op":"format","path":"src/a.ts","tabSize":2,"insertSpaces":true}
```

読み取りはバッファーの text/version/dirty/EOL/lineCount を返します。行は 1 始まりで両端を含みます。withHash:true は文書テキストのハッシュを追加しますが、Host の生バイトではありません。一度のテキスト応答は 1 MiB までで、文書を開く際にはプロバイダー資源全体にアクセスする場合があります。存在しないファイルの読み取りは `not_found` で失敗します（readMany ではそのエントリーだけ）。その他のオープン失敗は元のコードを保持します。

edit.files は異なる対象 100 件、各ファイル 1000 変更までです。oldText は all:true でない限り一意でなければなりません。すべての位置は元の内容を基準とし、重複できません。行編集は startLine/endLine/newText/expectedText? を使い、最後の行区切りを含まずに行を選択します。ネイティブ範囲フィールドは 0 始まりの行と UTF-16 文字位置を使い、終端を含まず、version/hash/expectedText で保護されます。全体の write には expectedVersion または expectedHash が必要です。

テキストは Guest 文書の EOL に正規化されます。Host の共同編集ではディスク上の改行が異なる場合があります。保存は対象のみでトランザクションではなく、部分失敗は明示されます。allowDirty:true は既存の未保存内容を保持して保存することを含みます。

既存の symbols、workspaceSymbols、definition、diagnostics は引き続き利用できます。言語照会の入力は 1 始まりの行と 0 始まりの UTF-16 文字位置です。名前変更／整形は範囲と dirty バッファーを確認して対象を保存します。名前変更はテキスト編集だけを再構成し、プロバイダーのファイル操作は行いません。preview:true は適用せずに計画を返します。整形にはプロバイダーが必要です。

delete は recursive:true を拒否します。stat はサイズやプロバイダー時刻が不明な場合のあるプロバイダーメタデータです。providerRead は明示的な UTF-8 検証で、バイナリー読み取りではありません。Host 書き込みは、影響する開いた Guest 文書だけの正規化テキストダイジェストを（1 ファイル 16 MiB まで）同じ Host 応答内で計算します。HostStat の withTextHash:true は、結果不明の変更後にそのダイジェストを明示的に更新できます。clean な Guest モデルはバージョンが変わるだけでなく、ダイジェストと一致する必要があります。Host 書き込みは対応する変更イベントを待つ場合があり、editor_refresh_pending ではエディター全体の revert や既知の古いテキストの返却をせず、バッファーを保持します。

## 保存済みファイルの完全検索

```json
{"op":"search","query":"handleRequest","include":["src/**/*.ts"],"exclude":["**/generated/**"],"caseSensitive":true,"limit":500}
{"op":"findFiles","pattern":["src/**/*.ts"],"limit":500}
```

include/exclude は単一 glob または配列で、カンマ区切りのパターン言語ではありません。regex/wholeWord/caseSensitive は既定 false です。useExcludes:false は隠し／無視ファイルも含めますが、.git 管理パスは引き続き除外します。それ以外は rg の無視規則を使い、VS Code の条件付き除外は完全には再現しません。

complete、state、exitCode、truncated、scope:saved_host_files を確認します。無一致の終了コード 1 は正常です。出力／結果の上限や解析エラーでは complete が false になります。limit は既定 500、最大 10000 です。一致結果には相対パス、1 始まりの行番号、テキスト、UTF-8 バイトオフセットが含まれます。UTF-16 編集を組み立てる前に該当テキストを読み直してください。dirty バッファーは別に報告し、自動保存しません。

明示的な searchSnapshot/searchResults/findFilesSnapshot は従来の限定的なエディター／プロバイダー経路を使い、完全性は不明です。Host アクセスは不要で、自動の代替手段ではありません。

## コマンドとパッチ

```json
{"op":"hostExec","command":"node --test","cwd":"","timeoutMs":120000,"waitMs":1000}
{"op":"hostJobPoll","jobId":"<id>","waitMs":5000,"stdoutOffset":0,"stderrOffset":0}
{"op":"hostJobCancel","jobId":"<id>"}
{"op":"hostJobForget","jobId":"<id>"}
{"op":"applyPatch","patch":"<Git-style unified text patch>","checkOnly":true}
```

既知のファイル変更を伴うコマンドには affectedPaths（相対パス 100 件まで）を指定します。影響する開いたバッファーだけを最終 Host テキストダイジェストと照合し、それ以外の任意のコマンドの副作用は追跡しません。

コマンドは Windows Job Object 付きの所有子プロセスで実行されます。タイムアウト／キャンセルはそのツリーだけを対象にし、共有 PowerShell は対象にしません。コマンド長は 1..8000、waitMs は 0..5000、timeout は 1000..3600000 です。状態は running/completed/timed_out/cancelled です。completed は終了コード 0 を意味しません。ストリームは上限付きで排出され、切り詰めが明示されます。返されたカーソルを再利用します。forget は終了済みジョブだけが対象です。保持ジョブは 1 バインドあたり最大 16 件です。

パッチは最大 1 MiB／100 ファイルで、a/ と b/ のパスを使います。ルート外への逸脱、.git の変更、バイナリー／シンボリックリンク／サブモジュールのパッチはできません。適用前に git apply --check を実行します。checkOnly:true は適用しません。dirty な対象は拒否します。stage/commit/push はしません。Host に Git が必要です。パッチの改行は Host の Git 設定に従います。生バイトの正確さが必要な場合はバイト API を使います。

## 生バイトと大容量転送

```json
{"op":"hostStat","path":"asset.bin","withHash":true}
{"op":"readBytes","path":"asset.bin"}
{"op":"writeBytes","path":"asset.bin","base64":"<canonical base64>","parents":false}
{"op":"writeBytes","path":"asset.bin","base64":"<base64>","overwrite":true,"expectedCurrentSha256":"<raw Host hash>"}
{"op":"copy","path":"assets/a.png","to":"backup/a.png"}
{"op":"copyDirectory","path":"template","to":"new-template"}
```

小容量バイト API は chunkBytes で上限が決まり、SHA-256 を検証します。ディレクトリコピーは新規宛先が必要で、再解析ポイント／Git 管理ツリーを拒否します。パスとその祖先は検証済み Host ルート内に限定されます。既存バイトの上書きには生バイトの expectedCurrentSha256 が必要で、テキストハッシュとは異なります。通常の書き込みで余分なプロバイダー検証は行いません。

agent はローカルファイルを MCP ツール `lswb_upload_file` でアップロードし、ローカルパッチファイルを `lswb_apply_patch_file` で適用します。[MCP ガイド](MCP.ja.md)を参照してください。アップロードでの上書きには `overwrite` と、対象の現在の生 `expectedCurrentSha256` が必要です。有効な転送プロトコルは transferBeginWrite、transferWrite(sequence/base64)、transferCommit(sha256)、transferAbort です。最大フレームサイズは引き続きリクエスト 2 MiB／応答 4 MiB で、アップロードは多数の上限付きチャンクを使います。

アップロードは所有する Host 一時ファイルに段階保存され、close 時削除とアイドル期限が設定されます。宛先は commit 時にだけ更新されます。直前と同一のアップロード手順の繰り返しは冪等です。通常の変更は自動で再送しません。commit の応答を失った場合は、再開の前に対象の状態とハッシュを確認する必要があります。未対応の手順では、依存作業の前に具体的なユーザー協力の依頼と返答が必要です。[MCP ガイド](MCP.ja.md)を参照してください。

大容量ダウンロード（`transferOpenRead`/`transferRead`）は `feature_unavailable` を返します。アクセス可能なコピーとローカルパスをユーザーに依頼し、小分けのバイト読み取りの反復や raw コマンドで制限を迂回しません。小容量のバイト読み取りと大容量アップロードは利用できます。
