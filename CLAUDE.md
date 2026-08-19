# CLAUDE.md

PyHiroba（ぱいひろば）— ブラウザだけで Python を学べる、日本の高校生・学校現場向けの静的サイト。
技術構成・ファイル構成は [README.md](README.md) を参照。

## 【最重要】デプロイ方針（必ず守る）

1. 変更・改善は、必ず **開発環境（`funakoshi-takehiro/pyhiroba`）へ先にデプロイ**する
2. **運営者（ユーザー）が開発環境の実サイトで確認**する
3. **運営者の明示的な許可があった場合のみ**、本番（`matsuolab/pyhiroba`）に反映してよい

例外は次の 1 件のみ。それ以外に例外はなく、本番リポジトリ・本番の設定（Pages・CNAME・ワークフロー等）には、許可なく一切触れないこと。

### 例外（この1件のみ）: DOMPurify の自動更新

`update-dompurify.yml` による DOMPurify（XSS 無害化ライブラリ）の週次自動更新は、本方針の唯一の例外として、機械検証つきでの本番への自動反映を認める（2026-08-07 運営者決定）。

- 理由: 無害化ライブラリは更新の鮮度そのものが防御であり、人の承認待ちで更新が滞る方がリスクが大きいため。
- 条件: ワークフロー内の機械検証 — 冷却期間（npm 公開から 72 時間）・二重照合（npm と jsDelivr の SHA-256 一致）・自己テスト（無害化動作の確認）・事後通知（Issue 起票）— を必ず維持する。**検証を緩める・外す変更は不可**。
- この例外を他のライブラリ・他の自動更新へ拡大しない。

## 二環境の構成

同一の `main` を 2 つのリポジトリで運用し、Pages のデプロイ方式の違いでドメイン競合を回避している。

| | 本番 | 開発（ステージング） |
| --- | --- | --- |
| リポジトリ | `matsuolab/pyhiroba`（非公開） | `funakoshi-takehiro/pyhiroba`（public） |
| URL | https://pyhiroba.weblab.t.u-tokyo.ac.jp/ | https://funakoshi-takehiro.github.io/pyhiroba/ |
| Pages 方式 | legacy branch-deploy（main） | GitHub Actions 方式（`deploy-pages.yml`） |
| CNAME | `main` の `CNAME` でドメイン設定 | Actions 方式は CNAME を無視＋runner 上で削除 |
| `deploy-pages.yml` | 条件により常に skip | main への push で自動デプロイ |
| `update-dompurify.yml` | 毎週月曜に自動更新（機械検証つき） | 手動実行（dry_run 検証）のみ可 |

- 両ワークフローは `if: github.repository == ...` の許可リストで相互排他になっている。この条件を変更しないこと。
- `404.html` の `siteBase()` が github.io（`/pyhiroba/` 配下）と独自ドメイン（`/` 直下）の両対応を担う。パスをハードコードする変更は両環境で確認すること。

## 変更の流れ

1. 作業ブランチで開発・コミット
2. 開発 `main` へ反映 → Actions が github.io へ自動デプロイ
3. 運営者が開発 URL で動作確認
4. 運営者の明示的な許可を得てから、本番 `main` へ反映

注意: `update-dompurify.yml` は本番のみで自動コミットするため、本番と開発の履歴は分岐しうる。
本番へ反映する前に、必ず本番 `main` の最新状態を確認すること。

## library-hiroba（`ui` と `ai`）の同梱

