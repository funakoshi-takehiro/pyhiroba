"""10個の UI 部品と、それを生成する小文字のファクトリ関数。

すべての部品はテキスト引数を HTML エスケープする。エスケープしない唯一の
経路は :func:`html`（明示的な逃げ道）だけ。
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from html.parser import HTMLParser
from typing import ClassVar, Union

from ._core import (
    Container,
    Item,
    Stack,
    Widget,
    css_length,
    esc,
    esc_attr,
    shown,
    unique_name,
)

Number = Union[int, float]


class Card(Widget):
    css_keys = ("card",)

    def __init__(
        self,
        title: object,
        body: object = "",
        icon: str | None = None,
        footer: object = None,
    ):
        self.title = title
        self.body = body
        self.icon = icon
        self.footer = footer

    def fragment(self) -> str:
        parts = []
        if shown(self.title):
            icon = (
                f'<span class="hui-card-icon">{esc(self.icon)}</span>' if shown(self.icon) else ""
            )
            parts.append(f'<div class="hui-card-title">{icon}<span>{esc(self.title)}</span></div>')
        if shown(self.body):
            parts.append(f'<div class="hui-card-body">{esc(self.body)}</div>')
        if self.footer is not None:
            parts.append(f'<div class="hui-card-footer">{esc(self.footer)}</div>')
        return f'<div class="hui-card">{"".join(parts)}</div>'


class Alert(Widget):
    css_keys = ("alert",)

    # PyHiroba に合わせ絵文字は使わず、CSS の円形マーク内に文字記号を置く
    MARKS: ClassVar[dict[str, str]] = {
        "info": "i",
        "success": "✓",
        "warning": "!",
        "danger": "×",
    }
    # 記号は目で見るためのもの（aria-hidden）。読み上げには言葉で種類を伝える
    SPOKEN: ClassVar[dict[str, str]] = {
        "info": "お知らせ",
        "success": "できました",
        "warning": "注意",
        "danger": "警告",
    }

    def __init__(self, message: object, kind: str = "info", title: object = None):
        if kind not in self.MARKS:
            raise ValueError(
                f"kind は {sorted(self.MARKS)} のいずれかにしてください（指定値: {kind!r}）"
            )
        self.message = message
        self.kind = kind
        self.title = title

    def fragment(self) -> str:
        kind_class = "" if self.kind == "info" else f" hui-alert-{self.kind}"
        title = (
            f'<div class="hui-alert-title">{esc(self.title)}</div>' if shown(self.title) else ""
        )
        return (
            f'<div class="hui-alert{kind_class}">'
            f'<span class="hui-alert-icon" aria-hidden="true">{self.MARKS[self.kind]}</span>'
            f'<span class="hui-vh">{self.SPOKEN[self.kind]}：</span>'
            f"<div>{title}<div>{esc(self.message)}</div></div>"
            f"</div>"
        )


class Quiz(Widget):
    css_keys = ("quiz",)

    def __init__(
        self,
        question: object,
        choices: Sequence[object],
        answer: object,
        explanation: object = None,
        correct_text: str = "✓ 正解！",
        incorrect_text: str = "× ざんねん…",
    ):
        choice_list = [str(c) for c in choices]
        if len(choice_list) < 2:
            raise ValueError("choices は2つ以上にしてください")
        if len(set(choice_list)) != len(choice_list):
            raise ValueError(f"choices に重複があります: {choice_list!r}")
        answer_str = str(answer)
        if answer_str not in choice_list:
            raise ValueError(f"answer {answer!r} が choices {choice_list!r} の中にありません")
        self.question = question
        self.choices = choice_list
        self.answer = answer_str
        self.explanation = explanation
        self.correct_text = correct_text
        self.incorrect_text = incorrect_text
        # PyHiroba では全セルが 1 document を共有するため name は一意にする
        self.name = unique_name("hui-quiz")
        if explanation is not None:
            self.css_keys = ("quiz", "reveal")

    def fragment(self) -> str:
        rows = []
        for choice in self.choices:
            is_answer = choice == self.answer
            cls = "hui-choice hui-is-answer" if is_answer else "hui-choice"
            feedback = self.correct_text if is_answer else self.incorrect_text
            rows.append(
                f'<label class="{cls}">'
                f'<input type="radio" name="{esc_attr(self.name)}">'
                f'<span class="hui-choice-text">{esc(choice)}</span>'
                f'<span class="hui-fb">{esc(feedback)}</span>'
                f"</label>"
            )
        explanation = ""
        if self.explanation is not None:
            explanation = (
                '<details class="hui-reveal hui-quiz-exp"><summary>解説を見る</summary>'
                f'<div class="hui-reveal-body">{esc(self.explanation)}</div></details>'
            )
        return (
            f'<div class="hui-quiz"><div class="hui-quiz-q">{esc(self.question)}</div>'
            f'{"".join(rows)}{explanation}</div>'
        )


class Reveal(Widget):
    css_keys = ("reveal",)

    def __init__(self, content: object, summary: object = "答えを見る"):
        self.content = content
        self.summary = summary

    def fragment(self) -> str:
        return (
            f'<details class="hui-reveal"><summary>{esc(self.summary)}</summary>'
            f'<div class="hui-reveal-body">{esc(self.content)}</div></details>'
        )


class Progress(Widget):
    css_keys = ("progress",)

    def __init__(
        self,
        value: Number,
        max: Number = 100,
        label: object = None,
        show_value: bool = True,
    ):
        max_value = float(max)
        if max_value <= 0:
            raise ValueError(f"max は正の数にしてください（指定値: {max!r}）")
        self.value = float(value)
        self.max = max_value
        self.label = label
        self.show_value = show_value

    @property
    def percent(self) -> float:
        return min(100.0, max(0.0, self.value / self.max * 100.0))

    def fragment(self) -> str:
        percent_text = f"{self.percent:.0f}%"
        head = ""
        if self.label is not None or self.show_value:
            label = f"<span>{esc(self.label)}</span>" if self.label is not None else "<span></span>"
            num = f'<span class="hui-progress-num">{percent_text}</span>' if self.show_value else ""
            head = f'<div class="hui-progress-head">{label}{num}</div>'
        aria_label = esc_attr(self.label if self.label is not None else "進捗")
        return (
            f'<div class="hui-progress">{head}'
            f'<div class="hui-progress-track" role="progressbar" aria-label="{aria_label}"'
            f' aria-valuemin="0" aria-valuemax="100" aria-valuenow="{self.percent:.0f}">'
            f'<div class="hui-progress-fill" style="width: {self.percent:.4g}%;"></div>'
            f"</div></div>"
        )


class Stat(Widget):
    css_keys = ("stat",)

    def __init__(
        self,
        label: object,
        value: object,
        unit: object = None,
        icon: str | None = None,
    ):
        self.label = label
        self.value = value
        self.unit = unit
        self.icon = icon

    def fragment(self) -> str:
        icon = f"{esc(self.icon)} " if shown(self.icon) else ""
        unit = (
            f'<span class="hui-stat-unit">{esc(self.unit)}</span>' if shown(self.unit) else ""
        )
        return (
            f'<div class="hui-stat">'
            f'<span class="hui-stat-label">{icon}{esc(self.label)}</span>'
            f'<span class="hui-stat-value">{esc(self.value)}{unit}</span>'
            f"</div>"
        )


class Columns(Container):
    css_keys = ("columns",)

    def __init__(
        self,
        items: Sequence[Item],
        widths: Sequence[Number] | None = None,
        gap: str = "12px",
    ):
        super().__init__(items)
        if widths is not None:
            widths = [float(w) for w in widths]
            if len(widths) != len(self.children):
                raise ValueError(
                    f"widths の数（{len(widths)}）を部品の数（{len(self.children)}）に合わせてください"
                )
            if any(w <= 0 for w in widths):
                raise ValueError(f"widths は正の数にしてください（指定値: {widths!r}）")
        self.widths = widths
        self.gap = css_length(gap, "gap")

    def fragment(self) -> str:
        cols = []
        for i, child in enumerate(self.children):
            style = f' style="flex: {self.widths[i]:.4g} 1 0;"' if self.widths else ""
            cols.append(f'<div class="hui-col"{style}>{child.fragment()}</div>')
        return f'<div class="hui-cols" style="gap: {self.gap};">{"".join(cols)}</div>'


class Badge(Widget):
    css_keys = ("badge",)

    COLORS = ("blue", "green", "red", "amber", "gray")

    def __init__(self, text: object, color: str = "blue"):
        if color not in self.COLORS:
            raise ValueError(
                f"color は {list(self.COLORS)} のいずれかにしてください（指定値: {color!r}）"
            )
        self.text = text
        self.color = color

    def fragment(self) -> str:
        color_class = "" if self.color == "gray" else f" hui-badge-{self.color}"
        return f'<span class="hui-badge{color_class}">{esc(self.text)}</span>'


class Table(Widget):
    css_keys = ("table",)

    def __init__(
        self,
        data: Sequence[object],
        headers: Sequence[object] | None = None,
        caption: object = None,
    ):
        if isinstance(data, dict):
            raise ValueError(
                "data には行の一覧を渡してください。1行だけのときも "
                'ui.table([{"名前": "佐藤"}]) のようにリストで囲みます。'
            )
        rows = list(data)
        # headers は下で何度もなぞる。生成器のまま受け取ると最初の1行で尽きて、
        # 2行目以降が黙って空欄になる（表示は出るので気付けない）。先に確定させる。
        if headers is not None:
            headers = list(headers)
        if not rows:
            raise ValueError("data が空です")

        dict_rows = sum(isinstance(r, dict) for r in rows)
        if dict_rows not in (0, len(rows)):
            raise ValueError(
                "行の形が混ざっています。すべて辞書にするか、すべてリストにしてください。"
            )
        if dict_rows == 0 and any(isinstance(r, str) for r in rows):
            raise ValueError(
                "行が文字列になっています。1行は値の一覧です（例: [[1, 2], [3, 4]]）。"
            )

        if dict_rows:
            if headers is None:
                headers = []
                for r in rows:
                    for key in r:
                        if key not in headers:
                            headers.append(key)
            self.rows = [[r.get(h, "") for h in headers] for r in rows]
        else:
            self.rows = [list(r) for r in rows]

        self.headers = list(headers) if headers is not None else None
        # 列数の足りない行は空欄で埋める（欠けたまま出すと列がずれる）
        width = max([len(r) for r in self.rows] + [len(self.headers or [])])
        for row in self.rows:
            row.extend([""] * (width - len(row)))
        self.caption = caption

    def fragment(self) -> str:
        caption = f"<caption>{esc(self.caption)}</caption>" if self.caption is not None else ""
        thead = ""
        if self.headers is not None:
            cells = "".join(f'<th scope="col">{esc(h)}</th>' for h in self.headers)
            thead = f"<thead><tr>{cells}</tr></thead>"
        body_rows = "".join(
            "<tr>" + "".join(f"<td>{esc(cell)}</td>" for cell in row) + "</tr>"
            for row in self.rows
        )
        return (
            f'<div class="hui-table-wrap"><table class="hui-table">{caption}'
            f"{thead}<tbody>{body_rows}</tbody></table></div>"
        )


# CSS 文字列中の "</style" で <style> ブロックが早期終了しないよう無害化する
_STYLE_CLOSE_RE = re.compile(r"</style", re.IGNORECASE)


def css_stays_inside_scope(css: str) -> bool:
    """波括弧の対応が取れていて、スコープの外に出ていないかを調べる。

    ``scoped=True`` の CSS は ``.一意なクラス { ... }`` の中に入れるが、
    途中に余分な ``}`` があるとそこでスコープが閉じ、以降がページ全体に効く。
    文字列とコメントの中の括弧は数えない。
    """
    depth = 0
    i, n = 0, len(css)
    quote = None
    while i < n:
        ch = css[i]
        if quote is not None:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
        elif css.startswith("/*", i):
            end = css.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth < 0:
                return False
        i += 1
    return depth == 0


# PyHiroba は表示の直前に本体側のサニタイザ（DOMPurify）を通すため、ここに並べた
# ものは出力から消える。Colab にはそのサニタイザが無いので、書いた本人は Colab で
# 動くのを見て「できた」と思い、PyHiroba に載せて初めて消えているのに気付く。
# それを避けるため、書いた時点で止める。
#
# tests/sanitize_check.py に同じ一覧がある。片方から import すると検査の正しさを
# テスト自身が保証できなくなるので、あえて分けたうえで、両者が一致することを
# test_components.py で確かめている。増やすときは両方を直す。
DANGEROUS_TAGS = frozenset(
    {
        "script",
        "iframe",
        "frame",
        "frameset",
        "form",
        "object",
        "embed",
        "applet",
        "link",
        "meta",
        "base",
    }
)

# 値に javascript: が書ける属性
URL_ATTRS = frozenset({"href", "src", "action", "formaction", "xlink:href", "data"})


class _DangerFinder(HTMLParser):
    """``ui.html()`` に渡された HTML から、PyHiroba 側で消えるものを拾う。

    正規表現ではなく HTMLParser を使うのは、属性値の実体参照が復元された状態で
    渡ってくるため。``&#106;avascript:`` のような書き方を自前で戻さずに済む。
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.found: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        # <embed/> のような書き方は HTMLParser が既定でここへ回してくれる
        if tag in DANGEROUS_TAGS:
            self.found.append(f"<{tag}> タグ")
        for name, value in attrs:
            lowered = name.lower()
            if lowered.startswith("on"):
                self.found.append(f"<{tag}> の {name} 属性")
            elif lowered in URL_ATTRS and value is not None:
                # java\nscript: のように途中に空白を挟んでも URL としては通るため、
                # 空白を落としてから見る
                if "".join(value.split()).lower().startswith("javascript:"):
                    self.found.append(f"<{tag}> の {name}=\"javascript:...\"")


