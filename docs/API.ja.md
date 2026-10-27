# API リファレンス

[English](API.md) | [简体中文](API.zh-CN.md) | [繁體中文](API.zh-TW.md) | **日本語**

[ドキュメント](README.ja.md)

## プロトコル

リクエストは `op/instance/epoch` と正確な `workspace` URI を使います。CLI の同名引数でもバインド情報を指定できます。共有パスは選択ルートからの相対パスで、区切りはスラッシュです。応答は `{ok:true,result:...}` または `{ok:false,error:{code,message,details?}}` です。外側の成功とは別に `applied/saved`、各ファイル結果、`complete`、切り詰め、状態、終了コードを確認します。上限はリクエスト 2 MiB、応答 4 MiB です。

## 権限と Host バインド

設定名は英語で `liveshareWorkspaceBridge.*` 配下です。machine scope の User/Remote 設定であり、ワークスペースから上書きできません。

| 設定 | 意味 |
|---|---|
| `agent.enabled` | 全体スイッチ。既定 true。info/status は検査可能です。 |
| `terminal.enabled` | Host 共有端末アクセス。既定 false。無効時は全 Host 操作の実効権限が無効です。 |
| `permissions.OPERATION` | 操作別権限。別名は基本操作を継承し、`info.permissions.configured/effective` で確認できます。 |
| `terminal.name` | 正確な共有 RW 端末名。空欄なら適格な共有端末が一つ必要です。Guest ローカル端末は除外します。 |
| `terminal.hostWorkspacePath` | 任意の明示 Host ルート。未指定なら共有 PowerShell の現在ディレクトリを検証します。 |
| `terminal.commandTimeoutMs` | 既定 120000、範囲 1000..3600000 ミリ秒。 |
| `terminal.maxOutputCharacters` | stdout/stderr それぞれの保持文字数。既定 65536、範囲 1024..262144。 |
| `transfer.chunkBytes` | 1 チャンクの生バイト数。既定 32768、範囲 1024..65536。 |
| `transfer.idleTimeoutMs` | 転送ハンドル／一時資源のアイドル期限。既定 120000、範囲 10000..900000 ミリ秒。 |

raw Host コマンドには全操作権限が必要です。文書変更には save、親作成には mkdir、バイト上書きには write が必要です。これは操作認可であり、OS ファイルシステムのサンドボックスではありません。

```json
{"op":"hostStatus"}
{"op":"hostBind"}
```

`hostStatus` は端末コマンドを送信しません。`hostBind` は所有するランダムな一時 bootstrap ファイルでルートを検証し、メモリ上のヘルパーを読み込んでファイルを削除します。常駐 Host agent のインストールや認証変更は行いません。現在の Host 対応は Windows PowerShell のみです。権限無効化は新規送信を止め、送信済み効果は戻しません。

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

読み取りはバッファーテキスト、version、dirty、EOL、lineCount を返します。行は 1 始まりで両端を含みます。`withHash:true` は文書テキストのハッシュで、生バイトではありません。一度のテキスト応答は 1 MiB までで、文書を開く際には資源全体へアクセスする場合があります。

`edit.files` は異なる対象 100 件、各ファイル 1000 変更までです。`oldText` は原則一意で、意図的な全置換だけ `all:true` を使います。位置は元の内容基準で重複不可です。行編集は `startLine/endLine/newText/expectedText?` を使い、末尾の行区切りを含みません。ネイティブ範囲は 0 始まりの行と UTF-16 文字位置、終端を含まない範囲で、バージョン／ハッシュ／期待テキストの保護があります。文書全体の `write` は `expectedVersion` または `expectedHash` が必要です。

Guest 文書 EOL に正規化しますが、Host 共同編集でディスク改行が異なる場合があります。対象のみ保存し、複数ファイルのトランザクションは保証しません。部分失敗を明示し、`allowDirty:true` は既存の未保存内容を保持して保存する意図を含みます。

`symbols/workspaceSymbols/definition/diagnostics` は引き続き利用できます。言語照会の入力は 1 始まりの行と 0 始まりの UTF-16 文字位置です。名前変更／整形は範囲、バージョン、dirty を確認して対象を保存します。名前変更はテキスト編集のみを再構成し、プロバイダーのファイル操作は適用しません。`preview:true` は計画のみです。整形にはプロバイダーが必要です。

`delete` は `recursive:true` を拒否します。`stat` はサイズや時刻が不明な場合のあるプロバイダーメタデータです。`providerRead` は明示的 UTF-8 検証で、バイナリー読み取りではありません。Host 書き込みは影響する開いた Guest 文書だけの正規化ダイジェストを同じ応答に付け、1 ファイル 16 MiB までとします。`hostStat` の `withTextHash:true` は結果不明の変更後に期待ダイジェストを明示更新できます。バージョン増加だけでは不十分で、clean モデルも内容一致が必要です。未更新なら `editor_refresh_pending` で保持し、全体 revert や既知の古いテキスト返却はしません。

