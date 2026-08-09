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

## 【一時的】AI 部分を library-hiroba へ移設中（2026-08-09〜）

ノートブックの `ai`（`from pyhiroba import ai`）と、UI 部品ライブラリ
[ui-hiroba](https://pypi.org/project/ui-hiroba/) を、**`library-hiroba` という 1 つの
Python パッケージにまとめる**ことが決まった（2026-08-09 運営者決定）。

- 実装は **`funakoshi-takehiro/ui-hiroba` 側**で行う（同リポジトリを `library-hiroba` へ改名）
- 目標の書き方: `from library_hiroba import ai, ui`（PyHiroba でも Colab でも同一）
- **PyPI への公開はまだしない**（運営者の合図待ち）
- リポジトリは分けたまま。統合パッケージは ui-hiroba を依存として呼ぶ

### 移設が終わるまで消さないもの

| 対象 | 消せない理由 | 消してよくなる時点 |
| --- | --- | --- |
| `js/pyodide-worker.js` の `PYTHON_SETUP_CODE` 内 `_Ai` クラス | **/nb/ の AI がいま動いている実体**。消すと機能が止まる | `library_hiroba` を同梱し、`import library_hiroba` に置き換えたあと |
| `py/pyhiroba.py` | 移設元として ui-hiroba 側へ引き継ぎ済み。先方が移し終える前に消すと引き継ぎが成立しない | ui-hiroba 側で `_ai.py` への移設が完了したあと |

### 本体側に残っている作業（ui-hiroba 側の完了後）

1. `library_hiroba` と `ui_hiroba` を `py/` に同梱し、`!pip install` なしで import できるようにする
   （閉域網の学校対応。**`lockdownNetwork()` は `init()` の最後に呼ばれる**ため、
   同梱ファイルの取得を封鎖前に済ませれば `NET_ALLOW_PREFIXES` を広げずに実現できる）
2. `PYTHON_SETUP_CODE` の `_Ai` を削り、`import library_hiroba` に置き換える。
   互換のため `sys.modules['pyhiroba'] = library_hiroba` は残す（既存の教材を壊さないため）
3. `py/pyhiroba.py` を削除し、Colab の案内を `!wget` から `%pip install library-hiroba` に変える

### 確認済みの事実（再調査は不要）

- ui-hiroba の出力は、`sanitizeHtml()`（DOMPurify 3.4.12）を **1 文字も削られずに通る**。
  同じ HTML は教材用の `sanitizeMarkdownHtml()` では `<style>` が除去される。
  つまり **無害化の設定を緩める必要はない**（9 部品で実機確認済み）
- ui-hiroba は **標準ライブラリのみに依存**（5 ファイル・46KB）。Pyodide でそのまま動く
- PyPI の `library-hiroba` は未使用で取得可能

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

## ローカル検証

```
python -m http.server 8000
# http://localhost:8000/ （LP） / http://localhost:8000/nb/ （アプリ本体）
```
