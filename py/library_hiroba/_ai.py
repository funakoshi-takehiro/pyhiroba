"""小さな言語モデルを、PyHiroba でも Colab でも同じ書き方で動かす。

    from library_hiroba import ai

    await ai.load()
    print(await ai.ask("日本の四季について、2行で書いて"))

なぜ ``await`` が要るか
----------------------
PyHiroba は GitHub Pages で配信しているため COOP/COEP ヘッダを付けられず、
``SharedArrayBuffer`` を使った同期待ちができません。そのためブラウザ側では
「待つ」処理にせざるを得ません。Colab 側は待つ必要がありませんが、
**同じコードが両方で動く**ことを優先して、こちらも ``await`` の形に揃えています。
ノートブック（Colab / Jupyter / PyHiroba）は、セルの中でそのまま ``await`` が使えます。

2つの経路
---------
- PyHiroba（ブラウザ）… 本体が用意した ``js.pyhirobaAsk`` を通す。やり取りは JSON 文字列だけ
- Colab など … ``transformers`` と ``torch`` を使う（``pip install "library-hiroba[ai]"``）

入力した文章が外部に送られることはありません。通信はモデルを受け取るときだけです。

ライセンス: 使用するモデルのライセンスは配布元をご確認ください
（既定の Qwen2.5 は Apache-2.0）。
"""

from __future__ import annotations

import re

__all__ = ["Ai", "ai"]


# ---------------------------------------------------------------------------
# モデルの名前
# ---------------------------------------------------------------------------
# ブラウザ側は同じモデルを精度違い（q8 / q4）で並べるため、名前に -q8 / -q4 が付く。
# Colab 側にその区別は無い。どちらの名前で呼ばれても動くよう、ここで受け止める。
#
#   共通の名前（これを使うのが推奨）… qwen05 / qwen15 / llmjp150m
#   ブラウザ固有の名前（そのまま通す）… qwen05-q8 / qwen05-q4 / qwen15-q4 / llmjp150m-q4
#
# ``colab_id`` と ``browser_repo`` は**同じモデルの別形式**でなければいけない。
# 片方だけ新しい版に上げると、同じ名前を書いたのに環境で違うモデルが動く。
# ブラウザは ONNX に変換されたものしか読めないので、選べる幅はそちらで決まる。
# 増やせるかどうかの調べ方は docs/PYHIROBA_INTEGRATION.md の「モデルを増やす」に。
MODELS = {
    "qwen05": {
        "label": "Qwen2.5 0.5B（日本語が使えます・おすすめ）",
        "colab_id": "Qwen/Qwen2.5-0.5B-Instruct",
        "browser_repo": "onnx-community/Qwen2.5-0.5B-Instruct",
        "browser_key": "qwen05-q8",
        "browser_variants": ("qwen05-q8", "qwen05-q4"),
        "approx_mb": {"browser": 900, "colab": 1000},
    },
    "qwen15": {
        "label": "Qwen2.5 1.5B（日本語がより自然・重い）",
        "colab_id": "Qwen/Qwen2.5-1.5B-Instruct",
        "browser_repo": "onnx-community/Qwen2.5-1.5B-Instruct",
        "browser_key": "qwen15-q4",
        "browser_variants": ("qwen15-q4",),
        "approx_mb": {"browser": 1600, "colab": 3100},
    },
    "qwen3_06": {
        "label": "Qwen3 0.6B（Qwen2.5 0.5B より新しい・日本語が少し良い）",
        "colab_id": "Qwen/Qwen3-0.6B",
        "browser_repo": "onnx-community/Qwen3-0.6B-ONNX",
        "browser_key": "qwen3_06-q4",
        "browser_variants": ("qwen3_06-q4", "qwen3_06-q8"),
        "approx_mb": {"browser": 550, "colab": 1500},
        "has_thinking": True,
    },
    "qwen3_17": {
        "label": "Qwen3 1.7B（この一覧でいちばん賢い・重い）",
        "colab_id": "Qwen/Qwen3-1.7B",
        "browser_repo": "onnx-community/Qwen3-1.7B-ONNX",
        "browser_key": "qwen3_17-q4",
        "browser_variants": ("qwen3_17-q4",),
        "approx_mb": {"browser": 1300, "colab": 3400},
        "has_thinking": True,
    },
    "llmjp150m": {
        # instruct3 ではなく instruct2。ONNX に変換されているのが instruct2 だけで、
        # Colab をこちらに合わせないと、同じ名前で環境ごとに別のモデルが動いてしまう。
        # 150M では両者の差はほとんどなく、揃えるほうを採った。
        "label": "LLM-jp-3 150M（国産・とても軽い／文章は不自然です）",
        "colab_id": "llm-jp/llm-jp-3-150m-instruct2",
        "browser_repo": "onnx-community/llm-jp-3-150m-instruct2-ONNX",
        "browser_key": "llmjp150m-q4",
        "browser_variants": ("llmjp150m-q4",),
        "approx_mb": {"browser": 255, "colab": 600},
    },
}

