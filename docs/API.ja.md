# API リファレンス

[English](API.md) | [简体中文](API.zh-CN.md) | [繁體中文](API.zh-TW.md) | **日本語**

[ドキュメント](README.ja.md)

## プロトコル

リクエストは JSON オブジェクトです。共通項目の `instance`、`epoch`、`workspace` は同名の CLI オプションでも指定できます。値は `instances` から取得してください。ファイルパスは選択したルートからの相対パスで、区切りはスラッシュです。

- リクエスト上限：2 MiB。
- レスポンス上限：4 MiB。
- 1 回の読み取りで返すテキストの上限：1 MiB。

レスポンスは `{"ok":true,"result":...}` または `{"ok":false,"error":{"code":"...","message":"..."}}` です。外側の成功フラグとは別に、`applied`、`saved`、各ファイルの結果を確認してください。適用失敗、保存失敗、読み取りの部分的な失敗では CLI が非ゼロで終了します。

## 読み取りと編集

```json
{"op":"info"}
{"op":"list","path":"src"}
{"op":"read","path":"src/main.ts","startLine":20,"endLine":100}
{"op":"readMany","files":[{"path":"src/main.ts","startLine":20,"endLine":100},{"path":"package.json"}]}
{"op":"edit","files":[{"path":"src/main.ts","expectedVersion":4,"changes":[{"oldText":"return oldValue;","newText":"return newValue;"}]}]}
{"op":"edit","files":[{"path":"src/main.ts","expectedVersion":4,"changes":[{"startLine":20,"endLine":23,"newText":"replacement lines"}]}]}
{"op":"write","path":"config.json","expectedVersion":2,"text":"{}\n"}
{"op":"create","path":"src/new/module.ts","text":"export const value = 1;\n","eol":"LF"}
{"op":"save","path":"src/main.ts","expectedVersion":5}
```

`read` はバッファーのテキスト、`version`、`dirty`、`eol`、`lineCount` を返します。行番号は 1 始まりで両端を含みます。`withHash:true` のときだけ現在のテキストの SHA-256 を追加します。これは生のファイルバイト列のハッシュではありません。部分的な出力でも、プロバイダーへのアクセスがストリーミングであるとは限りません。

`edit.files` は異なるドキュメントを最大 100 件、各ドキュメントの変更を最大 1000 件受け付けます。位置はすべて変更前のドキュメントを基準とし、範囲の重複はできません。`oldText` は空ではなく一意である必要があり、`all:true` では重ならない全一致箇所を置換します。

行単位の編集は指定した行を選択しますが、最後の選択行の末尾にある改行区切りは含みません。`expectedText` で選択内容を照合できます。ネイティブ範囲は `range:{start:{line,character},end:{line,character}}` です。行番号は 0 始まり、終端は含まず、character は UTF-16 オフセットです。範囲外の位置は拒否されます。位置指定の編集には `expectedVersion`、`expectedHash`、`expectedText` のいずれかが必要です。

`write` は既存ドキュメントを全置換し、`expectedVersion` または `expectedHash` を必要とします。存在しないファイルには `create` を使用します。作成と編集は対象ドキュメントを保存します。既存ファイルの EOL は維持されます。作成時は最初の改行から推定し、改行がない場合は LF、明示する場合は `LF` / `CRLF` を指定します。

`edit` は `{applied,saved,files:[{uri,version,dirty,saved,changes,error?}]}` を返します。1 つの WorkspaceEdit を適用してから各ファイルを保存し、失敗時に自動ロールバックや再適用は行いません。`save` には現在の `expectedVersion` が必要です。既存の未保存内容を明示的に含めるときだけ `allowDirty:true` を指定してください。

## ファイル操作

```json
{"op":"mkdir","path":"new/nested"}
{"op":"stat","path":"src/main.ts"}
{"op":"copy","path":"src/main.ts","to":"backup/main.ts"}
{"op":"move","path":"backup/main.ts","to":"backup/renamed.ts"}
{"op":"delete","path":"backup/renamed.ts"}
```

作成、コピー、移動では、`parents:false` がない限り不足する親ディレクトリを作成します。コピーと移動は `overwrite:true` がない限り上書きを拒否します。コピーはファイル、移動はファイルとディレクトリに対応します。削除はファイルと空ディレクトリのみで、ごみ箱を使用せず、`recursive:true` は拒否します。元または先に未保存ドキュメントがある場合、これらの操作はブロックされます。

`mkdir` は既存ディレクトリの扱いも含め、プロバイダーに直接委譲します。`stat` の不明なサイズや時刻は `null` のまま返します。失敗するまでに親ディレクトリが作成されている場合があります。ファイル操作はロールバック可能なトランザクションではありません。

## 検索とコードナビゲーション

```json
{"op":"findFiles","pattern":"src/**/*.ts","limit":100}
{"op":"search","query":"handleRequest","include":"src/**/*.ts","regex":false,"caseSensitive":true,"waitMs":800}
{"op":"searchResults","searchId":1}
{"op":"diagnostics","path":"src/main.ts"}
{"op":"symbols","path":"src/main.ts"}
{"op":"workspaceSymbols","query":"Handler"}
{"op":"definition","path":"src/main.ts","line":20,"character":8}
```

`findFiles` は最大 1000 件を返し、`possiblyCapped` と `complete:null` を含みます。既定では除外設定に従います。必要に応じて `exclude` または `useExcludes:false` を指定できます。新規ファイルが結果に含まれない場合があります。

`search` は Live Share ルートが 1 つの場合に利用でき、Search View を使用します。オプションは `include`、`exclude`、`regex`、`caseSensitive`、`useExcludes`（既定 true）です。`waitMs` は 0–5000、既定 800 で、取得までの待機時間であり完了を意味しません。結果は `search.id`、`snapshot`、`truncated`、`complete:null`、`correlation:"best_effort"` を含みます。`maxCharacters` は既定 100000、上限 1000000 です。

`searchResults` は新しい検索を開始しません。`searchId` を指定すると、このブリッジから別の検索が開始されたことを検出できますが、ユーザーによる Search View の手動変更は検出できません。

`definition` の行番号は 1 始まり、文字位置は 0 始まりの UTF-16 オフセットです。返された位置は URI scheme を保持し、ネイティブの 0 始まりの位置を使います。言語結果が空でも、ビルドの成功を意味しません。

`providerRead` はプロバイダーの UTF-8 テキストとバイト数を返します。トラブルシューティングや明示的な照合用で、正常な書き込み後に自動実行される操作ではありません。

## エラー

| コード／結果 | 対応 |
|---|---|
| `instance_mismatch`、`workspace_changed` | 再検出し、対象ワークスペースを確認します。 |
| `content_changed` | 編集前に該当テキストまたはバージョンを更新します。 |
| `text_not_found`、`ambiguous_match` | 文字列の照合内容や範囲を調整します。 |
| `dirty_document` | 既存の未保存内容が保護されています。 |
| `saved:false` | 適用済みの内容がエディターに残っている可能性があるため、編集ではなく保存を再試行します。 |
| `transport_outcome_unknown`、`requestSent:true` | 変更操作の再試行前に対象の状態を確認します。 |
