"""library_hiroba.ui — ノートブックに UI 部品を表示する。

使い方（セル最後の式に置くと表示される）::

    from library_hiroba import ui

    ui.card("今日の目標", "for文を使って、九九の表を作ってみよう！")

用意された部品のほかに、``ui.html()`` で HTML と CSS を自由に書ける::

    ui.html('<div class="memo">ヒント</div>',
            css=".memo { border: 2px solid var(--hui-accent); }")

``ui.form()`` を使うと、入力を受け取って関数に渡せる::

    ui.form(lambda question: ui.card(question, "答え"), "question")

しくみ: 各部品は ``_repr_html_()`` で自己完結の HTML と CSS を返す。
表示も操作も HTML と CSS だけで完結するため、ブラウザ内で動く PyHiroba
（https://pyhiroba.weblab.t.u-tokyo.ac.jp/）でも、Google Colab の
サンドボックス iframe でも同じように表示される。
"""

from ._components import (
    alert,
    badge,
    card,
    chat,
    columns,
    conversation,
    html,
    progress,
    quiz,
    reveal,
    stack,
    stat,
    table,
    thinking,
)
from ._core import Widget, show
from ._css import use_web_font
from ._forms import field, form, get_form

__all__ = [
    "Widget",
    "alert",
    "badge",
    "card",
    "chat",
    "columns",
    "conversation",
    "field",
    "form",
    "get_form",
    "html",
    "progress",
    "quiz",
    "reveal",
    "show",
    "stack",
    "stat",
    "table",
    "thinking",
    "use_web_font",
]
