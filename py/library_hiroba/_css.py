"""library_hiroba の CSS 定義。

デザインは PyHiroba 本体（css/style.css の V3 デザイン）に合わせている:
ティールのブランドカラー、Zen Kaku Gothic New、角丸14px、ソフトシャドウ、
絵文字を使わない記号表現。

設計上の不変条件:

- すべてのセレクタは ``hui-`` 接頭辞（ルートは ``.hui``）で名前空間化する。
  PyHiroba では全セルの出力が 1 つの document を共有するため、ホストページの
  スタイルを汚さない・汚されにくいことが必須。
- 内容は完全に静的な文字列。同じ ``<style>`` ブロックがセルごとに重複挿入
  されても表示が変わらない（冪等）。
- JavaScript・イベント属性は一切使わない。インタラクションは CSS のみ
  （``:checked``・``<details>``）。``:has()`` はコア機能では使わず、
  ``@supports`` ガード付きの装飾強化に限る。
- PyHiroba は出力を ``.output-html`` の中に入れるため、そこで定義済みの
  スタイル（テーブルの等幅フォント・右揃えなど）に負けないよう、競合する
  セレクタは ``.hui`` を前置して詳細度を上げる。
"""

import re


def _minify(css: str) -> str:
    """CSS から余白とコメントを落とす。

    部品は出力ごとに CSS を同梱する（下地に依存せず表示するための設計で、
    Colab は出力ごとに別の iframe になるため省略できない）。表示を変えずに
    減らせる分だけ、読み込み時に一度だけ削る。
    """
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.DOTALL)
    css = re.sub(r"\s*\n\s*", "\n", css)
    css = re.sub(r"[ \t]{2,}", " ", css)
    css = re.sub(r"\s*([{};:,])\s*", r"\1", css)
    return re.sub(r";}", "}", css).strip()


# PyHiroba 本体と同じ書体。読み込めない環境（オフライン・閉域網）では
# 自動的に system-ui にフォールバックするため、表示は崩れない。
#
# これは部品が唯一、外に取りに行くもの。既定では取りに行かない。
#
# PyHiroba は出力をページと同じ document に挿すので、ページが読み込み済みの
# 書体が下の font-family でそのまま効く。@import は要らない。
# 一方 Colab の出力は隔離された iframe で、ページの書体は届かない。つまり
# この @import が実際に効くのは Colab だけだが、そちらは PyHiroba と
# 揃っている必要がない。効く場所と必要な場所が食い違っているうえ、表示の
# たびに Google へ通信が起きて閲覧者の IP が渡る。既定は切ってある。
# Colab でも同じ書体にしたい場合は use_web_font(True) を呼ぶ。
FONT_IMPORT = (
    "@import url('https://fonts.googleapis.com/css2?"
    "family=Zen+Kaku+Gothic+New:wght@400;500;700;900&display=swap');"
)

_use_web_font = False


def use_web_font(enabled: bool) -> None:
    """書体を Google Fonts から取りに行くかどうかを決める（既定は取りに行かない）。

    PyHiroba ではページ側が同じ書体を持っているため、既定のままで見た目が揃う。
    Colab でも同じ書体にしたいときだけ ``True`` を渡す（そのぶん表示のたびに
    Google へ通信が発生し、閲覧者の IP が渡る点に注意）。
    """
    global _use_web_font
    _use_web_font = bool(enabled)


def base_css() -> str:
    """いま出力すべき土台の CSS。"""
    return BASE_CSS if _use_web_font else BASE_CSS_OFFLINE

