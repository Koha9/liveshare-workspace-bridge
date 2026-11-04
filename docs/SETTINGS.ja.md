# 設定

[English](SETTINGS.md) | [简体中文](SETTINGS.zh-CN.md) | [繁體中文](SETTINGS.zh-TW.md) | **日本語**

このリファレンスは現在のリポジトリの schema を説明します。インストール済みのリリースでは、コマンドが少ない／異なる場合があります。そのバージョン、Settings UI、対応するリリース資産を正としてください。以下のキーはすべて接頭辞 liveshareWorkspaceBridge. を持ち、schema scope は machine です（VS Code が許す User/Remote 設定で、Workspace/Folder ではありません）。UI 拡張は Windows Guest 上で実行されるため、Host マシンの設定を変更することとは異なります。IPC の信頼は明示的な User global 値を読み取り、ワークスペースや拡張が提供する既定値は無視します。

## 一般／IPC／Host パラメーター

| 設定（接頭辞省略） | 型／既定／範囲 | 目的と安全 | 反映 |
|---|---|---|---|
| `agent.enabled` | `boolean` / `true` | ワークスペース操作の全体スイッチ。info/hostStatus と安全な診断メタデータは確認可能なままです。無効にしても送信済みの効果は戻しません。 | 後続のリクエスト。Host バインド／資源も無効化されます。 |
| `host.enabled` | `boolean` / `false` | Host に依存する API を許可します。操作スイッチと、検証済みの共有 RW 端末（Host ヘルパーの起動に一度だけ使います）が条件です。バインドでは所有する一時 bootstrap ファイルを作成／削除することがあります。通常の Guest シェルを Host にすることはありません。`terminal.enabled` を置き換えます。 | 後続のリクエスト。Host バインド／資源も無効化されます。 |
| `powershell` | `string` / `""` | IPC／アカウント補助プロセス用の Guest ローカル PowerShell 実行ファイルの指定。空なら組み込みの Windows PowerShell を使います。Host 端末のシェルを選ぶものでも、実行ポリシーを変更するものでもありません。 | 次回のローカルブリッジ起動。実行中のヘルパーは自動で切り替えません。 |
| `ipc.accessMode` | `string` / `"ownerOnly"` | ownerOnly / selectedUsers。保存済みの allLocalUsers 値（0.3.0 で削除）は ownerOnly として動作します。設定は書き換えず、info はそれを ipc.requestedMode と ipc.deprecatedModeIgnored で報告します。所有者は常に保持します。追加の許可は同じ Windows session ID にいる現在のローカル SAM ユーザーだけで、Everyone／グループ／全ドメインユーザーではありません。DC での列挙は拒否します。信頼はそのユーザーのすべてのプロセスに及び、agent のファイルシステムサンドボックスの制限外ですが、ブリッジの権限には従います。 | IPC ブリッジの再起動／新しい instance+epoch。再検出します。 |
| `ipc.selectedUserSids` | `array` / `[]` | selectedUsers だけで使う安定した SID の選択。他のモードでは許可に使いません。重複なしで最大 256 文字列。UI はローカルユーザー SID の形式を検証し、実行時は各文字列を 184 文字までに制限してローカル SAM の所属も検証します。名前は表示用だけです。改名後も維持され、削除／再作成で身元が置き換わることはありません。 | IPC ブリッジの再起動／新しい instance+epoch。再検出します。 |
| `ipc.allowCodexSandboxClients` | `boolean` / `false` | 非推奨の互換フラグ。明示的な User モードがない場合、true は既存の二つの旧サンドボックス身元を selectedUsers に固定し、false／未設定は ownerOnly のままです。明示的なモードが優先します。Host アクセスを有効にすることはありません。初回移行は User 設定を書き込みます。スナップショット前に削除／再作成された SID はブール値から復元できません。 | IPC ブリッジの再起動／新しい instance+epoch。再検出します。 |
| `host.terminalName` | `string` / `""` | Host ヘルパーの起動に使う共有端末の正確な名前。空なら適格な共有 PTY 候補が一つだけ必要です。読み取り専用のヒントとバインドは引き続き確認されます。端末タイトルは実際のシェル／バージョンの証拠ではありません。 | Host バインドを無効化。次の許可済み Host 呼び出しで再バインドします。 |
| `host.workspacePath` | `string` / `""` | 任意の明示 Host ルート。空なら共有 PowerShell の現在ディレクトリを Guest ルートと照合します。Host のパスであり、Guest のローカルパスではありません。hostBind のリクエスト引数で上書きできます。 | Host バインドを無効化。次の許可済み Host 呼び出しで再バインドします。 |
| `host.commandTimeoutMs` | `integer` / `120000` / 1000..3600000 | Host 子コマンドの既定のタイムアウト（ミリ秒）。hostExec の timeoutMs で対応範囲内で上書きできます。開始済みのジョブは元の期限を保持します。IPC／ハンドシェイク全般のタイムアウトではありません。 | Host バインドを無効化。次の許可済み Host 呼び出しで再バインドします。 |
| `host.maxOutputCharacters` | `integer` / `65536` / 1024..262144 | stdout と stderr のストリームごとに個別に保持する文字数。超過分は排出されて truncated と明示され、完全な出力とはみなされません。 | Host バインドを無効化。次の許可済み Host 呼び出しで再バインドします。 |
| `transfer.chunkBytes` | `integer` / `32768` / 1024..65536 | 転送チャンクと小容量バイト API あたりの最大生バイト数。Guest の検証と Host セッションの両方で使い、変更すると以降の Host 作業の前にバインドが無効化されます。ダウンロードを有効にするものではありません。 | Host バインドを無効化。次の許可済み Host 呼び出しで再バインドします。 |
| `transfer.idleTimeoutMs` | `integer` / `120000` / 10000..900000 | Host の転送ハンドル／ステージングのアイドル期限（ミリ秒）。新しいバインドがこの値を使い、既存の資源は確立済みの期限を保持します。 | Host バインドを無効化。次の許可済み Host 呼び出しで再バインドします。 |
| `host.guestPort` | `integer` / `0` / 0..65535 | Guest が接続するローカルポート。0 は Host ヘルパーと同じポートを意味します。Live Share が Host のポートを別のローカルポートに転送した場合にだけ設定します。Host ヘルパーのポートが Guest ですでに使用中の場合、Live Share は別のローカルポートを選び、それを Guest の Live Share ビューにある共有サーバー一覧にだけ表示します（または "Live Share: Show Shared Servers" を実行します）。Host ヘルパーのポートに対応するエントリーを探し、その Guest ローカルポートをここに入力します。Live Share の転送機能は他のローカルサービスも動作する VS Code プロセス内で動き、ブリッジはそれらを探査しないため、再割り当てされたポートを自動で検出しません。 | ハンドシェイクの試行ごとに読み取られます。バインド待機中に入力した値は、再バインドなしで次の試行（約 2 秒後）に使われます。確立済みのバインドはそのポートを維持します。 |
| `host.idleTimeoutMinutes` | `integer` / `30` / 1..1440 | Host ヘルパーは、リクエストがないままこの分数が経過すると終了します。 | 次に起動するヘルパー。 |
| `host.handshakeTimeoutMinutes` | `integer` / `5` / 1..60 | hostBind が開始したバックグラウンドのハンドシェイクが、Host によるヘルパーポートの共有を待つ時間。hostBind 自体はその前に戻ります。期限後、hostStatus は `handshake.state: "failed"` と `handshake.code: "host_port_forward_required"` を示します。タイムアウト、Cancel、そのポート上の別サービスはチャネルを結果不明状態にしません。 | 次回の Host バインド。 |

