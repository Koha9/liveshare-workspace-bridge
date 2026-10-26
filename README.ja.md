# Live Share Workspace Bridge v0.2

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | **日本語**

v0.2.2：**Configure IPC Access** は ownerOnly（既定）、allLocalUsers、安定 SID の selectedUsers を提供します。旧 true は既存の選択アカウントだけへ移行し、全員を自動許可しません。[IPC モード](docs/IPC-SECURITY.ja.md)を参照してください。Host 権限は独立です。

Windows のローカルブリッジを通じて、接続済みの VS Code Live Share ワークスペースを Codex から操作します。v0.2 は文書編集と、任意で有効にする検証済み Host RW PowerShell チャネルを組み合わせます。HTTP ポートや token のコピーは不要です。

## 機能

- バッファー／範囲の読み取り、一括編集、対象文書だけの保存と明示的な結果。
- Host ripgrep による内容検索とパス列挙。完了状態、終了コード、切り詰めを報告。
- Host 子プロセスのコマンド実行、stdout/stderr カーソル、タイムアウト、所有するプロセスツリーのキャンセル。
- Git で事前検証するテキストパッチ、参照検索、テキスト編集のみのシンボル名変更、言語サービスによる整形。
- バイトを保持する読み書き、ファイルコピー、新規ディレクトリへのコピー、SHA-256 付き分割アップロード。
- 英語の権限設定：agent 全体、操作別、連動する Host 端末アクセス。

再帰削除と複数ファイル保存の原子性は提供しません。Host 検索は保存済みファイルを対象とし、未保存バッファーを含みません。明示的なエディタースナップショットは不完全です。**大容量ダウンロードは本版では無効**です。小容量バイト読み取りと大容量アップロードは利用できます。

## 要件とインストール

Guest は Windows、VS Code、Live Share、Node.js が必要です。Host 機能には Windows Host で読み書き可能として共有した PowerShell と、Guest からの接続が必要です。検索には ripgrep、パッチには Git が必要です。Host の VS Code インストールから ripgrep を検出できます。常駐 Host agent は不要で、バインド時にメモリ上のセッションヘルパーを読み込みます。

確認済みの Python 3 実行ファイルでビルドします。標準ライブラリのみを使用します。

```powershell
$pythonExe = '<path-to-python.exe>'
& $pythonExe .\scripts\build.py
$vsix = Get-ChildItem .\dist\liveshare-workspace-bridge-*.vsix |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
code --install-extension $vsix.FullName
```

Guest ウィンドウの Profile にインストールし、必要に応じて再読み込みして Live Share に再接続します。既存のローカル変更を確認してから `skills/liveshare-workspace-bridge/` を Codex skills ディレクトリに配置し、`$liveshare-workspace-bridge` を使用します。

## 権限

**Live Share Workspace Bridge: Configure Agent Permissions** を実行するか、設定で `@ext:Koha9-Lee.liveshare-workspace-bridge` を検索します。設定名は英語のままです。

- **Allow Agent Access**：全体スイッチ。既定で有効。
- **Allow Shared Host Terminal Access**：既定で無効。有効にしても操作別権限が適用されます。
- 個別設定は読み取り、編集、保存、ファイル操作、検索、言語ツール、パッチ、バイト、アップロード、Host コマンドを制御します。
- 端末アクセスを無効にすると全 Host 操作の実効権限が無効になりますが、個別設定値は保持されます。Guest 操作にはそれぞれの権限が適用されます。
- 任意のコードは細かな制限を迂回できるため、raw Host コマンドには全操作権限が必要です。

ステータスバーは **Agent off**、**Guest only**、**Host allowed** を表示します。Host allowed は権限を表し、接続の検証成功を意味しません。設定は後続リクエストに即時反映されます。送信済み操作は取り消さず、子コマンドにはタイムアウトが残ります。

Host RW 端末がない場合、skill はユーザーに一度だけ開設と共有を依頼し、返答を待ちます。通常の Guest 端末を作成したり、代替端末を推測したり、拒否を回避するため設定を変更したりしません。未対応の手順は正確なパスと目的を示して協力を依頼し、依存作業を返答まで保留します。大容量ダウンロード、再帰削除、原子的保存、言語プロバイダー不足、未解決の編集競合が対象です。

## CLI

```powershell
node .\extension\cli.cjs instances
node .\extension\cli.cjs --instance '<id>' --epoch '<epoch>' --workspace 'vsls:/' --request '<request.json>'
node .\extension\cli.cjs upload --instance '<id>' --epoch '<epoch>' --workspace 'vsls:/' --input '<local.bin>' --path 'assets/file.bin'
```

一度選んだプロジェクトの instance/epoch/root を再利用します。固定バインドのリクエストに余分な info 確認は加えません。[使用方法](docs/USAGE.ja.md)と [API](docs/API.ja.md)を参照してください。

## 設計と制約

通常編集は文書バージョンを再利用し、関連変更をまとめて適用し、対象だけを保存します。成功後にプロバイダーの再読み取りや全文ハッシュは標準では行いません。Host バイト操作は Live Share テキストプロバイダーの非可逆なバイナリー経路を避けます。影響を受ける開いたバッファーだけを Host の正規化テキストダイジェストと照合します。バージョンの増加だけでは更新済みと判定せず、エディター全体を revert しません。

文書 EOL と Host の生バイトは別の保証です。パッチの改行は Host Git 設定に従います。検索は rg の無視規則を使い、VS Code の条件付き除外を完全には再現しません。ディレクトリコピーは新規宛先のみで、途中失敗があり得ます。既存宛先のマージや再帰置換は行いません。

名前付きパイプは既定で現在の Windows ユーザー専用です。明示的なローカルアカウント許可の範囲は前述の IPC 文書を参照してください。操作権限は任意の Host コードに対する OS サンドボックスではありません。Host 子プロセスは Windows Job Object を使い、タイムアウト／キャンセルは共有 PowerShell と分離した所有プロセスツリーを対象にします。アップロードの一時資源にはアイドル期限と整合性確認があります。

約 1.1 MB の実ダウンロードが繰り返し共有端末を停止させ、原因は未解決です。`transferOpenRead/transferRead`（CLI download を含む）は Host 送信前に `feature_unavailable` を返します。小分け読み取りの反復で迂回せず、アクセス可能なコピーをユーザーに依頼します。[検証記録](docs/VALIDATION-v0.2.ja.md)を参照してください。

## 開発

```powershell
npm test
npm run check
& $pythonExe .\scripts\build.py --check
& $pythonExe .\scripts\build.py --verify
```

npm 依存関係は不要です。ソースと skill を一緒に管理し、ビルド時に自己完結型クライアントを同期します。[開発](docs/DEVELOPMENT.ja.md)、[構成](docs/ARCHITECTURE.ja.md)、[文書一覧](docs/README.ja.md)を参照してください。ライセンス：[MIT](LICENSE)。