## 保存済みファイルの完全検索

```json
{"op":"search","query":"handleRequest","include":["src/**/*.ts"],"exclude":["**/generated/**"],"caseSensitive":true,"limit":500}
{"op":"findFiles","pattern":["src/**/*.ts"],"limit":500}
```

include/exclude は単一 glob または配列で、カンマ区切り言語ではありません。`regex/wholeWord/caseSensitive` は既定 false。`useExcludes:false` は隠し／無視ファイルも含めますが、`.git` 管理パスは常に除外します。それ以外は rg 無視規則を使い、VS Code の条件付き除外を完全には再現しません。

`complete/state/exitCode/truncated` と `scope:saved_host_files` を確認します。無一致の終了コード 1 は正常です。出力／結果上限または解析失敗では complete は false です。limit は既定 500、最大 10000。結果は相対パス、1 始まり行番号、テキスト、UTF-8 バイトオフセットです。UTF-16 編集の作成前に該当テキストを読みます。dirty 文書は別に報告し、自動保存しません。

`searchSnapshot/searchResults/findFilesSnapshot` は明示的な旧エディター／プロバイダー照会で、完全性は不明です。Host 不要ですが、Host 不在時の自動代替ではありません。

## コマンドとパッチ

```json
{"op":"hostExec","command":"node --test","cwd":"","timeoutMs":120000,"waitMs":1000}
{"op":"hostJobPoll","jobId":"<id>","waitMs":5000,"stdoutOffset":0,"stderrOffset":0}
{"op":"hostJobCancel","jobId":"<id>"}
{"op":"hostJobForget","jobId":"<id>"}
{"op":"applyPatch","patch":"<Git-style unified text patch>","checkOnly":true}
```

既知のファイル変更には `affectedPaths` を指定します。相対パス 100 件までです。その開いたバッファーだけを最終 Host ダイジェストと照合し、他の任意の副作用は追跡しません。

コマンドは所有子プロセスと Windows Job Object で実行します。タイムアウト／キャンセルはそのツリーのみで、共有 PowerShell を終了しません。コマンド長 1..8000、`waitMs` 0..5000、timeout 1000..3600000 ミリ秒です。状態は `running/completed/timed_out/cancelled`。completed は終了コード 0 を意味しません。出力は上限付きで継続排出し、切り詰めを明示します。返されたカーソルを再利用します。forget は終了済みのみ、1 バインド最大 16 ジョブです。

パッチは 1 MiB／100 ファイルまでで `a/`、`b/` パスを使います。ルート逸脱、`.git`、バイナリー、シンボリックリンク、サブモジュールは拒否します。`git apply --check` 後に適用し、`checkOnly:true` は書き込みません。dirty 対象は拒否します。Host に Git が必要で、stage/commit/push はしません。改行は Host Git 設定に従い、生バイト保証にはバイト API を使います。

## 生バイトと大容量アップロード

```json
{"op":"hostStat","path":"asset.bin","withHash":true}
{"op":"readBytes","path":"asset.bin"}
{"op":"writeBytes","path":"asset.bin","base64":"<canonical base64>","parents":false}
{"op":"writeBytes","path":"asset.bin","base64":"<base64>","overwrite":true,"expectedCurrentSha256":"<raw Host hash>"}
{"op":"copy","path":"assets/a.png","to":"backup/a.png"}
{"op":"copyDirectory","path":"template","to":"new-template"}
```

小容量バイト API は chunkBytes 上限と SHA-256 検証があります。ディレクトリコピーは新規宛先のみで、再解析ポイントや Git 管理ツリーを拒否します。パスと祖先は検証済み Host ルート内に限定します。上書きには生バイトの `expectedCurrentSha256` が必要で、テキストハッシュとは異なります。通常書き込みに余分なプロバイダー確認は加えません。

```powershell
node "<client>" upload --instance "<id>" --epoch "<epoch>" --workspace "vsls:/" --input "<local.bin>" --path "assets/file.bin"
node "<client>" apply-patch --instance "<id>" --epoch "<epoch>" --workspace "vsls:/" --input "<local.patch>" --check-only
```

アップロード上書きは `--overwrite` と `--expected-current-sha256 HASH` を使います。有効な転送プロトコルは `transferBeginWrite`、`transferWrite(sequence/base64)`、`transferCommit(sha256)`、`transferAbort` です。ファイルは複数の上限付きチャンクで送ります。

所有する Host 一時ファイルへ保存し、close 時削除とアイドル期限を設け、commit 時だけ宛先を更新します。直前と同じアップロード番号／内容の重複は冪等です。通常変更を自動再送しません。commit 応答を失ったら対象状態とハッシュを確認してから再開を判断します。

大容量ダウンロード（`transferOpenRead/transferRead`、CLI download を含む）は `feature_unavailable` です。アクセス可能なコピーとローカルパスを依頼し、小分け読み取り反復や raw コマンドで迂回しません。小容量読み取りと大容量アップロードは利用できます。