Host 経路の仕組み：共有 RW 端末がフォアグラウンドの Host ヘルパーを一度起動します（Ctrl+C、端末を閉じること、セッション終了、アイドルタイムアウトで終了）。その後 Host はブリッジに表示されたポートで "Live Share: Share Server" を一度実行します。hostBind はヘルパーが待ち受けを始めるとすぐに戻ります（`handshake.state: "waitingForward"`）。ハンドシェイクはバックグラウンドで完了して hostStatus がそれを報告し、その間他の Host リクエストは `host_handshake_pending` を返します。以降のリクエストは、ヘルパーごとの token を使って転送ループバックポートを通ります。リクエストを端末に入力することはありません。

## 1 版限りで読み取る非推奨キー

0.3.0 で `terminal.*` キーの名前が変わりました。新しいキーが明示的に設定されていない場合、ブリッジは引き続き旧キーの User 値を読み取り、旧キーごとに一行を "Live Share Workspace Bridge Host" 出力チャネルに書き込みます。設定を書き換えることはないため、名前は自分で変更してください。

| 旧キー | 新キー |
|---|---|
| `terminal.enabled` | `host.enabled` |
| `terminal.name` | `host.terminalName` |
| `terminal.hostWorkspacePath` | `host.workspacePath` |
| `terminal.commandTimeoutMs` | `host.commandTimeoutMs` |
| `terminal.maxOutputCharacters` | `host.maxOutputCharacters` |

明示的に設定された新キーは、`false` であっても常に優先します。`host.transport` は削除されました。Host 経路は常に転送ポートを使います。保存済みの `sharedTerminal` 値は portForward として動作し、同じ出力チャネルに一行を記録します。その他の値は無視されます。

## 操作スイッチ

以下の各行は boolean、既定 true、scope machine で、ローカル IPC を再起動せずに後続の権限チェックに反映されます。これらは API の認可であり、データ種別や OS サンドボックスではありません。たとえば readBytes は、テキストの read が無効でもテキストのバイトを読み取れます。agent は別経路でユーザーの意図を迂回してはいけません。