DEFAULT_MODEL = "qwen05"

# ブラウザ固有の名前 → 共通の名前
_VARIANT_TO_BASE = {
    variant: base for base, spec in MODELS.items() for variant in spec["browser_variants"]
}


def resolve(name: str | None) -> tuple[str, str]:
    """モデル名を「共通の名前」と「ブラウザに渡す名前」の組にする。

    どちらの書き方で呼ばれても受け付ける。共通の名前だけを渡された場合、
    ブラウザには推奨の精度（``browser_key``）を渡す。
    """
    if name is None:
        name = DEFAULT_MODEL
    name = str(name)
    if name in MODELS:
        return name, MODELS[name]["browser_key"]
    if name in _VARIANT_TO_BASE:
        # 精度まで指定された場合は、その指定を尊重してそのまま渡す
        return _VARIANT_TO_BASE[name], name
    raise ValueError(
        f"そのモデルは選べません: {name}"
        "（await ai.models() で選べるものを確認できます）"
    )


# ---------------------------------------------------------------------------
# 考えている途中を隠す
# ---------------------------------------------------------------------------
# Qwen3 系は答えの前に <think>…</think> で考えを書く。授業では答えだけ見えれば
# よく、途中が出ると読みづらい。組み立てるときに出さない設定を頼み（古い版だと
# 通らないので、その時は黙って諦める）、出てきてしまったぶんは最後に削る。
# 本体（ブラウザ）側にも同じ処理を頼んである。docs/PYHIROBA_INTEGRATION.md 参照。
_THINKING_BLOCK = re.compile(r"<think>.*?</think>", re.S)


def strip_thinking(text: object) -> str:
    """``<think>…</think>`` を取り除く。考えるモデル以外には何も起きない。"""
    text = _THINKING_BLOCK.sub("", str(text))
    # 字数が尽きて閉じられなかった場合。答えはまだ書かれていないので、
    # 考えの途中を見せるより空で返す（呼び出し側が字数を増やせば済む）。
    unclosed = text.find("<think>")
    if unclosed != -1:
        text = text[:unclosed]
    return text.strip()


_OPEN_TAG = "<think>"


def _unfinished_tag_length(text: str) -> int:
    """末尾が ``<think>`` の書きかけなら、その長さを返す。

    ``答え<thi`` の ``<thi`` は続きが ``nk>`` かもしれない。出してしまうと
    取り消せないので、ここだけ保留する。書きかけでない普通の文字は待たせない。
    """
    for length in range(min(len(text), len(_OPEN_TAG) - 1), 0, -1):
        if _OPEN_TAG.startswith(text[-length:]):
            return length
    return 0


