# HANDOFF — 缶ログ・酒ログ
更新：2026-11-05 JST
引渡し元：Claude Code／次の担当：未指定
編集状態：集計画面の推移グラフを追加（未コミット・未公開）。iOS版はビルド1をアップロード済みで、グラフは未収録（審査は未申請）
作業ルート：.（ローカル保存先は導入一覧を参照）
Gitブランチ：claude/canned-alcohol-app-review-jo7w7y
HEAD：7707840（origin と一致）。gh-pages：b42c1e5（版 2026-11-03-ux・辞書522件）

## 現在の作業
- 集計画面の推移グラフ（飲んだ分のグラフ化。残りの案は種類の内訳、飲み方の傾向）。
## 完了・未完了
- 完了：`beer-core.js` に `trend`・`weekStart` を追加。棒の値は `aggregate` と同じ計算で、集計の数字と一致する。
- 完了：集計画面に「推移」カード。今週・今月は日別、今年・全期間は月別（36か月を超えると年別）。本数・純アルコール・金額を切替。今日では非表示。棒を押すと値を表示、未選択時はいちばん多い棒を表示。
- 完了：版 2026-11-05-trend（5か所）。log.html は index.html と同一内容に同期。外部ライブラリなし。
- 完了（前回）：Bundle ID com.hijikilabo.kanlog、Team A56C7H79Z6、1.0（ビルド1）をアップロード。ITSAppUsesNonExemptEncryption=NO。
- 既存：辞書522件公開済み。毎月のActionsは gh-pages 側。サントリーは手作業。
## 次の具体的作業
1. 差分確認のうえ、コミット・公開は確認を取ってから行う。
2. iOS版へ入れるときはビルド番号を上げて再アーカイブ・アップロードする。
3. 12/1 の自動実行の結果を確認する。
4. App Store Connect でビルドの処理完了を確認し、TestFlight で実機のカメラ読み取りと新しい操作を確認する。審査の申請はユーザーの指示があるまでしない。
## 変更ファイル・未コミット変更
- 未コミット：beer-save の beer-core.js、kanlog-app.js、kanlog.css、index.html、log.html、sw.js、kanlog-maintenance.js、kanlog-release.json、docs/HANDOFF.md
- gh-pages b42c1e5 は版 2026-11-03-ux のまま（グラフ未公開）
## 検証
- 今回（Node）：今週・今月・今年・全期間で、棒の合計が `aggregate` の本数・純アルコール・金額・未確認数と一致。
- 今回（Web・スマホ幅・試験データ）：期間ごとの棒の数と目盛り、切替、棒のタップ、今日で非表示、本数だけの記録の表示、はみ出しなしを確認。マウス移動とフォーカスは合成イベントで確認（実機の操作は未確認）。
- 既存：照合テスト10件全OK、Actions手動実行成功。アップロードは Upload succeeded まで確認、ビルドの処理完了は未確認。カメラ読み取りは未確認（実機のみ）。
## 必要な参照先
- `tools/catalog/README.md`、`ios/README.md` の関連節。