def dangerous_html(raw: str) -> list[str]:
    """PyHiroba 側で取り除かれる要素を探し、見つかったものを並べて返す。

    空リストなら、Colab と PyHiroba で同じ表示になる。``id`` や ``style`` は
    どちらの環境でも残るので、ここでは見ない。
    """
    finder = _DangerFinder()
    finder.feed(raw)
    finder.close()
    # 同じものが何度も出てきても、伝えたいことは1回で足りる
    return list(dict.fromkeys(finder.found))


class RawHtml(Widget):
    css_keys = ()

    def __init__(self, raw: object, css: str | None = None, scoped: bool = True):
        self.raw = str(raw)
        found = dangerous_html(self.raw)
        if found:
            raise ValueError(
                "ui.html() に、PyHiroba では表示できないものが含まれています: "
                + "、".join(found)
                + "。PyHiroba は表示の直前にこれらを取り除くため、Colab で動いても"
                "本番では動きません。両方で同じ表示になるように書き直してください。"
                "（Colab だけで試すなら IPython.display.HTML が使えます）"
            )
        if css is not None and scoped and not css_stays_inside_scope(str(css)):
            raise ValueError(
                "CSS の波括弧 { } の数が合っていません。閉じ忘れか、余分な } があります。"
                "そのままだと CSS がこの部品の外に出て、ページ全体の見た目を変えてしまいます。"
                "意図してページ全体に効かせたい場合は scoped=False を指定してください。"
            )
        self.css = None if css is None else _STYLE_CLOSE_RE.sub(lambda _: "<\\/style", str(css))
        # scoped の場合はインスタンスごとに一意なクラスで CSS の効く範囲を限定する
        # （PyHiroba では全セルが 1 document を共有するため、ページや他セルを汚さない）
        self.scope_class = unique_name("hui-raw") if (self.css is not None and scoped) else None

    def extra_css(self) -> str:
        if self.css is None:
            return ""
        if self.scope_class is not None:
            # CSS ネスト（モダンブラウザ標準）でユーザー CSS 全体をスコープする
            return f".{self.scope_class} {{\n{self.css}\n}}"
        return self.css

    def fragment(self) -> str:
        cls = "hui-raw" if self.scope_class is None else f"hui-raw {self.scope_class}"
        return f'<div class="{cls}">{self.raw}</div>'