# トークンは PyHiroba の :root / :root[data-theme="dark"] に対応する。
# -ink 系はテキスト用に濃度を上げた派生色（ライトのサーフェス #ffffff / #fafaf8 と
# ダークのサーフェス #191e24 / #151a20 の双方で WCAG 4.5:1 以上を確認済み）。
_LIGHT_TOKENS = """\
  color-scheme: light;
  --hui-ink: #101418;
  --hui-ink-2: #2b3138;
  --hui-ink-3: #5b636c;
  --hui-paper: #ffffff;
  --hui-bg-2: #f3f1ec;
  --hui-line: #e7e5e0;
  --hui-accent: #028DAE;
  --hui-accent-ink: #01738e;
  --hui-accent-soft: #e6f4f7;
  --hui-ok: #27ae60;
  --hui-ok-ink: #187f45;
  --hui-ok-soft: #e9f7ef;
  --hui-warn: #f59e0b;
  --hui-warn-ink: #96610b;
  --hui-warn-soft: #fef3e2;
  --hui-bad: #e74c3c;
  --hui-bad-ink: #c0392b;
  --hui-bad-soft: #fdedec;
  --hui-on-accent: #ffffff;
  --hui-shadow: 0 1px 0 rgba(16, 20, 24, 0.04), 0 4px 12px -6px rgba(16, 20, 24, 0.08);"""

_DARK_TOKENS = """\
  color-scheme: dark;
  --hui-ink: #e8eaed;
  --hui-ink-2: #c9cfd6;
  --hui-ink-3: #9aa3ad;
  --hui-paper: #191e24;
  --hui-bg-2: #21272e;
  --hui-line: #2c333b;
  --hui-accent: #35aecb;
  --hui-accent-ink: #35aecb;
  --hui-accent-soft: #1d353f;
  --hui-ok: #4cc272;
  --hui-ok-ink: #58c97a;
  --hui-ok-soft: #20352f;
  --hui-warn: #f5b04b;
  --hui-warn-ink: #f5b04b;
  --hui-warn-soft: #383229;
  --hui-bad: #f0705f;
  --hui-bad-ink: #f0705f;
  --hui-bad-soft: #37292c;
  --hui-on-accent: #0e1418;
  --hui-shadow: 0 1px 0 rgba(0, 0, 0, 0.35), 0 4px 12px -6px rgba(0, 0, 0, 0.45);"""

# テーマは2層だけ:
#   1. .hui                      … 常にライト（既定）
#   2. [data-theme="dark"] .hui  … PyHiroba がダークのときだけダーク
#
# OS の配色設定（prefers-color-scheme）は意図的に見ない。PyHiroba 本体も
# 初期状態は常にライトで、ダークは利用者が切り替えたときだけ <html> に
# data-theme="dark" が付く（js/theme.js）。OS 設定を見てしまうと、
# ライト表示のページの中で部品だけが黒くなる食い違いが起きる。
BASE_CSS = f"""\
{FONT_IMPORT}
.hui, .hui *, .hui *::before, .hui *::after {{ box-sizing: border-box; }}
.hui {{
  font-family: 'Zen Kaku Gothic New', system-ui, sans-serif;
  font-feature-settings: "palt";
  -webkit-font-smoothing: antialiased;
  font-size: 15px;
  line-height: 1.7;
  color: inherit;
  --hui-radius: 14px;
  --hui-radius-sm: 8px;
{_LIGHT_TOKENS}
}}
[data-theme="dark"] .hui {{
{_DARK_TOKENS}
}}
.hui .hui-vh {{
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}}
.hui a {{ color: var(--hui-accent-ink); }}
.hui b, .hui strong {{ font-weight: 700; }}"""

