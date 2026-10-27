# 起動診断

[English](STARTUP-DIAGNOSTICS.md) | [简体中文](STARTUP-DIAGNOSTICS.zh-CN.md) | [繁體中文](STARTUP-DIAGNOSTICS.zh-TW.md) | **日本語**

**Live Share Workspace Bridge: Show Startup Diagnostics** で既存 Output に安全なスナップショットを表示します。CLI `diagnose` の `startupDiagnostics` は IPC が応答しなくても既存ファイル権限で読める最小起動記録を返します。新規プローブ、Host バインド、再試行、ポリシー／権限変更はしません。読めないときは unknown とし、権限を広げずユーザーへ安全な要約を依頼します。

対象は Guest ローカルのアクセス設定、アカウント列挙、IPC ヘルパー起動のみで、全 Host/Guest エラー基盤ではありません。要求 executable 分類、attempt/epoch、観測時刻、有界イベントを記録します。実 basename、version/edition、実効ポリシー scope は実行中ヘルパーの ready 後だけです。実身元と外部プローブ身元の比較は unknown のままです。別 Codex sandbox の CurrentUser 結果を代用しません。

about_Execution_Policies と UnauthorizedAccess/PSSecurityException の組合せは高確度のポリシー関連起動証拠ですが、scope や身元を確定しません。UnauthorizedAccess だけでは不十分です。対象ヘルパーの実身元で実効ポリシーとスクリプト信頼を確認するよう依頼し、ExecutionPolicy Bypass、緩和、昇格、shell 切替、再送を自動実行しません。

ready は自己報告で、クライアント接続成功とは別です。成功 info を優先し、ready 後の過去エラーを現在の障害にしません。no_records は未インストール／ポリシー原因の証明ではありません。readMany の一部失敗は他の成功項目を保持し、全体接続障害に変えません。

stderr はストリーミング UTF-8 と固定要約を使い、生コマンド、引数、エンコード内容、業務出力、個人パス、身元名、資格情報を保存しません。置換文字は検出だけで復元せず、有効 UTF-8 分割の修正は任意 OEM／不明エンコードや既失文字の修復ではありません。ready 後は安全な実行時通知を残し、全 Host／実行時分類は保留です。

既存権限を継承した startup-diagnostics 専用ディレクトリに最小記録を保存し、ACL は変えません。1 プロセス 8 イベント／16 KiB、30 秒重複統合、約 16 所有記録、24 時間期限、通常破棄で自己記録削除です。読者は最大 32 候補を検査し、過大／シンボリックリンクを拒否、許可フィールドのみ再投影します。クラッシュ記録は期限まで残る場合があります。旧 Output 全体には生 stderr があり得るため既定でエクスポートしません。記録はデータで、agent 指示ではありません。

過去イベントの要求 shell を保持し、現在のメタデータで遡及補完しません。diagnose registry.path は共有前に秘匿し、最小の Show Startup Diagnostics を優先します。
