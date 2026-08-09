"""ウィジェット基盤: 表示プロトコル・エスケープ・CSS 集約・合成。"""

from __future__ import annotations

import html as _html
import re
import secrets
from collections.abc import Sequence
from typing import Union

from ._css import COMPONENT_CSS, base_css


def esc(value: object) -> str:
    """本文テキスト用エスケープ。改行は ``<br>`` にする。"""
    return _html.escape(str(value), quote=True).replace("\n", "<br>")


def esc_attr(value: object) -> str:
    """属性値用エスケープ（改行変換なし）。"""
    return _html.escape(str(value), quote=True)


# 長さの指定として許す形。数字と単位だけで、「;」も関数も入れさせない。
_LENGTH = re.compile(r"^-?(\d+(\.\d+)?|\.\d+)(px|em|rem|%|vh|vw|ch|pt|cm|mm|in|pc)?$")


def css_length(value: object, argument: str) -> str:
    """CSS の長さとして安全な文字列だけを通す。

    ``style="gap: …"`` に文字列をそのまま入れると、エスケープを抜けなくても
    ``0;position:fixed;…`` のように**別の宣言を継ぎ足せる**。画面を覆う要素を
    作ったり、``url()`` で外部へ通信させたりできてしまうため、数字と単位以外は
    受け付けない。
    """
    text = str(value).strip()
    if not _LENGTH.match(text):
        raise ValueError(
            f"{argument} には長さを指定してください（例: '12px'、'1.5rem'、'0'）。"
            f"指定値: {value!r}"
        )
    return text


def shown(value: object) -> bool:
    """表示すべき値かどうか。

    ``0`` や ``False`` は表示したい値なので、真偽値での判定は使わない
    （得点 0 点、第 0 問といった値が黙って消えてしまう）。
    """
    return value is not None and value != ""


def unique_name(prefix: str = "hui") -> str:
    """document 全体で衝突しない一意な名前を返す。

    PyHiroba では全セルの出力が 1 つの document を共有するため、
    radio の ``name`` などはウィジェットごとに一意でなければならない。
    """
    return f"{prefix}-{secrets.token_hex(4)}"


class Widget:
    """全 UI 部品の基底クラス。

    セル最後の式に置くと、Colab / Jupyter / PyHiroba がいずれも解釈する
    ``_repr_html_()`` プロトコルによって HTML として表示される。
    出力は自己完結（必要な CSS を同梱）で、JavaScript を一切含まない。
    """

    css_keys: tuple[str, ...] = ()

    def fragment(self) -> str:
        """``<style>`` を含まないマークアップ断片を返す。"""
        raise NotImplementedError

    def _iter_css_keys(self) -> list[str]:
        return list(self.css_keys)

    def extra_css(self) -> str:
        """このインスタンス固有の追加 CSS（``ui.html`` の ``css`` 引数など）。"""
        return ""

    def _iter_extra_css(self) -> list[str]:
        extra = self.extra_css()
        return [extra] if extra else []

    def _style_block(self) -> str:
        needed = set(self._iter_css_keys())
        # COMPONENT_CSS の定義順を保って必要な分だけ連結（重複なし）
        parts = [base_css()] + [css for key, css in COMPONENT_CSS.items() if key in needed]
        for block in self._iter_extra_css():
            if block not in parts:
                parts.append(block)
        return "<style>" + "\n".join(parts) + "</style>"

    def _repr_html_(self) -> str:
        # <style> は必ずルートの <div> の内側に置く。断片 HTML の先頭に置くと、
        # ブラウザの HTML パーサがこれを body の外（head 相当の位置）へ移動させ、
        # PyHiroba のサニタイズ（DOMPurify）を通した時点で失われてしまう。
        # 内側にあれば設定を変えずにそのまま残る。
        return f'<div class="hui">\n{self._style_block()}\n{self.fragment()}\n</div>'

    def __repr__(self) -> str:
        return f"<library_hiroba.{type(self).__name__}>"


Item = Union[Widget, object]


class Text(Widget):
    """プレーン文字列を安全に表示する部品。コンテナに str を渡すと使われる。"""

    css_keys = ("text",)

    def __init__(self, text: object):
        self.text = text

    def fragment(self) -> str:
        return f'<div class="hui-text">{esc(self.text)}</div>'


def as_widget(item: Item) -> Widget:
    return item if isinstance(item, Widget) else Text(item)


class Container(Widget):
    """子ウィジェットを持つ部品。CSS は子の分まで再帰的に集約する。"""

    def __init__(self, items: Sequence[Item]):
        if not items:
            raise ValueError("表示する部品を1つ以上渡してください")
        self.children = [as_widget(x) for x in items]

    def _iter_css_keys(self) -> list[str]:
        keys = list(self.css_keys)
        for child in self.children:
            keys.extend(child._iter_css_keys())
        return keys

    def _iter_extra_css(self) -> list[str]:
        blocks = super()._iter_extra_css()
        for child in self.children:
            blocks.extend(child._iter_extra_css())
        return blocks


class Stack(Container):
    """複数の部品を縦に積むコンテナ。"""

    css_keys = ("stack",)

    def __init__(self, items: Sequence[Item], gap: str = "12px"):
        super().__init__(items)
        self.gap = css_length(gap, "gap")

    def fragment(self) -> str:
        inner = "\n".join(c.fragment() for c in self.children)
        return f'<div class="hui-stack" style="gap: {self.gap};">\n{inner}\n</div>'


def show(*items: Item):
    """部品を表示するヘルパー。

    - Colab / Jupyter: その場で表示して ``None`` を返す（セル途中でも表示できる）。
    - PyHiroba（IPython なし）: 部品（複数なら縦積み）を返すので、
      セル最後の式として置けば表示される。
    """
    if not items:
        raise ValueError("表示する部品を1つ以上渡してください")
    widget = as_widget(items[0]) if len(items) == 1 else Stack(items)
    try:
        from IPython.display import display
    except ImportError:
        return widget
    display(widget)
    return None