class ThinkingFilter:
    """少しずつ届く文字から、考えている途中を取り除いて渡す。

    届いた分を溜めたうえで毎回まるごと判定し、**前回より増えた分だけ**返す。
    ``<think>`` がチャンクの境目で割れても取りこぼさないのは、切れ端ではなく
    常に全文を見ているため。末尾は少し残す（``<thi`` まで届いた時点で出すと、
    続きが ``nk>`` だったときに取り消せない）。
    """

    def __init__(self) -> None:
        self._buffer = ""
        self._shown = ""

    def feed(self, chunk: str) -> str:
        """届いた分を渡し、表示してよくなった分を受け取る。"""
        self._buffer += str(chunk)
        return self._advance(hold_back=True)

    def finish(self) -> str:
        """もう続きが来ないとき、残りを全部受け取る。"""
        return self._advance(hold_back=False)

    def _advance(self, hold_back: bool) -> str:
        clean = strip_thinking(self._buffer)
        if hold_back:
            keep = _unfinished_tag_length(clean)
            if keep:
                clean = clean[:-keep]
        if len(clean) <= len(self._shown):
            return ""
        new, self._shown = clean[len(self._shown) :], clean
        return new


def _dtype_keyword(pipeline) -> str:
    """``pipeline()`` に数値の精度を渡すときのキーワード名。

    transformers 5 で ``torch_dtype`` は ``dtype`` に改名された。古い名前も
    まだ通るが、実行するたびに非推奨の警告が出る。Colab に入っている版が
    どちらでも警告なく動くよう、その版が受け付ける名前で渡す。
    """
    import inspect

    return "dtype" if "dtype" in inspect.signature(pipeline).parameters else "torch_dtype"


def in_browser() -> bool:
    """PyHiroba のワーカーの中にいるか。

    ``js`` が入るのは Pyodide だけで、``pyhirobaAsk`` を持つのは PyHiroba 本体だけ。
    """
    try:
        import js
    except ImportError:
        return False
    return hasattr(js, "pyhirobaAsk")


# ---------------------------------------------------------------------------


