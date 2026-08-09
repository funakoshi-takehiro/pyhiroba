"""PyHiroba の道具を、Colab など普通の Python でも同じ形で使えるようにするモジュール。

【移設中】このファイルの中身は library-hiroba パッケージ（`library_hiroba._ai`）へ
移設することが決まっている（2026-08-09 運営者決定）。移設と PyPI 公開が済んだら、
Colab の案内は次の1行に変わり、このファイルは削除する。

    %pip install library-hiroba

それまでは、これが Colab 側の唯一の入手経路なので残しておくこと。
経緯と段取りは、リポジトリ直下の CLAUDE.md「AI 部分を library-hiroba へ移設中」を参照。

PyHiroba（ブラウザ）では、このモジュールは最初から用意されているため、
取り込みの1行は要りません。Colab では次の1行だけ先に実行してください。

    !wget -q https://pyhiroba.weblab.t.u-tokyo.ac.jp/py/pyhiroba.py

そこから下は、PyHiroba でも Colab でも**まったく同じコード**が動きます。

    from pyhiroba import ai

    await ai.load()
    print(await ai.ask("日本の四季について、2行で書いて"))

なぜ await が要るか
------------------
ブラウザ側（PyHiroba）では、モデルの受け取りと計算が「待つ」処理になるためです。
Colab 側は待つ必要がありませんが、**同じコードが両方で動くように**、
こちらも同じ形（await を付けて呼ぶ形）に揃えてあります。
ノートブック（Colab / Jupyter / PyHiroba）では、セルの中でそのまま await が使えます。

ライセンス: このファイルは PyHiroba（東京大学 松尾・岩澤研究室）の一部です。
使用するモデルのライセンスは配布元をご確認ください（既定の Qwen2.5 は Apache-2.0）。
"""

from __future__ import annotations

__all__ = ["ai", "Ai"]

# ブラウザ側（PyHiroba）と同じ既定モデル。結果が近くなるように揃えている。
# ここに無いモデルは読み込まない（安全のため、名前を明示したものだけを扱う）。
MODELS = {
    "qwen05": {
        "id": "Qwen/Qwen2.5-0.5B-Instruct",
        "label": "Qwen2.5 0.5B（日本語が使えます・おすすめ）",
        "approxMB": 1000,
    },
    "qwen15": {
        "id": "Qwen/Qwen2.5-1.5B-Instruct",
        "label": "Qwen2.5 1.5B（日本語がより自然・重い）",
        "approxMB": 3100,
    },
    "llmjp150m": {
        "id": "llm-jp/llm-jp-3-150m-instruct3",
        "label": "LLM-jp-3 150M（国産・とても軽い／文章は不自然です）",
        "approxMB": 600,
    },
}

DEFAULT_MODEL = "qwen05"


class Ai:
    """小さな言語モデルを動かす。PyHiroba 側と同じ使い方ができる。"""

    def __init__(self) -> None:
        self._pipe = None
        self._name = None

    async def models(self):
        """選べるモデルの一覧（名前と目安の通信量）。"""
        return [
            {"name": k, "label": v["label"], "approxMB": v["approxMB"]}
            for k, v in MODELS.items()
        ]

    async def load(self, model: str | None = None):
        """モデルを読み込む。初回だけ時間と通信量がかかる。"""
        name = model or DEFAULT_MODEL
        if name not in MODELS:
            raise ValueError(
                f"そのモデルは選べません: {name}"
                "（await ai.models() で選べるものを確認できます）"
            )
        if self._pipe is not None and self._name == name:
            return "すでに準備できています"

        try:
            import torch  # noqa: F401
            from transformers import pipeline
        except ImportError as e:  # pragma: no cover - 環境依存
            raise ImportError(
                "transformers と torch が必要です。次の行を先に実行してください:\n"
                "    !pip install -q transformers torch"
            ) from e

        import torch

        device = 0 if torch.cuda.is_available() else -1
        self._pipe = pipeline(
            "text-generation",
            model=MODELS[name]["id"],
            device=device,
            torch_dtype=(torch.float16 if device == 0 else torch.float32),
        )
        self._name = name
        where = "GPU" if device == 0 else "CPU"
        return f"準備ができました（{MODELS[name]['label']}／{where}で動きます）"

    async def ask(self, prompt, max_tokens: int | None = None):
        """文章を渡して、続きを書いてもらう。"""
        if self._pipe is None:
            await self.load()

        # 生成の設定は、ブラウザ側（js/ai-worker.js）と同じ考え方に揃えている。
        # 小さなモデルは、ばらつきを大きくすると意味の通らない文章になりやすいので
        # 温度を下げ、繰り返しを抑える。
        out = self._pipe(
            [{"role": "user", "content": str(prompt)}],
            max_new_tokens=max_tokens or 256,
            temperature=0.3,
            top_p=0.9,
            repetition_penalty=1.15,
            do_sample=True,
            return_full_text=False,
        )

        text = out[0]["generated_text"]
        # 会話形式で渡すと、返り値も会話の並びになる。最後の発言を取り出す。
        if isinstance(text, list):
            text = (text[-1] or {}).get("content", "") if text else ""
        return str(text).strip()


# ファイル名が pyhiroba.py なので、取り込めば `from pyhiroba import ai` で使える
ai = Ai()
