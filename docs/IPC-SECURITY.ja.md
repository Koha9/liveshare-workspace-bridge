# IPC アクセスと移行

[English](IPC-SECURITY.md) | [简体中文](IPC-SECURITY.zh-CN.md) | [繁體中文](IPC-SECURITY.zh-TW.md) | **日本語**


英語 User 設定と **Live Share Workspace Bridge: Configure IPC Access** を使います。明示 User 値だけで信頼を決め、workspace／拡張既定値による拡大は認めません。

| モード | 所有者以外の許可 |
|---|---|
| ownerOnly | なし。公開版既定。 |
| allLocalUsers | 現在のローカル SAM ユーザー。無効アカウントの既存プロセスを含み得ます。Everyone、グループ、全ドメインユーザーではありません。 |
| selectedUsers | ipc.selectedUserSids と一致する現ローカルユーザーのみ。 |

所有者はドメインユーザーでも保持し、追加許可はローカルのみです。リモート拒否、同一 Windows session ID を要求します。DC での追加列挙は拒否し、全ローカル一覧は起動時更新です。アカウント作成／監視はしません。

許可アカウントの全プロセスを信頼し、Codex の一タスクではありません。呼出しは Codex ファイルシステム沙箱外で、agent／操作権限に従います。Host は独立し、有効で条件が合えば Host コマンドも可能です。範囲拡大前に警告し、自動的な広いモードへの切替はしません。

画面は現在名を表示し SID を保存します。改名は保持、削除／同名再作成は非継承。不正／非ローカル／不在 SID は報告して拒否し、取消は無変更です。

## 互換移行

新モード未指定で旧 ipc.allowCodexSandboxClients=true なら、最初に既存 CodexSandboxOffline/Online のみ解決し SID をキャッシュ、ipc.selectedUserSids と selectedUsers を保存します。allLocalUsers にはしません。固定後は名前で再解決せず、不在は追加許可なしです。初回前に削除再作成された過去 SID は旧ブールで復元できず、不明なら確認します。

明示新モードが優先し、旧 false／未指定は ownerOnly。曖昧な手編集や観測した同時変更は上書きしません。旧ブールは残しますが明示モード後は無視します。旧版ウィンドウは更新／再読込まで旧規則です。

操作権限は後続要求に即時適用します。IPC 信頼変更／移行は User 設定を書きブリッジを再起動するため instance/epoch を再検出します。必要な配備許可を得て依存作業を保留します。Host 有効化、アカウント／資格情報作成、ACL／実行ポリシー変更はせず、送信済み効果も戻しません。

## 設計上の境界

明示 SID、リモート拒否、同セッション、単一持続サーバー、入力／応答上限を使い、DC の SAM は列挙しません。全 Windows ポリシー／遠隔／アカウントでの検証保証ではありません。[起動診断](STARTUP-DIAGNOSTICS.ja.md)を参照してください。
