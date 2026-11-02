# HANDOFF — 缶ログ・酒ログ
更新：2026-11-02 JST
引渡し元：Claude Code／次の担当：未指定
編集状態：辞書更新の仕組みを作成・辞書を更新済み（未コミット）
作業ルート：.（ローカル保存先は導入一覧を参照）
Gitブランチ：claude/canned-alcohol-app-review-jo7w7y
HEAD：3448398c0301b870f6764c1f589dbc1262ce4bc3（origin と一致）

## 現在の作業
- バーコード商品辞書（beer-save/beer-catalog.js）を公式サイトから集め直す仕組みを tools/catalog/ に作成し、実行した。
## 完了・未完了
- 完了：収集スクリプト（アサヒ・キリン・宝酒造は自動、サッポロは公式にJANがないため手作業扱い、サントリーは403、サンガリアは画像PDF）。使い方は tools/catalog/README.md。
- 完了：辞書 504→520件（アサヒ13・宝3を追加）。既存504件は1バイトも変えていない（revision一致が必要なため）。
- 未決定：サッポロ「麦とホップ」「GOLD STAR」が公式ではビール分類・カロリー変更。辞書へ反映するか未決定。
- 制約：キリンは改訂番号付きURLでしか開けない商品ページが79件あり、新商品を取りこぼす可能性あり（今回キリン新商品0件）。
- 未実施：定期実行（GitHub Actions等）、公開（gh-pages）、iOS版への反映。
## 次の具体的作業
1. 差分を確認してコミット（ユーザー確認後）。
2. サッポロ2商品の扱いを決める。必要なら定期実行の方式を決める。
## 変更ファイル・未コミット変更
- 変更：beer-save/beer-catalog.js（16件追加・autoUpdate更新）、docs/HANDOFF.md
- 追加：tools/catalog/（update_catalog.py, common.py, sources/*.py, README.md, .gitignore）
## 検証
- 今回：全社をキャッシュで再実行し、追加16・変更0・既存不変を確認。Web版で520件の読み込みと新旧JANの照合を確認。
- 今回：Simulatorで登録・記録・再起動後の保持・JSON保存の共有シートを確認。カメラ読み取りは未確認（実機のみ）。
- 注意：localhost:8765 は別作業（お遍路クエスト）のサーバーと重なることがある。127.0.0.1 を指定して確認した。
## 必要な参照先
- `tools/catalog/README.md`（実行方法・更新ルール）、`ios/README.md` の関連節。