# ---------------------------------------------------------------------------
# 公開 API（ファクトリ関数）
# ---------------------------------------------------------------------------


def card(title, body="", icon=None, footer=None) -> Card:
    """説明カード。

    >>> ui.card("今日の目標", "for文を使って、九九の表を作ってみよう！")
    """
    return Card(title, body=body, icon=icon, footer=footer)


def alert(message, kind="info", title=None) -> Alert:
    """ヒント・注意の表示。kind は info / success / warning / danger。

    >>> ui.alert("range(5) は 0 から 4 までだよ", kind="warning")
    """
    return Alert(message, kind=kind, title=title)


def quiz(
    question,
    choices,
    answer,
    explanation=None,
    correct_text="✓ 正解！",
    incorrect_text="× ざんねん…",
) -> Quiz:
    """選択式クイズ。選ぶと CSS だけで正誤が色とマークで表示される。

    ``answer`` は選択肢の値そのもので指定する（インデックスではない）。

    >>> ui.quiz("2の8乗は？", choices=[128, 256, 512], answer=256, explanation="2×2を8回！")
    """
    return Quiz(
        question,
        choices,
        answer,
        explanation=explanation,
        correct_text=correct_text,
        incorrect_text=incorrect_text,
    )


def reveal(content, summary="答えを見る") -> Reveal:
    """クリックで開閉する「答え・解説」ボックス。

    >>> ui.reveal("答えは 42 です", summary="答えを見る")
    """
    return Reveal(content, summary=summary)


