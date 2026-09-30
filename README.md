# x-clean-ui

X の画面を簡略化する、PC ブラウザと iPhone Safari 共通の Userscript です。

返信・リポスト・いいね・表示数・ブックマーク・共有のボタンは一覧・詳細画面のどちらでも表示し、通常のボタン列と余白を維持します。一覧では返信・リポスト・いいね・表示・ブックマークの件数だけを隠します。ポストの詳細を開くと、そのポスト本体だけ返信数・いいね数・ブックマーク数を表示します。本体のリポスト数・表示数と、詳細画面の返信ポストの件数は隠したままです。本文・画像・動画やその再生ボタンには影響しません。

## インストール（初回のみ）

公開先: https://naoaki0.github.io/x-clean-ui/x-clean-ui.user.js

- PC: 上記 URL を Tampermonkey でインストールします。
- iPhone: Safari で上記 URL を開き、Userscripts 拡張のポップアップからインストールします。Userscripts のサイトアクセス権限を許可してください。
- GitHub Pages の初回公開には、リポジトリの Settings → Pages → Build and deployment → Source を **GitHub Actions** に設定する必要があります。

## 更新

`x-clean-ui.user.js` が唯一の編集元です。変更時にヘッダーの `@version` を上げて `master` に push すると、GitHub Actions がテスト後に `.user.js` とヘッダーだけの `.meta.js` を同じ Pages サイトへ公開します。公開ファイルを手作業で編集する必要はありません。

Tampermonkey はバージョンを使って更新を確認します。iOS Userscripts も `@updateURL` と `@downloadURL` に対応していますが、更新処理は完全な自動化が保証されておらず、ポップアップの更新通知から操作が必要な場合があります。手動で各端末にコードをコピーする必要はありません。

ローカルでの確認: `npm ci` → `npm test`。公開ファイルの生成: `npm run build:userscript`（`dist/` に出力）。
