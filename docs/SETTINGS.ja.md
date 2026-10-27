# 設定

[English](SETTINGS.md) | [简体中文](SETTINGS.zh-CN.md) | [繁體中文](SETTINGS.zh-TW.md) | **日本語**

現在リポジトリの schema を説明します。導入済み版は異なる場合があるため、その版、Settings UI、対応資産を優先します。接頭辞 liveshareWorkspaceBridge. は省略し、scope は全て machine（VS Code が許す User/Remote、Workspace/Folder ではありません）。UI は Windows Guest 上で、Host の設定変更とは別です。IPC 信頼は明示 User global のみを読みます。

## 一般／IPC／Host パラメーター

| 設定（接頭辞省略） | 型／既定／範囲 | 目的と安全 | 反映 |
|---|---|---|---|
| `agent.enabled` | `boolean` / `true` | ワークスペース操作の全体スイッチ。info/hostStatus と安全な診断は確認可能で、送信済み効果は戻しません。 | 後続要求に即時反映、Host バインド／参照も破棄。 |
| `terminal.enabled` | `boolean` / `false` | Host API を許可しますが個別権限と検証済み共有 RW 端末も必要です。所有 bootstrap の作成／削除を伴い、通常 Guest shell を Host へ置換しません。 | 後続要求に即時反映、Host バインド／参照も破棄。 |
| `powershell` | `string` / `""` | Guest ローカル IPC／アカウント補助プロセスの PowerShell 指定。空なら標準 Windows PowerShell。Host shell 選択や実行ポリシー変更ではありません。 | 次のローカル起動で反映。実行中を自動切替しません。 |
| `ipc.accessMode` | `string` / `"ownerOnly"` | ownerOnly/allLocalUsers/selectedUsers。所有者は保持、追加は現在のローカル SAM と同 Windows session ID のみ。Everyone、グループ、全ドメインユーザーではなく DC は拒否。全プロセスを信頼し Codex ファイルシステム沙箱外ですが橋接権限に従います。 | IPC 再起動、新 instance/epoch。再検出。 |
| `ipc.selectedUserSids` | `array` / `[]` | selectedUsers だけで使う安定 SID。重複なし最大256文字列、UI は形式、実装は1件184文字とローカル SAM 所属を検証。表示名変更は維持、削除再作成は非継承。 | IPC 再起動、新 instance/epoch。再検出。 |
| `ipc.allowCodexSandboxClients` | `boolean` / `false` | 非推奨の互換設定。明示 User モードなしの true は既存二 sandbox SID を selectedUsers へ固定、false/未指定は ownerOnly。明示モード優先、全員／Host を自動有効化しません。初回 User 設定を移行し、過去に削除再作成された SID をブールから復元できません。 | IPC 再起動、新 instance/epoch。再検出。 |
| `terminal.name` | `string` / `""` | 対象共有端末の正確な名前。空なら適格 PTY が一つ必要で、read-only 確認とバインドは別途実施。タイトルだけで shell/版は確定しません。 | Host バインドを破棄、次の許可済み呼出しで再接続。 |
| `terminal.hostWorkspacePath` | `string` / `""` | 任意の明示 Host ルート。空は共有 PowerShell の現在ディレクトリを Guest と検証。Guest ローカルパスではなく hostBind 引数で上書き可能。 | Host バインドを破棄、次の許可済み呼出しで再接続。 |
| `terminal.commandTimeoutMs` | `integer` / `120000` / 1000..3600000 | Host 子コマンドの既定ミリ秒期限。hostExec timeoutMs で範囲内上書き可能。実行中期限は変わらず、全 IPC／握手タイムアウトではありません。 | Host バインドを破棄、次の許可済み呼出しで再接続。 |
| `terminal.maxOutputCharacters` | `integer` / `65536` / 1024..262144 | stdout/stderr ごとの保持文字数。超過分も排出して truncated を明示し、全出力とはしません。 | Host バインドを破棄、次の許可済み呼出しで再接続。 |
| `transfer.chunkBytes` | `integer` / `32768` / 1024..65536 | チャンクの生バイト／小容量 API 上限。Guest 検証と Host で使い、変更はバインドを破棄して次の Host 作業で再バインド。ダウンロード有効化ではありません。 | Host バインドを破棄、次の許可済み呼出しで再接続。 |
| `transfer.idleTimeoutMs` | `integer` / `120000` / 10000..900000 | Host 転送ハンドル／一時資源のアイドル期限ミリ秒。新バインドで反映し、旧資源の期限は保持。 | Host バインドを破棄、次の許可済み呼出しで再接続。 |

## 操作スイッチ

