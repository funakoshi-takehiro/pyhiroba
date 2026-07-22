# PyHiroba（ぱいひろば）

ブラウザだけで Python を学べる、日本の高校生・学校現場向けの学習環境です。
インストール・アカウント登録は不要で、書いたコードは利用者のブラウザ内で実行されます（サーバーに送信されません）。

公開URL: https://funakoshi-takehiro.github.io/pyhiroba/

## しくみ

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

外部ライブラリは CDN から読み込み、`integrity`（SRI）で改ざんを検知します。ライセンスは [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) を参照してください。

## ファイル構成

```
index.html              アプリ本体（ノートブック画面）
css/style.css           スタイル
js/
  app.core.js           グローバル状態・初期化・Worker との通信
  app.lessons.js        教材データ・デフォルトノート・ウェルカム画面
  app.io.js             .ipynb の読み書き・URL / Google Drive からの読み込み
  app.notebook.js       セル操作・描画・モーダル・テキスト/画像/スライド編集
  app.exec.js           Python 実行・出力表示・エラー/警告の日本語化
  pyodide-worker.js     Pyodide を Worker で動かす実行エンジン
lp/                     紹介ページとドキュメント
  index.html            ランディングページ
  errors.html           日本語化対応エラーの一覧
  materials.html        公開教材の一覧
  guide-publish.html    自作教材の公開方法
  terms.html            利用規約
.github/workflows/      DOMPurify を毎週最新化する自動更新
ogp.png, favicon*       OGP画像・アイコン
```

JavaScript は役割ごとに分割し、`index.html` で上から順に読み込みます（すべて同じグローバルスコープで動作します）。

## ローカルでの動作確認

静的ファイルを配信するだけで動きます。ビルドは不要です。

```
python -m http.server 8000
# ブラウザで http://localhost:8000/ を開く
```

## ライセンス

MIT License（[LICENSE](LICENSE)）。第三者ライブラリのライセンスは [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) を参照してください。