class Ai:
    """小さな言語モデルを動かす。PyHiroba と Colab で同じ使い方ができる。"""

    def __init__(self) -> None:
        self._pipe = None
        self._name: str | None = None

    async def models(self) -> list[dict]:
        """選べるモデルの一覧（名前と目安の通信量）。

        返す形はどちらの経路でも同じ ``[{"name", "label", "approxMB"}, …]``。
        通信量は環境で実際に違うため、その環境の値を返す。
        """
        where = "browser" if in_browser() else "colab"
        return [
            {"name": name, "label": spec["label"], "approxMB": spec["approx_mb"][where]}
            for name, spec in MODELS.items()
        ]

    async def load(self, model: str | None = None) -> str:
        """モデルを読み込む。初回だけ時間と通信量がかかる。"""
        base, browser_key = resolve(model)
        if in_browser():
            return await self._load_in_browser(browser_key)
        return self._load_with_transformers(base)

    async def ask(self, prompt: object, max_tokens: int | None = None) -> str:
        """文章を渡して、続きを書いてもらう。"""
        if in_browser():
            return await self._ask_in_browser(prompt, max_tokens)
        if self._pipe is None:
            await self.load()
        return self._ask_with_transformers(prompt, max_tokens)

    async def stream(self, prompt: object, max_tokens: int | None = None):
        """答えを、書けたところから少しずつ受け取る。

        ``ask()`` は全部書き終わるまで返らない。小さなモデルでも数十秒かかる
        ことがあり、そのあいだ画面が変わらない。こちらは届いたぶんから返す。

            text = ""
            async for chunk in ai.stream("日本の四季について"):
                text += chunk
                print(text)

        つなげると ``ask()`` と同じ文になる。**少しずつ返せない環境では、
        全部書き終えてから一度にまとめて返す**（同じコードが動くことを優先）。
        """
        if in_browser():
            async for chunk in self._stream_in_browser(prompt, max_tokens):
                yield chunk
            return
        if self._pipe is None:
            await self.load()
        async for chunk in self._stream_with_transformers(prompt, max_tokens):
            yield chunk

    # --- ブラウザ経路（PyHiroba 本体との契約） -----------------------------
    #
    # 本体のワーカーが js.pyhirobaAsk(kind, argsJson) -> Promise<resultJson> を用意する。
    # やり取りは JSON 文字列だけ（Pyodide と JS の境界を単純に保つため）。
    # kind は本体の許可リストにある ai-load / ai-ask / ai-models の3つのみ。

    async def _call_host(self, kind: str, args_json: str) -> dict:
        import json

        import js

        raw = await js.pyhirobaAsk(kind, args_json)
        # 本体が壊れた応答を返したときに、JSONDecodeError や
        # 「'list' object has no attribute 'get'」のような、利用者には意味の
        # 分からない例外で止まらないようにする。原因の見当がつく文言にする。
        try:
            result = json.loads(raw)
        except (TypeError, ValueError) as error:
            raise RuntimeError(
                f"PyHiroba 本体からの返事を読み取れませんでした（{kind}）。"
                f"本体側の不具合の可能性があります。返ってきた内容: {str(raw)[:80]!r}"
            ) from error
        if not isinstance(result, dict):
            raise RuntimeError(
                f"PyHiroba 本体からの返事の形が違います（{kind}）。"
                f"{{…}} の形を期待しましたが {type(result).__name__} でした。"
            )
        return result

    async def _load_in_browser(self, browser_key: str) -> str:
        import json

        result = await self._call_host("ai-load", json.dumps({"model": browser_key}))
        self._name = browser_key
        return result.get("message", "準備ができました")

    async def _ask_in_browser(self, prompt: object, max_tokens: int | None) -> str:
        import json

        if self._name is None:
            await self.load()
        result = await self._call_host(
            "ai-ask", json.dumps({"prompt": str(prompt), "max_tokens": max_tokens})
        )
        # 本体側でも削ってもらう約束だが、こちらでも通す。本体が削り忘れても
        # 両方の経路で同じ結果になるようにするため（二重にかけても何も起きない）。
        return strip_thinking(result.get("text", ""))

    async def _stream_in_browser(self, prompt: object, max_tokens: int | None):
        """本体が少しずつ返せるなら使い、無理なら ``ai-ask`` に落とす。

        本体との受け渡しは「1回頼んで1回返る」形しか無いので、少しずつ受け取る
        ときは ``ai-ask-start`` で始めて ``ai-ask-next`` を繰り返し呼ぶ。
        本体がこれを知らない場合（古い版・未実装）は、そのまま ``ai-ask`` で
        全文を受け取って一度に返す。詳しくは docs/PYHIROBA_INTEGRATION.md。
        """
        import json

        if self._name is None:
            await self.load()
        try:
            started = await self._call_host(
                "ai-ask-start", json.dumps({"prompt": str(prompt), "max_tokens": max_tokens})
            )
            stream_id = started.get("id")
        except Exception:  # noqa: BLE001 — 未対応の伝わり方は本体次第
            stream_id = None
        if not stream_id:
            # 少しずつは無理だった。全文を一度に返す
            yield await self._ask_in_browser(prompt, max_tokens)
            return

        thinking = ThinkingFilter()
        while True:
            part = await self._call_host("ai-ask-next", json.dumps({"id": stream_id}))
            if part.get("done"):
                last = thinking.feed(part.get("text", "")) + thinking.finish()
                if last:
                    yield last
                return
            chunk = thinking.feed(part.get("text", ""))
            if chunk:
                yield chunk

    # --- Colab 経路（transformers + torch） --------------------------------

    def _load_with_transformers(self, base: str) -> str:
        if self._pipe is not None and self._name == base:
            return "すでに準備できています"

        try:
            import torch
            from transformers import pipeline
        except ImportError as error:
            raise ImportError(
                "transformers と torch が必要です。次の行を先に実行してください:\n"
                '    !pip install -q "library-hiroba[ai]"'
            ) from error

        device = 0 if torch.cuda.is_available() else -1
        self._pipe = pipeline(
            "text-generation",
            model=MODELS[base]["colab_id"],
            device=device,
            **{_dtype_keyword(pipeline): torch.float16 if device == 0 else torch.float32},
        )
        self._name = base
        where = "GPU" if device == 0 else "CPU"
        return f"準備ができました（{MODELS[base]['label']}／{where}で動きます）"

    def _build_input(self, messages: list[dict]):
        """モデルに渡すものを組み立てる。

        考えるモデルには「考えを書かないで」と頼んだうえで渡す。頼めない古い
        テンプレートのときは、そのまま渡して後から削る（``strip_thinking``）。
        """
        if not MODELS[self._name].get("has_thinking"):
            return messages
        tokenizer = getattr(self._pipe, "tokenizer", None)
        if tokenizer is None:
            return messages
        try:
            return tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
                enable_thinking=False,
            )
        except (AttributeError, TypeError, ValueError):
            # テンプレートが enable_thinking を知らない版か、そもそも
            # apply_chat_template を持たない場合。会話の形のまま渡して、
            # 出力側の削り取り（strip_thinking）だけで対処する。
            return messages

    def _generation_kwargs(self, max_tokens: int | None) -> dict:
        # 生成の設定はブラウザ側と揃えてある。小さなモデルはばらつきを大きくすると
        # 意味の通らない文章になりやすいので、温度を下げ繰り返しを抑える。
        return {
            "max_new_tokens": max_tokens or 256,
            "temperature": 0.3,
            "top_p": 0.9,
            "repetition_penalty": 1.15,
            "do_sample": True,
            "return_full_text": False,
        }

    async def _stream_with_transformers(self, prompt: object, max_tokens: int | None):
        """生成を別スレッドで走らせ、書けた分から受け取る。

        transformers の streamer は「次が来るまで待つ」ふつうの反復子なので、
        そのまま回すとノートブック全体が止まる。1つ取り出すごとに別スレッドへ
        逃がして、待っているあいだ画面が動けるようにする。
        """
        import asyncio
        import threading

        try:
            from transformers import TextIteratorStreamer
        except ImportError:
            # 少しずつ返せない版。全部書けてから一度に返す（同じコードは動く）
            yield self._ask_with_transformers(prompt, max_tokens)
            return

        streamer = TextIteratorStreamer(
            self._pipe.tokenizer, skip_prompt=True, skip_special_tokens=True
        )
        messages = [{"role": "user", "content": str(prompt)}]
        failure: list[BaseException] = []

        def generate() -> None:
            try:
                self._pipe(
                    self._build_input(messages),
                    streamer=streamer,
                    **self._generation_kwargs(max_tokens),
                )
            except BaseException as error:  # noqa: BLE001 — 呼び出し側へ運ぶ
                failure.append(error)
                streamer.end()

        worker = threading.Thread(target=generate, daemon=True)
        worker.start()

        loop = asyncio.get_running_loop()
        iterator = iter(streamer)
        stop = object()
        thinking = ThinkingFilter()
        while True:
            piece = await loop.run_in_executor(None, lambda: next(iterator, stop))
            if piece is stop:
                break
            chunk = thinking.feed(piece)
            if chunk:
                yield chunk
        # 生成側で落ちていたら、黙って短い答えを返さずに知らせる
        if failure:
            raise failure[0]
        last = thinking.finish()
        if last:
            yield last

    def _ask_with_transformers(self, prompt: object, max_tokens: int | None) -> str:
        out = self._pipe(
            self._build_input([{"role": "user", "content": str(prompt)}]),
            **self._generation_kwargs(max_tokens),
        )
        text = out[0]["generated_text"]
        # 会話形式で渡すと返り値も会話の並びになる。最後の発言を取り出す。
        if isinstance(text, list):
            text = (text[-1] or {}).get("content", "") if text else ""
        return strip_thinking(str(text))


ai = Ai()
