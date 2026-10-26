# IPC 接続の三つのモード v0.2.2

[English](IPC-SECURITY.md) | [简体中文](IPC-SECURITY.zh-CN.md) | [繁體中文](IPC-SECURITY.zh-TW.md) | **日本語**


## モードと範囲

**Live Share Workspace Bridge: Configure IPC Access** または英語の User 設定 `liveshareWorkspaceBridge.ipc.accessMode` を使います。明示 User 値のみを認可に使い、ワークスペース値や拡張の既定値で信頼を拡大しません。

| モード | ブリッジ所有者以外への許可 |
|---|---|
| ownerOnly | なし。公開版の既定です。 |
| allLocalUsers | 現在のローカル SAM ユーザー全員。無効アカウントの既存プロセスも含み得ます。Everyone、Authenticated Users、ローカルグループ、ドメインユーザーではありません。 |
| selectedUsers | ipc.selectedUserSids の正確な SID が現在のローカルユーザーとして存在する場合のみ。 |

所有者は常に保持し、VS Code 自体がドメインユーザーでも同様です。追加許可はローカルアカウントだけです。全モードはリモート接続を拒否し、同じ Windows セッションを要求します。session ID の照合であり、別の run-as トークンに同一 logon SID があるという保証ではありません。ドメインコントローラーでは追加ユーザー列挙を拒否し、ドメイン SAM をローカルとして扱いません。

許可アカウントの全プロセスを信頼し、Codex／一つのタスクに限定しません。呼び出しは Codex ファイルシステムサンドボックス外で、agent／操作権限に従います。Host／terminal は独立しており本設定は有効化しません。terminal.enabled が既に true で他の条件も満たすと、許可プロセスは Host コマンドも実行し得ます。範囲拡大の確定前に警告します。

選択画面は現在名と SID を表示し、名前でなく SID を保存します。改名後も許可は維持し、削除 SID は利用不可として残し、同名で再作成された新 SID を自動許可しません。不正／既知グループ／非ローカル SID は ipc.selectionIssues へ報告し拒否します。画面を開くだけ、またはキャンセルでは設定を変えません。

allLocalUsers はブリッジ起動時の SAM スナップショットです。新規アカウントは再起動後に含めます。アカウント作成／有効化／改名、マシン／ドメインポリシー、資格情報、ネットワーク割当は変更しません。

## 旧設定の移行

新モード未指定で v0.2.1 ipc.allowCodexSandboxClients が true の場合、初回は既存の二つの旧名だけを解決し、SID をキャッシュして ipc.selectedUserSids と selectedUsers を保存します。allLocalUsers にはしません。その後は名前を再解決しません。不在アカウントを推測で置き換えず、空なら追加許可なしです。旧ブールに過去の SID はないため、初回前に削除／再作成された履歴は復元できません。不明なら移行計画／現在の身元を確認します。

明示モード（ownerOnly も含む）が優先します。旧 false／未指定は ownerOnly のままです。曖昧な手編集 SID や観測した同時変更を上書きしません。旧ブールは互換用に残しますが、新モードがあれば v0.2.2 は無視します。旧版で実行中のウィンドウは再読み込みまで旧ルールを使い、新モードで制御できません。

移行は User 設定を書きます。変更はブリッジを再起動して instance/epoch を変えるため再検出が必要です。VS Code の再読み込みや Host 有効化、送信済み効果の取り消しはしません。結果不明の変更を再送しません。インストールには別途ウィンドウ／宿主再読み込みと Live Share 再接続が必要な場合があり、既存接続へ影響する前に配備承認を得ます。

## 診断と実装

```powershell
node "<client>" diagnose
node "<client>" instances
```

diagnose は登録と info の読み取りのみで Host バインドや共有ファイル書き込みを行いません。ready、partial、no_records、no_shared_workspace、access_denied、unavailable、invalid_registry を区別します。古い／拒否された他記録と正常な対象は共存できます。EPERM/EACCES を未インストールと解釈せず、モードと SID を確認します。自動拡大、sandbox 解除、allLocalUsers の自動選択はしません。

ローカル NetUserEnum／NetUserGetInfo とマシン役割確認で SAM を列挙します。明示 DACL、リモート拒否、セッション照合、一つの FIRST_PIPE_INSTANCE、要求上限と応答排出を維持します。クライアント偽装、HTTP、token コピーはありません。[v0.2.2 検証](VALIDATION-v0.2.2.ja.md)で模擬／実アカウント／配備待ちを区別します。