def progress(value, max=100, label=None, show_value=True) -> Progress:
    """進捗バー。0〜100% にクランプされる。

    >>> ui.progress(7, max=10, label="練習問題")
    """
    return Progress(value, max=max, label=label, show_value=show_value)


def stat(label, value, unit=None, icon=None) -> Stat:
    """数値の強調表示タイル。

    >>> ui.stat("正答率", 85, unit="%")
    """
    return Stat(label, value, unit=unit, icon=icon)


def columns(*items, widths=None, gap="12px") -> Columns:
    """部品を横並びに配置する。狭い画面では自動で折り返す。

    >>> ui.columns(ui.stat("得点", 90), ui.stat("順位", 3))
    """
    return Columns(items, widths=widths, gap=gap)


def badge(text, color="blue") -> Badge:
    """ラベル表示用のバッジ。color は blue / green / red / amber / gray。

    >>> ui.badge("重要", color="red")
    """
    return Badge(text, color=color)


def table(data, headers=None, caption=None) -> Table:
    """整形テーブル。dict のリスト（ヘッダ自動）か、リストのリスト + headers。

    >>> ui.table([{"名前": "佐藤", "得点": 90}, {"名前": "鈴木", "得点": 85}])
    """
    return Table(data, headers=headers, caption=caption)