全行 boolean、既定 true、machine scope で後続チェックへ反映しローカル IPC は再起動しません。API 認可であって内容分類や OS 沙箱ではなく、readBytes は text read 無効でもテキストのバイトを読めます。agent は別経路で意図を迂回してはいけません。

| 設定（接頭辞省略） | 目的と安全 | Host 必要 |
|---|---|---|
| `permissions.list` | ディレクトリ一覧。 | 不要 |
| `permissions.read` | テキスト／一括／provider 読み取り。生バイトとは別。 | 不要 |
| `permissions.create` | 新規テキスト。save、親作成なら mkdir が必要。 | 不要 |
| `permissions.write` | 保護付き全置換。バイト／コピー上書きにも write 必須。 | 不要 |
| `permissions.edit` | テキスト一括編集。パッチ認可にも使用。 | 不要 |
| `permissions.save` | 対象保存。create/write/edit/renameSymbol/format に必要、複数ファイル原子性なし。 | 不要 |
| `permissions.mkdir` | ディレクトリ／暗黙の親作成。 | 不要 |
| `permissions.copy` | Host バイト保持コピー。上書きは write も必要。 | 要 |
| `permissions.copyDirectory` | Host の新規宛先ディレクトリのみ。マージ／再帰置換なし。 | 要 |
| `permissions.move` | 移動／名前変更。上書き write、親作成 mkdir。 | 不要 |
| `permissions.delete` | ファイル／空ディレクトリのみ。 | 不要 |
| `permissions.stat` | provider/Host メタデータ。生ハッシュは readBytes も必要。 | API による |
| `permissions.diagnostics` | 言語診断。空結果はテスト合格ではありません。 | 不要 |
| `permissions.symbols` | 文書シンボル。 | 不要 |
| `permissions.workspaceSymbols` | ワークスペース言語シンボル。全保存ファイル検索ではありません。 | 不要 |
| `permissions.definition` | 定義位置。 | 不要 |
| `permissions.references` | 参照位置。 | 不要 |
| `permissions.renameSymbol` | テキストのみの名前変更／preview。save と保護が必要。 | 不要 |
| `permissions.format` | provider 整形と対象保存。 | 不要 |
| `permissions.search` | Host 保存済み検索。明示 snapshot は限定的で Host 不要。 | API による |
| `permissions.findFiles` | Host パス列挙。明示 provider snapshot は限定的。 | API による |
| `permissions.applyPatch` | Host Git テキストパッチ。edit/create/move/delete を確認。 | 要 |
| `permissions.readBytes` | Host バイト／生ハッシュと読み取りハンドル。利用可否に従います。 | 要 |
| `permissions.writeBytes` | Host バイト／upload。上書きは write と生ハッシュ保護。 | 要 |
| `permissions.largeTransfers` | 分割 upload。writeBytes も必要。無効な download は有効化しません。 | 要 |
| `permissions.hostExec` | 任意 Host コマンドと poll/cancel/forget。他25操作権限も全て true 必須。 | 要 |

## 特殊動作と非設定


- agent/terminal/transfer 変更は Host バインドと Guest のジョブ／転送参照を破棄し、次の許可要求で再接続します。ローカル IPC instance/epoch、実行中子プロセス、元期限は変えません。旧ジョブは Host の手動確認が必要な場合があり、転送は元の期限です。IPC キー変更は未使用 SID/旧項目でもブリッジを再起動します。
- 無効化はロールバックではありません。hostExec と poll/cancel/forget は terminal.enabled と全26操作権限が必要で、一つの無効化でも cancel 不可になり得ますが子期限は残ります。上書き／親作成は write/mkdir、パッチは edit/create/move/delete を確認。直接 Host ディスク操作は文書 save を使いません。
- readMany/providerRead は read、searchSnapshot/searchResults は search、findFilesSnapshot は findFiles、hostStat は stat（hash は readBytes も）、ジョブ制御は hostExec、転送は largeTransfers と方向別 readBytes/writeBytes を継承します。Host 検索／コピー／パッチ／バイト／ジョブは端末必須、snapshot／言語／文書は不要。largeTransfers で無効 download は有効になりません。
- 現実装の設定キーは全て公開 manifest にあり、追加の隠し設定はありません。ipc.legacySidSnapshot は内部 globalState で **設定ではありません**。timeoutMs/waitMs、hostBind hostWorkspacePath は要求引数です。起動記録上限や固定 IPC／Host 応答／握手待ちを UI 設定として扱いません。
- スイッチは端末共有、Host RW 証明、結果不明要求の解決を行いません。[IPC](IPC-SECURITY.ja.md)、[API](API.ja.md)、[起動診断](STARTUP-DIAGNOSTICS.ja.md)を参照し、agent は明示許可なしに有効化／拡大しません。
