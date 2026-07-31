# PyHiroba（ぱいひろば）

ブラウザだけで Python を学べる、日本の高校生・学校現場向けの学習環境です。
インストール・アカウント登録は不要で、書いたコードは利用者のブラウザ内で実行されます（サーバーに送信されません）。

公開URL: https://pyhiroba.weblab.t.u-tokyo.ac.jp/

## 仕組み

- Python の実行は [Pyodide](https://pyodide.org/)（WebAssembly）を使い、Web Worker 上で動かしています。重い処理でも画面が固まりません。
- すべてクライアント側で完結する静的サイトで、サーバーはありません（GitHub Pages で配信）。
- ビルド工程はなく、HTML/CSS/素の JavaScript のみで動きます。

## 使用ライブラリ

| ライブラリ | 用途 |
| --- | --- |
| Pyodide | ブラウザ内での Python 実行 |
| CodeMirror 5 | コードエディタ |
| marked | Markdown の表示 |
| MathJax | 数式（LaTeX）の表示 |
| DOMPurify | 表示前の HTML 無害化（XSS 対策） |

CodeMirror・marked・DOMPurify・MathJax は `vendor/` に同梱（自ホスト）しており、学校などの閉域網・フィルタ環境でも読み込めます。Pyodide のみ CDN（jsDelivr）から読み込み、Service Worker が初回ロード後にキャッシュします。ライセンスは [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) を参照してください。

## ファイル構成

```
index.html              ランディングページ（トップ。?gdrive= 等の旧共有リンクは /nb/ へ転送）
errors.html             日本語化対応エラーの一覧
materials.html          公開教材の一覧
guide-publish.html      自作教材の公開方法
setup.html              対応環境（対応ブラウザ・許可ドメインなど情報担当向け）
security.html           安心・安全への取り組み
terms.html              利用規約
404.html                独自404ページ（旧 /lp/ 配下のURLも転送）
nb/index.html           アプリ本体（ノートブック画面）
css/style.css           スタイル
js/
  theme.js              ダークモード切替（全ページ共通・head内で同期読み込み）
  app.core.js           グローバル状態・初期化・Worker との通信
  app.lessons.js        教材データ・デフォルトノート・ウェルカム画面
  app.io.js             .ipynb の読み書き・URL / Google Drive からの読み込み
  app.notebook.js       セル操作・描画・モーダル・テキスト/画像/スライド編集
  app.exec.js           Python 実行・出力表示・エラー/警告の日本語化
  pyodide-worker.js     Pyodide を Worker で動かす実行エンジン
sw.js                   Service Worker（初回ロード後のオフライン対応・帯域節約）
vendor/                 自ホストの外部ライブラリ（CodeMirror / marked / DOMPurify / MathJax）
lp/index.html           旧URL（/lp/）からトップへの転送ページ
sitemap.xml, robots.txt 検索エンジン向け
.github/workflows/      DOMPurify を毎週最新化する自動更新
ogp.png, favicon*       OGP画像・アイコン
```

JavaScript は役割ごとに分割し、`nb/index.html` で上から順に読み込みます（すべて同じグローバルスコープで動作します）。

## ローカルでの動作確認

静的ファイルを配信するだけで動きます。ビルドは不要です。

```
python -m http.server 8000
# ブラウザで http://localhost:8000/ を開く
```

## ライセンス

MIT License（[LICENSE](LICENSE)）。第三者ライブラリのライセンスは [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) を参照してください。