def html(raw, css=None, scoped=True) -> RawHtml:
    """HTML をエスケープせずそのまま表示する（明示的な逃げ道）。CSS も書ける。

    >>> ui.html('<div class="fukidashi">こんにちは！</div>',
    ...         css=".fukidashi { border: 2px solid pink; border-radius: 16px; }")

    - ``css``: この部品と一緒に出力される自由な CSS。
    - ``scoped=True``（既定）: CSS はこの部品の範囲だけに効く（インスタンスごとの
      一意なクラスと CSS ネストで自動スコープ）。ページや他のセルを汚さない。
    - ``scoped=False``: CSS をそのまま出力する。Colab では出力 iframe 内、
      PyHiroba では**ページ全体**に効く点に注意。``@keyframes`` などトップレベル
      専用の @ルールを使う場合はこちらを指定する。

    渡した内容はエスケープされずそのまま出力に含まれるため、信頼できる内容にだけ
    使うこと。ただし PyHiroba 側で消えてしまうもの — ``<script>`` ``<iframe>``
    ``<form>`` などのタグ、``onclick`` のようなイベント属性、``javascript:`` の
    URL — は、書いた時点で ``ValueError`` になる。Colab では動くのに PyHiroba では
    動かない、という食い違いを防ぐため。``id`` や ``style`` は自由に書ける。
    """
    return RawHtml(raw, css=css, scoped=scoped)


