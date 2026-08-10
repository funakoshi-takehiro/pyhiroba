"""library_hiroba — Google Colab と PyHiroba で同じコードが動く、教育向けの道具。

2つの入口があります。

``ui``
    ノートブックに UI 部品（カード・クイズ・進捗バーなど）を表示します。
    純 Python・標準ライブラリだけで動きます。

``ai``
    ブラウザやノートブックの中で小さな言語モデルを動かします。
    PyHiroba では本体が用意した経路を、Colab では transformers を使います。

    from library_hiroba import ai, ui

    ui.card("今日の目標", "for文を使って、九九の表を作ってみよう！")

    await ai.load()
    print(await ai.ask("日本の四季について、2行で書いて"))

``ai`` は使われたときに初めて読み込みます。``ui`` だけを使う環境に、
AI 側の重い依存（transformers / torch）を持ち込まないためです。
"""

from __future__ import annotations

__version__ = "0.4.0"

__all__ = ["__version__", "ai", "ui"]


def __getattr__(name: str):
    """``ui`` と ``ai`` を、使われたときに初めて読み込む（PEP 562）。

    ここで先に読み込んでしまうと、``ui`` しか使わない環境にも AI 側の
    依存が持ち込まれる。``ui`` の「依存ゼロ・純 Python」を守るための遅延。

    読み込みには ``import_module`` を使う。``from . import ui`` と書くと、
    その解決がこの ``__getattr__`` を呼び戻して無限に繰り返す。
    """
    import importlib

    if name == "ui":
        return importlib.import_module(".ui", __name__)
    if name == "ai":
        return importlib.import_module("._ai", __name__).ai
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__() -> list[str]:
    return sorted(__all__)