# コンポーネント別 CSS。辞書の定義順が <style> 内での出力順になる。
COMPONENT_CSS = {
    "text": """\
.hui-text { margin: 0.4em 0; }""",
    "card": """\
.hui-card {
  border: 1px solid var(--hui-line);
  border-radius: var(--hui-radius);
  background: var(--hui-paper);
  box-shadow: var(--hui-shadow);
  color: var(--hui-ink);
  padding: 16px 18px;
  margin: 10px 0;
}
.hui-card-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-weight: 700;
  font-size: 1.06em;
  letter-spacing: 0.01em;
  margin: 0 0 6px;
}
.hui-card-icon { flex: none; }
.hui-card-body { color: var(--hui-ink-2); }
.hui-card-footer {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--hui-line);
  font-size: 0.9em;
  color: var(--hui-ink-3);
}""",
    "alert": """\
.hui-alert {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border-radius: var(--hui-radius);
  background: var(--hui-accent-soft);
  color: var(--hui-ink);
  padding: 12px 16px;
  margin: 10px 0;
}
.hui-alert-icon {
  flex: none;
  width: 20px;
  height: 20px;
  margin-top: 3px;
  border-radius: 999px;
  background: var(--hui-accent);
  color: var(--hui-on-accent);
  font-size: 13px;
  font-weight: 900;
  line-height: 20px;
  text-align: center;
}
.hui-alert-title { font-weight: 700; letter-spacing: 0.01em; margin-bottom: 2px; }
.hui-alert-success { background: var(--hui-ok-soft); }
.hui-alert-success .hui-alert-icon { background: var(--hui-ok); }
.hui-alert-warning { background: var(--hui-warn-soft); }
.hui-alert-warning .hui-alert-icon { background: var(--hui-warn); }
.hui-alert-danger { background: var(--hui-bad-soft); }
.hui-alert-danger .hui-alert-icon { background: var(--hui-bad); }""",
    "quiz": """\
.hui-quiz {
  border: 1px solid var(--hui-line);
  border-radius: var(--hui-radius);
  background: var(--hui-paper);
  box-shadow: var(--hui-shadow);
  color: var(--hui-ink);
  padding: 16px 18px;
  margin: 10px 0;
}
.hui-quiz-q { font-weight: 700; letter-spacing: 0.01em; margin: 0 0 12px; }
.hui-choice {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--hui-line);
  border-radius: var(--hui-radius-sm);
  padding: 9px 14px;
  margin: 8px 0;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
@media (hover: hover) {
  .hui-choice:hover { border-color: var(--hui-accent); background: var(--hui-accent-soft); }
}
.hui-choice input[type="radio"] {
  flex: none;
  margin: 0;
  cursor: pointer;
  accent-color: var(--hui-accent);
}
.hui-fb {
  display: none;
  margin-left: auto;
  flex: none;
  font-weight: 700;
  font-size: 0.9em;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.hui-choice input:checked ~ .hui-fb { display: inline; }
.hui-is-answer .hui-fb { color: var(--hui-ok-ink); }
.hui-choice:not(.hui-is-answer) .hui-fb { color: var(--hui-bad-ink); }
.hui-choice input:checked + .hui-choice-text { font-weight: 700; }
.hui-is-answer input:checked + .hui-choice-text { color: var(--hui-ok-ink); }
.hui-choice:not(.hui-is-answer) input:checked + .hui-choice-text { color: var(--hui-bad-ink); }
@supports selector(:has(*)) {
  .hui-is-answer:has(input:checked) {
    border-color: var(--hui-ok);
    background: var(--hui-ok-soft);
  }
  .hui-choice:not(.hui-is-answer):has(input:checked) {
    border-color: var(--hui-bad);
    background: var(--hui-bad-soft);
  }
}
.hui-quiz-exp { margin-top: 12px; box-shadow: none; }""",
    "reveal": """\
.hui-reveal {
  border: 1px solid var(--hui-line);
  border-radius: var(--hui-radius);
  background: var(--hui-paper);
  box-shadow: var(--hui-shadow);
  color: var(--hui-ink);
  margin: 10px 0;
  overflow: hidden;
}
.hui-reveal > summary {
  cursor: pointer;
  padding: 11px 16px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--hui-accent-ink);
  -webkit-user-select: none;
  user-select: none;
}
@media (hover: hover) {
  .hui-reveal > summary:hover { background: var(--hui-accent-soft); }
}
.hui-reveal[open] > summary { border-bottom: 1px solid var(--hui-line); }
.hui-reveal-body { padding: 13px 16px; color: var(--hui-ink-2); }""",
    "progress": """\
.hui-progress { margin: 12px 0; }
.hui-progress-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.92em;
  margin-bottom: 5px;
}
.hui-progress-num { font-weight: 700; }
.hui-progress-track {
  height: 12px;
  border-radius: 999px;
  background: var(--hui-bg-2);
  border: 1px solid var(--hui-line);
  overflow: hidden;
}
.hui-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--hui-accent);
}
@media (prefers-reduced-motion: no-preference) {
  .hui-progress-fill { transition: width 0.4s ease; }
}""",
    "stat": """\
.hui-stat {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--hui-line);
  border-radius: var(--hui-radius);
  background: var(--hui-paper);
  box-shadow: var(--hui-shadow);
  color: var(--hui-ink);
  padding: 14px 20px;
  margin: 10px 8px 0 0;
  min-width: 8em;
  vertical-align: top;
}
.hui-stat-label { font-size: 0.85em; color: var(--hui-ink-3); }
.hui-stat-value {
  font-size: 1.9em;
  font-weight: 800;
  line-height: 1.25;
  letter-spacing: -0.01em;
}
.hui-stat-unit {
  font-size: 0.55em;
  font-weight: 700;
  color: var(--hui-ink-3);
  margin-left: 3px;
}""",
    "columns": """\
.hui-cols {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  margin: 10px 0;
}
.hui-col { flex: 1 1 0; min-width: 200px; }
.hui-col > :first-child { margin-top: 0; }
.hui-col > :last-child { margin-bottom: 0; }
.hui-col > .hui-stat { width: 100%; }""",
    "badge": """\
.hui-badge {
  display: inline-block;
  padding: 2px 12px;
  border-radius: 999px;
  border: 1px solid var(--hui-line);
  background: var(--hui-bg-2);
  color: var(--hui-ink-2);
  font-size: 0.82em;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.7;
  margin: 0 4px 4px 0;
}
.hui-badge-blue {
  color: var(--hui-accent-ink);
  background: var(--hui-accent-soft);
  border-color: var(--hui-accent-soft);
}
.hui-badge-green {
  color: var(--hui-ok-ink);
  background: var(--hui-ok-soft);
  border-color: var(--hui-ok-soft);
}
.hui-badge-red {
  color: var(--hui-bad-ink);
  background: var(--hui-bad-soft);
  border-color: var(--hui-bad-soft);
}
.hui-badge-amber {
  color: var(--hui-warn-ink);
  background: var(--hui-warn-soft);
  border-color: var(--hui-warn-soft);
}""",
    # PyHiroba の .output-html table 系（等幅フォント・右揃え・nowrap）に勝つよう、
    # テーブル関連のセレクタは .hui を前置して詳細度を上げている。
    "table": """\
.hui .hui-table-wrap { overflow-x: auto; margin: 10px 0; }
.hui .hui-table {
  border-collapse: collapse;
  min-width: 50%;
  font-family: inherit;
  font-size: 0.95em;
  line-height: 1.7;
  background: var(--hui-paper);
}
/* caption は table の外側に置かれ背景が敷かれないため、色は指定せず
   ホストの文字色を継承させる（暗いページでも読める） */
.hui .hui-table caption {
  caption-side: top;
  text-align: left;
  font-weight: 700;
  letter-spacing: 0.01em;
  padding: 0 0 8px;
}
.hui .hui-table th, .hui .hui-table td {
  color: var(--hui-ink);
  border: 1px solid var(--hui-line);
  padding: 7px 14px;
  text-align: left;
  white-space: normal;
  font-family: inherit;
  font-size: inherit;
}
.hui .hui-table thead th {
  background: var(--hui-bg-2);
  font-weight: 700;
  text-align: left;
}
.hui .hui-table tbody tr:nth-child(even) { background: var(--hui-bg-2); }
@media (hover: hover) {
  .hui .hui-table tbody tr:hover { background: var(--hui-accent-soft); }
}""",
    "form": """\
.hui-form {
  border: 1px solid var(--hui-line);
  border-radius: var(--hui-radius);
  background: var(--hui-paper);
  box-shadow: var(--hui-shadow);
  color: var(--hui-ink);
  padding: 16px 18px;
  margin: 10px 0;
}
.hui-form-title { font-weight: 700; letter-spacing: 0.01em; margin-bottom: 10px; }
.hui-field { display: block; margin-bottom: 10px; }
.hui-field-label {
  display: block;
  font-size: 0.88em;
  color: var(--hui-ink-3);
  margin-bottom: 3px;
}
.hui-input {
  width: 100%;
  font-family: inherit;
  font-size: 1em;
  color: var(--hui-ink);
  background: var(--hui-paper);
  border: 1px solid var(--hui-line);
  border-radius: var(--hui-radius-sm);
  padding: 8px 12px;
}
.hui-input:focus {
  outline: 2px solid var(--hui-accent);
  outline-offset: 1px;
  border-color: var(--hui-accent);
}
.hui-submit {
  font-family: inherit;
  font-size: 0.95em;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--hui-on-accent);
  background: var(--hui-accent);
  border: 1px solid var(--hui-accent);
  border-radius: 999px;
  padding: 8px 22px;
  cursor: pointer;
}
@media (hover: hover) {
  .hui-submit:hover { filter: brightness(1.08); }
}
.hui-form-out:not(:empty) { margin-top: 12px; }""",
    "chat": """\
.hui-chat { display: flex; flex-direction: column; gap: 10px; margin: 10px 0; }
.hui-msg { display: flex; flex-direction: column; max-width: 82%; }
.hui-msg-name { font-size: 0.8em; color: var(--hui-ink-3); margin-bottom: 2px; }
.hui-msg-body {
  border-radius: var(--hui-radius);
  padding: 10px 14px;
  color: var(--hui-ink);
}
.hui-msg-body > :first-child { margin-top: 0; }
.hui-msg-body > :last-child { margin-bottom: 0; }
.hui-msg-user { align-self: flex-end; align-items: flex-end; }
.hui-msg-user .hui-msg-body {
  background: var(--hui-accent-soft);
  border: 1px solid var(--hui-accent-soft);
  border-bottom-right-radius: var(--hui-radius-sm);
}
.hui-msg-assistant { align-self: flex-start; }
.hui-msg-assistant .hui-msg-body {
  background: var(--hui-paper);
  border: 1px solid var(--hui-line);
  box-shadow: var(--hui-shadow);
  border-bottom-left-radius: var(--hui-radius-sm);
}
.hui-msg-note { align-self: center; max-width: 100%; }
.hui-msg-note .hui-msg-body {
  background: var(--hui-bg-2);
  border: 1px solid var(--hui-line);
  font-size: 0.9em;
}""",
    # 考え中の点。JavaScript は使わず CSS だけで動かす。
    # 動きを減らす設定の端末では、点は出したまま animation だけ止める
    # （消してしまうと「待っている」ことが伝わらなくなる）。
    "thinking": """\
.hui-thinking {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--hui-radius);
  border-bottom-left-radius: var(--hui-radius-sm);
  background: var(--hui-paper);
  border: 1px solid var(--hui-line);
  box-shadow: var(--hui-shadow);
  color: var(--hui-ink-3);
  font-size: 0.9em;
  margin: 10px 0;
}
.hui-thinking-dots { display: inline-flex; gap: 4px; }
.hui-thinking-dots i {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--hui-accent);
  opacity: 0.35;
}
@media (prefers-reduced-motion: no-preference) {
  .hui-thinking-dots i { animation: hui-blink 1.2s ease-in-out infinite; }
  .hui-thinking-dots i:nth-child(2) { animation-delay: 0.2s; }
  .hui-thinking-dots i:nth-child(3) { animation-delay: 0.4s; }
}
@keyframes hui-blink {
  0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-3px); }
}""",
    "stack": """\
.hui-stack { display: flex; flex-direction: column; margin: 10px 0; }
.hui-stack > * { margin: 0; }
.hui-stack > .hui-badge, .hui-stack > .hui-stat { align-self: flex-start; }""",
}

BASE_CSS = _minify(BASE_CSS)
# 書体の取得だけを外したもの。@import は必ず先頭にあるので、そこだけ落とす。
BASE_CSS_OFFLINE = BASE_CSS[len(_minify(FONT_IMPORT)) :].lstrip()
COMPONENT_CSS = {key: _minify(css) for key, css in COMPONENT_CSS.items()}

if BASE_CSS_OFFLINE.startswith("@import") or "fonts.googleapis.com" in BASE_CSS_OFFLINE:
    # 切り落とし方が前提とずれた（@import の書き方や _minify を変えた）。
    # 気付かないまま「通信しない」と言い続けるほうが危ないので、ここで止める。
    raise RuntimeError("BASE_CSS_OFFLINE から @import を落としきれていません")