def stack(*items, gap="12px") -> Stack:
    """複数の部品を縦に積んで 1 つの表示にまとめる。

    >>> ui.stack(ui.card("目標", "..."), ui.progress(3, max=10))
    """
    return Stack(items, gap=gap)


class Thinking(Widget):
    """「考え中」を点の動きで伝える部品。

    答えが出るまで画面が変わらないと、押せていないと思われる。JavaScript は
    使えないので、点の明滅は CSS だけで動かしている。
    """

    css_keys = ("thinking",)

    def __init__(self, text: object = "考え中"):
        self.text = text

    def fragment(self) -> str:
        label = f"<span>{esc(self.text)}</span>" if shown(self.text) else ""
        # 点は目で見るためのもの。読み上げには言葉だけ伝える
        return (
            f'<div class="hui-thinking" role="status">{label}'
            f'<span class="hui-thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>'
            f"</div>"
        )


def thinking(text="考え中") -> Thinking:
    """答えを待っていることを、点の動きで伝える。

    >>> ui.thinking("AI が考えています")

    ``ui.form()`` は送信の直後にこれを自動で出す（``pending`` で変えられる）。
    """
    return Thinking(text)


class Chat(Container):
    """会話を吹き出しで並べる部品。"""

    css_keys = ("chat",)

    ROLES = ("user", "assistant", "note")
    DEFAULT_NAMES: ClassVar[dict[str, str]] = {"user": "あなた", "assistant": "AI", "note": ""}

    def __init__(self, messages: Sequence[object], names: dict | None = None):
        rows = []
        for message in messages:
            if isinstance(message, dict):
                role, content = message.get("role", "assistant"), message.get("content", "")
            else:
                role, content = message
            role = str(role)
            if role not in self.ROLES:
                raise ValueError(
                    f"role は {list(self.ROLES)} のいずれかにしてください（指定値: {role!r}）"
                )
            rows.append((role, content))
        if not rows:
            raise ValueError("メッセージを1つ以上渡してください")
        # 中身が部品なら CSS をまとめるため、コンテナの子として扱う
        super().__init__([content for _role, content in rows])
        self.roles = [role for role, _content in rows]
        self.names = {**self.DEFAULT_NAMES, **(names or {})}

    def fragment(self) -> str:
        rows = []
        for role, child in zip(self.roles, self.children):
            name = self.names.get(role, "")
            label = f'<span class="hui-msg-name">{esc(name)}</span>' if name else ""
            rows.append(
                f'<div class="hui-msg hui-msg-{role}">{label}'
                f'<div class="hui-msg-body">{child.fragment()}</div></div>'
            )
        return f'<div class="hui-chat">{"".join(rows)}</div>'


