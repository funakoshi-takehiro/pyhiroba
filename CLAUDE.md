# CLAUDE.md

PyHiroba（ぱいひろば）— ブラウザだけで Python を学べる、日本の高校生・学校現場向けの静的サイト。
技術構成・ファイル構成は [README.md](README.md) を参照。

## 【最重要】デプロイ方針（必ず守る）

1. 変更・改善は、必ず **開発環境（`funakoshi-takehiro/pyhiroba`）へ先にデプロイ**する
2. **運営者（ユーザー）が開発環境の実サイトで確認**する
3. **運営者の明示的な許可があった場合のみ**、本番（`matsuolab/pyhiroba`）に反映してよい

例外はない。本番リポジトリ・本番の設定（Pages・CNAME・ワークフロー等）には、許可なく一切触れないこと。

## 二環境の構成

同一の `main` を 2 つのリポジトリで運用し、Pages のデプロイ方式の違いでドメイン競合を回避している。

| | 本番 | 開発（ステージング） |
| --- | --- | --- |
| リポジトリ | `matsuolab/pyhiroba`（非公開） | `funakoshi-takehiro/pyhiroba`（public） |
| URL | https://pyhiroba.weblab.t.u-tokyo.ac.jp/ | https://funakoshi-takehiro.github.io/pyhiroba/ |
| Pages 方式 | legacy branch-deploy（main） | GitHub Actions 方式（`deploy-pages.yml`） |
| CNAME | `main` の `CNAME` でドメイン設定 | Actions 方式は CNAME を無視＋runner 上で削除 |
| `deploy-pages.yml` | 条件により常に skip | main への push で自動デプロイ |
| `update-dompurify.yml` | 毎週月曜に自動コミット＆push | 条件により常に skip |

- 両ワークフローは `if: github.repository == ...` の許可リストで相互排他になっている。この条件を変更しないこと。
- `404.html` の `siteBase()` が github.io（`/pyhiroba/` 配下）と独自ドメイン（`/` 直下）の両対応を担う。パスをハードコードする変更は両環境で確認すること。

## 変更の流れ

1. 作業ブランチで開発・コミット
2. 開発 `main` へ反映 → Actions が github.io へ自動デプロイ
3. 運営者が開発 URL で動作確認
4. 運営者の明示的な許可を得てから、本番 `main` へ反映

注意: `update-dompurify.yml` は本番のみで自動コミットするため、本番と開発の履歴は分岐しうる。
本番へ反映する前に、必ず本番 `main` の最新状態を確認すること。

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