ノートブックの `ai` と UI 部品は、[library-hiroba](https://github.com/funakoshi-takehiro/library-hiroba)
という 1 つの Python パッケージにまとまっている。生徒はこう書く（Colab でも同じ）:

```python
from library_hiroba import ai, ui
```

- **`py/library_hiroba/` に同梱**している（PyPI にもあるが、学校の閉域網では `!pip` が通らないため、
  同梱して `import` だけで使えるようにしている）。
  配布元の `src/library_hiroba/` の**複製で、改変しない**。版を上げるときは配布元から取り直し、
  `THIRD-PARTY-LICENSES.md` の版数も直す（バイト一致は検証スクリプトで確認できる）
- 取得は `js/pyodide-worker.js` の `installBundle()` が行う。**`lockdownNetwork()` より前**に
  実行することで、`NET_ALLOW_PREFIXES` を広げずに済ませている。**この順序を入れ替えないこと**
- ファイル一覧は `js/pyodide-worker.js` の `BUNDLE_FILES`。**ファイルが増減したらここも直す**
  （ビルド工程が無いため。版数は同ファイルの `?v=` を流用している）
- `ui.form()` の入力は、`hui-submit` / `hui-html` のやり取りで Python に戻る。
  **イベント登録は本体（`bindHuiForms`）だけが行い、出力の HTML は目印を持つだけ**。
  返ってきた HTML も通常の出力と同じ `sanitizeHtml()` を通す（設定は緩めない）

### 使えるモデルを調べる（運営者向け）

試験公開ページ（`ai.html`）は廃止したため、専用の画面は無い。
モデルを追加・変更したら、`/nb/` を開いて開発者コンソールで実行して確かめる。

```js
const ai = await import('../js/ai.js');
(await ai.aiCheckModels()).forEach(r => console.log(r.ok ? '○' : '×', r.id, r.detail));
```

重みの実在・各精度の実サイズ・コミットIDが出る。**推測で `AI_MODELS` に足さないこと**
（実在しないモデルは、数百MBを取りにいってから失敗する）。

### モデル名は library-hiroba と本体で揃える

library-hiroba は利用者の書いた名前を**本体側の名前に変換して**渡す。
`js/ai.js` の `AI_MODELS` と、あちらの `_ai.py` の `MODELS` は必ず対応させること
（片方だけ増やすと「許可されていません」で落ちる）。
Qwen3 系は答えの前に `<think>…</think>` を書くため、`AI_THINKING_KEYS` に入れて
`enable_thinking: false` を渡し、残りも取り除く。

### 能力の目印（`js.pyhirobaFeatures`）

`js/pyodide-worker.js` が `self.pyhirobaFeatures = 'forms,ai,ai-probe'` を置いている。
library-hiroba は Python から `js.pyhirobaFeatures` として読み、
「この本体でフォームが動くか」を判定する。

これが無かったころ、あちらは `js.pyhirobaAsk` の有無（＝AI の橋があるか）で
代用するしかなく、`ai.talk().form()` が**動く環境でも「Colab でだけ動きます」と
表示していた**（library-hiroba 0.5.0 / 0.5.1）。同じ食い違いを繰り返さないための目印。

**実装より多くを名乗らないこと。** 名乗った機能が無いと、
「動くはずのものが動かない」という分かりにくい壊れ方になる。
逐次出力に対応したら `ai-stream` を足す（`AI_ASK_KINDS` への追加とセットで行う）。
名乗りと実装のずれは `bundletest.py` が機械で捕まえる。

## 残っている作業（2026-08-10 時点）

`ai` の移設・`ui` の同梱・`ui.form()` の往復は完了し、運営者が実機で確認済み
（フォームから AI に聞くチャットまで動作）。library-hiroba は PyPI に公開済み
（`library-hiroba` 0.6.0）で、Colab では `%pip install library-hiroba` が使える。

**PyPI にあっても同梱はやめない。** 学校の閉域網では `!pip` が通らないため、
`py/library_hiroba/` に置いて `import` だけで使えるようにしておく必要がある。
同梱物が公開物とバイト一致していることは検証スクリプトで確認できる。

| 残り | 内容 |
| --- | --- |
| `revision` の固定 | いまは全モデル `'main'`。運営者の確認で取得したコミットIDへ固定したい（配布元の差し替えを防ぐため）。ただし固定すると端末のキャッシュが効かなくなり再取得になるので、様子を見て行う |
| 同梱版の同期 | **0.6.0 に同期済み**（`ai.embed` / `ai.search` 入り）。0.5.0 / 0.5.1 の誤警告（PyHiroba でも動くのに「Colab でだけ動きます」）は、あちらが `host_supports()`（＝`js.pyhirobaFeatures` を見る）に直した 0.5.2 以降で解消。本体が使う口（`get_form` / `pending_html` / `submit` / `data-hui-*`）は 0.4.0 から不変。**残**: 実機で `from library_hiroba import ai` の import（`_ai` の読み込み時に `threading.Lock()` が走る）と、`ai.embed` / `ai.search` の通し確認 → 本番反映 |

書けたところから返す仕組み（`ai-ask-start` / `ai-ask-next`）は**任意**で、未実装。
未対応なら library-hiroba が自動的に `ai-ask`（全文返し）に落ちるため、動作に支障はない。

### 廃止したもの

- **`ai.html`（AI体験ページ・試験公開）** — /nb/ から同じことができるようになったため削除
  （2026-08-09）。未リンク・noindex で外には出していなかった。
  中身が要るときは `git show df6d049:ai.html`。
  そこにあった「この端末には重すぎるかもしれません」の警告は、
  /nb/ の読み込み確認モーダルへ移してある

## 開発の約束事

- **ビルド工程なし**。HTML / CSS / 素の JavaScript のみ。`js/*.js` は `nb/index.html` の読み込み順に依存する（すべて同一グローバルスコープ）。
- **キャッシュ版数の規律**: CSS / JS を変更したら、参照側 HTML の `?v=` を全ページ分更新し、`sw.js` の `VERSION` も更新する（更新漏れは古い資産の固着につながる）。
- **Pyodide のバージョンは 4 ファイル連動**。変更時は必ず同時に更新する:
  - `nb/index.html`（`<script>` タグの URL と SRI ハッシュ）
  - `js/pyodide-worker.js`（`importScripts` と `indexURL` 2 箇所）
  - `js/app.core.js`（`pyodideIndexURL`）
  - `sw.js`（`PYODIDE_HASHES` の各 SHA-256）
- **vendor/ は自ホスト方針**（学校の閉域網・フィルタ環境対応のため）。新規の外部 CDN 追加はしない。外部送信先が増える変更は、`terms.html` 第9条（外部送信）と `setup.html` の許可ドメイン表の更新をセットで行う。
- **セキュリティ不変条件**（緩める変更は不可）:
  - 教材 Markdown の表示は `sanitizeMarkdownHtml()`、実行出力は `sanitizeHtml()` / `escHtml()` を必ず通す
  - Worker の外向き通信封鎖（`js/pyodide-worker.js` の `NET_ALLOW_PREFIXES`）を維持する
  - `nb/index.html` の CSP・Pyodide の SRI を維持する
- コミットメッセージは日本語。件名＋本文に経緯を書く（既存の慣習に合わせる）。

## Panel / Bokeh（グラフ・UI 部品）

セル最終式に Panel / Bokeh のオブジェクトを返すと、インタラクティブな UI として描画する
（`import panel` / `import bokeh` を検出して部品を取得。第三者提供のパッチを 2026-08-18 に反映）。
`ui.form()`（送信ボタン方式）では作れない「スライダーを動かすとグラフが変わる」型の教材向け。

- 描画は **`js/app.rich-output.js`**。ブラウザ側 UI は **sandbox iframe**（`allow-scripts` のみ・
  `allow-same-origin` なし＝opaque origin）に隔離し、PyHiroba 本体 DOM・localStorage・
  全外部通信から切り離す。iframe 自身の meta CSP（`connect-src 'none'` 等）と、親の
  `default-src 'self'`（外部への遷移を捕捉）で二重に囲う。**この隔離を緩めないこと**
  （`allow-same-origin` を足す・親 CSP に `frame-src` で外部を許すのは不可）
- Python 側（`js/pyodide-worker.js` の `_rich_safety_problem` / `_rich_inspect_document`）で
  CustomJS / ReactiveHTML 等の任意 JS 経路をブロックしている。**この検査を外さないこと**
- **`cdn.holoviz.org` は Panel/Bokeh wheel のための例外的な許可先**（`NET_ALLOW_PREFIXES`）。
  vendor 自ホスト方針の例外として運営者が許可（2026-08-18）。この例外を他へ拡大しない。
  BokehJS / panel.min.js は既存の `cdn.jsdelivr.net` から取る
- 初回取得の前に、`js/app.exec.js` の `confirmRichDownloadIfNeeded()` が確認モーダルを出す
  （AI モデルと同じ作法。閉域網・従量課金の学校で不意の一斉ダウンロードを防ぐ）
- 版は **Panel 1.5.5 / Bokeh 3.6.3** に固定（1.9 系は fastapi を要し Pyodide で動かない）

## ローカル検証

```
python -m http.server 8000
# http://localhost:8000/ （LP） / http://localhost:8000/nb/ （アプリ本体）
```