class Conversation(Widget):
    """会話をためておいて、吹き出しで表示する部品。

    :class:`Chat` は渡された分をその場で描くだけなので、往復するたびに
    ``{"role": ..., "content": ...}`` の辞書を自分で組み立てて持ち回ることになる。
    こちらは足していける入れ物で、表示は ``Chat`` に任せる。
    """

    css_keys = Chat.css_keys

    def __init__(self, messages: Sequence[object] | None = None, names: dict | None = None):
        self._messages: list[dict] = []
        self.names = dict(names or {})
        for message in messages or []:
            if isinstance(message, dict):
                self._add(message.get("role", "assistant"), message.get("content", ""))
            else:
                self._add(*message)

    def _add(self, role: object, content: object) -> Conversation:
        # 足した時点で確かめる。表示のときまで持ち越すと、どの行が悪いのか分からなくなる
        role = str(role)
        if role not in Chat.ROLES:
            raise ValueError(
                f"role は {list(Chat.ROLES)} のいずれかにしてください（指定値: {role!r}）"
            )
        self._messages.append({"role": role, "content": content})
        return self

    def say(self, content: object) -> Conversation:
        """利用者の発言を足す（右に出る）。"""
        return self._add("user", content)

    def reply(self, content: object) -> Conversation:
        """AI やボットの発言を足す（左に出る）。"""
        return self._add("assistant", content)

    def note(self, content: object) -> Conversation:
        """発言ではない補足を足す（真ん中に出る）。"""
        return self._add("note", content)

    def clear(self) -> Conversation:
        """会話を空に戻す。"""
        self._messages.clear()
        return self

    @property
    def messages(self) -> list[dict]:
        """いままでの会話。``ui.chat()`` にそのまま渡せる。

        写しを返すので、これを直接 append しても会話は増えない
        （増やすときは :meth:`say` / :meth:`reply` / :meth:`note` を使う）。
        """
        return [dict(message) for message in self._messages]

    def __len__(self) -> int:
        return len(self._messages)

    def _chat(self) -> Chat:
        return Chat(self._messages, names=self.names)

    # 中身が空のあいだも表示できるようにする（Chat は空を受け付けない）。
    # 最初のセルで作って、次のセルから足していく書き方を通すため。
    def _iter_css_keys(self) -> list[str]:
        if not self._messages:
            return list(self.css_keys)
        return self._chat()._iter_css_keys()

    def _iter_extra_css(self) -> list[str]:
        if not self._messages:
            return super()._iter_extra_css()
        return self._chat()._iter_extra_css()

    def fragment(self) -> str:
        if not self._messages:
            return '<div class="hui-chat"></div>'
        return self._chat().fragment()


def conversation(messages=None, names=None) -> Conversation:
    """会話をためておく入れ物。セルに置くと吹き出しで表示される。

    >>> talk = ui.conversation(names={"assistant": "ボット"})
    >>> talk.say("こんにちは")
    >>> talk.reply("やあ！")
    >>> talk

    ``ui.chat()`` との違いは、**あとから足せる**こと。往復するたびに辞書を
    組み立てる代わりに、``say()``（利用者）と ``reply()``（AI・ボット）を呼ぶ。
    ``note()`` は発言ではない補足で、真ん中に出る。

    ``content`` には文字列のほか、他の部品もそのまま入れられる。
    ``ai.talk()`` はこれを内側で使っている。
    """
    return Conversation(messages, names=names)


def chat(messages, names=None) -> Chat:
    """会話を吹き出しで表示する。

    ``messages`` は ``{"role": ..., "content": ...}`` の並び、または
    ``(role, content)`` の並び。role は user / assistant / note のいずれか。
    content には文字列のほか、他の部品もそのまま入れられる。

    >>> ui.chat([
    ...     {"role": "user", "content": "スマホは持っていっていい？"},
    ...     {"role": "assistant", "content": "はい、持ってきていいです。"},
    ... ])

    表示名は ``names={"user": "生徒", "assistant": "先生"}`` で変えられる。
    """
    return Chat(messages, names=names)