| 設定（接頭辞省略） | 目的と安全 | Host 必要 |
|---|---|---|
| `permissions.list` | ディレクトリ一覧。 | 不要 |
| `permissions.read` | テキスト、一括、明示的なプロバイダーの読み取り。生バイトの制御ではありません。 | 不要 |
| `permissions.create` | 新規テキストファイル。save と、親がない場合は mkdir が必要です。 | 不要 |
| `permissions.write` | 保護付きの文書全体の置換。バイト／ファイルの上書きにも必要です。 | 不要 |
| `permissions.edit` | テキストの置換／一括編集。検証付きパッチの認可の一部でもあります。 | 不要 |
| `permissions.save` | 対象の保存。create/write/edit/renameSymbol/format に必要です。複数ファイルのトランザクションはありません。 | 不要 |
| `permissions.mkdir` | ディレクトリと暗黙の親作成。 | 不要 |
| `permissions.copy` | Host でのバイト保持ファイルコピー。上書きには write も必要です。 | 要 |
| `permissions.copyDirectory` | Host での新規ディレクトリへのコピー。マージ／再帰置換はしません。 | 要 |
| `permissions.move` | パスの移動／名前変更。上書きには write、親がない場合は mkdir が必要です。 | 不要 |
| `permissions.delete` | ファイルと空ディレクトリのみ。 | 不要 |
| `permissions.stat` | プロバイダーメタデータ／Host stat。生ハッシュには readBytes も必要です。 | 条件付き |
| `permissions.diagnostics` | 言語診断。空の結果はテスト結果ではありません。 | 不要 |
| `permissions.symbols` | 文書シンボル。 | 不要 |
| `permissions.workspaceSymbols` | ワークスペースの言語シンボル。保存済みファイルの網羅的な検索ではありません。 | 不要 |
| `permissions.definition` | 言語の定義。 | 不要 |
| `permissions.references` | 言語の参照。 | 不要 |
| `permissions.renameSymbol` | テキストのみの言語による名前変更／preview。save と対象の保護が必要です。 | 不要 |
| `permissions.format` | プロバイダーによる整形と対象の保存。 | 不要 |
| `permissions.search` | Host での保存済みファイル検索。明示的なスナップショットは限定的で、Host は不要です。 | 条件付き |
| `permissions.findFiles` | Host でのパス列挙。明示的なプロバイダースナップショットは限定的です。 | 条件付き |
| `permissions.applyPatch` | 検証付きの Host Git テキストパッチ。edit/create/move/delete がすべて確認されます。 | 要 |
| `permissions.readBytes` | Host のバイト／生ハッシュとダウンロードハンドルの権限。利用可否に従います。 | 要 |
| `permissions.writeBytes` | Host のバイト／アップロード。上書きには write と生ハッシュの保護が必要です。 | 要 |
| `permissions.largeTransfers` | 分割アップロード。writeBytes も適用されます。利用できないダウンロードを有効にするものではありません。 | 要 |
| `permissions.hostExec` | 任意の Host コマンドと poll/cancel/forget。他の 25 の操作スイッチもすべて true である必要があります。 | 要 |

## 特殊動作と非設定

- agent/host/transfer の設定変更（および非推奨の terminal.* キー）は Host バインドと Guest のジョブ／転送参照を無効化し、次の許可済み Host 呼び出しで再バインドします。ローカル IPC の instance/epoch の再起動、送信済みの子プロセスの停止、その元の期限の変更は行いません。旧ジョブは Host 側での確認が必要な場合があり、転送資源は確立済みの期限を保持します。IPC キーの変更は代わりにブリッジを再起動します。変更された SID／旧フィールドが現在使われていない場合も同様です。
- 権限を無効にしてもロールバックにはなりません。raw hostExec とそのジョブ制御には host.enabled と 26 の操作権限すべてが必要です。一つを無効にすると poll/cancel も利用できなくなることがありますが、子の上限付きタイムアウトは残ります。copy/write の上書きと暗黙の親作成には、追加の write/mkdir の条件があります。applyPatch は常に edit/create/move/delete を確認します。Host ディスクへの直接操作は文書の save 権限を使いません。
- readMany/providerRead は read を、searchSnapshot/searchResults は search を、findFilesSnapshot は findFiles を、hostStat は stat（ハッシュには readBytes も）を、hostJobPoll/Cancel/Forget は hostExec を共有します。転送 API は largeTransfers と、方向に応じて readBytes/writeBytes を共有します。Host の検索／コピー／パッチ／バイト／ジョブには host.enabled が必要で、スナップショット／言語／文書 API には不要です。largeTransfers で利用できない大容量ダウンロードを利用可能にすることはできません。
- 現在の実行時が読み取るリテラルの構成キーで、この公開 manifest 以外のものは見つかっていません。ipc.legacySidSnapshot は内部の globalState で、**設定ではありません**。hostExec の timeoutMs/waitMs と hostBind の hostWorkspacePath はリクエスト引数であり、Settings UI の項目ではありません。起動スナップショットの上限や、固定のローカル IPC／Host 応答／ハンドシェイクの待機時間は実装上の固定制限であり、架空の設定ではありません。
- ポリシーフラグは端末を開く／共有すること、Host の RW 認可の証明、結果不明の送信済み変更の解決を行いません。[IPC アクセス](IPC-SECURITY.ja.md)、[API](API.ja.md)、[起動診断](STARTUP-DIAGNOSTICS.ja.md)を確認してください。agent は拒否された設定を説明することはできますが、明示的な許可なしにそれを有効にしたり信頼を広げたりしてはいけません。
