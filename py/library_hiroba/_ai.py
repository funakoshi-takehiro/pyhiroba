"""小さな言語モデルを、PyHiroba でも Colab でも同じ書き方で動かす。

    from library_hiroba import ai

    await ai.load()
    print(await ai.ask("日本の四季について、2行で書いて"))

どのモデルを選ぶか迷ったら、環境を調べて決めさせられます::

    await ai.recommend()     # 調べた結果とおすすめを表示
    await ai.load("auto")    # おすすめを読み込む

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
#
# ``rank`` と ``needs`` は ``recommend()`` が使う（下の「おすすめを選ぶ」参照）。
#   rank  … 答えの質の順。大きいほど良い。重なりが無いこと（テストで固定）
#   needs … その環境で実用になる最低条件。approx_mb から機械的に出さず手で書く。
#           通信量と、動かすのに要るものは比例しないため（量子化の効き方が違う）。
#           browser: webgpu は True なら必須、False なら無くても動く
#           colab:   vram_gb は None なら GPU 不要、数値なら GPU が要る
MODELS = {
    "qwen05": {
        "label": "Qwen2.5 0.5B（日本語が使えます・おすすめ）",
        "colab_id": "Qwen/Qwen2.5-0.5B-Instruct",
        "browser_repo": "onnx-community/Qwen2.5-0.5B-Instruct",
        "browser_key": "qwen05-q8",
        "browser_variants": ("qwen05-q8", "qwen05-q4"),
        "approx_mb": {"browser": 900, "colab": 1000},
        "rank": 2,
        "needs": {
            "browser": {"webgpu": True, "memory_gb": 4, "storage_mb": 1400},
            "colab": {"ram_gb": 4, "vram_gb": None},
        },
    },
    "qwen15": {
        "label": "Qwen2.5 1.5B（日本語がより自然・重い）",
        "colab_id": "Qwen/Qwen2.5-1.5B-Instruct",
        "browser_repo": "onnx-community/Qwen2.5-1.5B-Instruct",
        "browser_key": "qwen15-q4",
        "browser_variants": ("qwen15-q4",),
        "approx_mb": {"browser": 1600, "colab": 3100},
        "rank": 4,
        "needs": {
            "browser": {"webgpu": True, "memory_gb": 8, "storage_mb": 2400},
            # CPU だけで 1.5B を動かすと1回の返事に数分かかる。授業では待てない
            "colab": {"ram_gb": 8, "vram_gb": 4},
        },
    },
    "qwen3_06": {
        "label": "Qwen3 0.6B（Qwen2.5 0.5B より新しい・日本語が少し良い）",
        "colab_id": "Qwen/Qwen3-0.6B",
        "browser_repo": "onnx-community/Qwen3-0.6B-ONNX",
        # 既定は q4 ではなく q8。このモデルでは 8bit のほうが**小さく、しかも精度が
        # 高い**（PyHiroba 側の実測で q4 877MB / q8 589MB）。逆に見えるが、q4 は
        # MatMul の重みだけを 4bit にし、埋め込み（Gather）は fp32 のまま残すため。
        # Qwen3 0.6B は語彙が 151936 と大きく、埋め込みだけで全体の 26%（156M）を
        # 占めるので、そこが fp32 で残ると 4bit にした分を打ち消して上回る。
        "browser_key": "qwen3_06-q8",
        "browser_variants": ("qwen3_06-q8", "qwen3_06-q4"),
        "approx_mb": {"browser": 589, "colab": 1500},
        "has_thinking": True,
        "rank": 3,
        # 一覧の中でいちばん小さいのに、答えは 150M よりずっとまともになる。
        # メモリの少ない端末を救えるのはここなので、条件をいちばん緩くしてある
        # （qwen05 より下。navigator.deviceMemory の 2 は低スペック機の区分）
        "needs": {
            "browser": {"webgpu": True, "memory_gb": 2, "storage_mb": 900},
            "colab": {"ram_gb": 4, "vram_gb": None},
        },
    },
    "qwen3_17": {
        "label": "Qwen3 1.7B（この一覧でいちばん賢い・重い）",
        "colab_id": "Qwen/Qwen3-1.7B",
        "browser_repo": "onnx-community/Qwen3-1.7B-ONNX",
        "browser_key": "qwen3_17-q4",
        "browser_variants": ("qwen3_17-q4",),
        "approx_mb": {"browser": 1300, "colab": 3400},
        "has_thinking": True,
        "rank": 5,
        "needs": {
            "browser": {"webgpu": True, "memory_gb": 8, "storage_mb": 2000},
            "colab": {"ram_gb": 8, "vram_gb": 4},
        },
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
        "rank": 1,
        # 150M なら WebGPU が無くても（WASM でも）待てる速さで返る。
        # これがあるおかげで「何も動かない環境」を作らずに済む
        "needs": {
            "browser": {"webgpu": False, "memory_gb": 1, "storage_mb": 400},
            "colab": {"ram_gb": 2, "vram_gb": None},
        },
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
# 動く環境を調べる
# ---------------------------------------------------------------------------
# 同じ教材を配っても、WebGPU の使える端末では qwen3_17 が数秒で返り、使えない
# 端末では同じ行で画面が固まる。利用者からこの差は見えないので、先に調べる。
#
# 返す形は両方の経路で同じにする（``models()`` と同じ方針）。調べられなかった
# ときは例外にせず ``known: False`` を返す。ここで止まると、本題である
# 「モデルを動かす」に進めなくなるため。

_ENVIRONMENT_KEYS = (
    "known",  # 調べがついたか。False なら以下は当てにしない
    "where",  # "browser" か "colab"
    "webgpu",
    "memory_gb",  # ブラウザが言う端末のメモリ
    "ram_gb",  # 機械の総メモリ（Colab 側）
    "vram_gb",  # GPU のメモリ。None なら GPU 無し
    "cores",
    "storage_mb",  # モデルを置ける空き
    "label",  # 表示に使うだけ（"Chrome 120" / "Tesla T4"）
)


def _blank(where: str) -> dict:
    """何も分かっていない状態。分かったものだけを上書きしていく。"""
    found = dict.fromkeys(_ENVIRONMENT_KEYS)
    found.update(known=False, where=where, webgpu=False, label="")
    return found


def _number(value: object) -> float | None:
    """JSON から来た数値だけを受け取る。数でなければ「無かった」とみなす。"""
    # bool は int の一種なので、先に弾かないと True が 1 として通ってしまう
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


def _total_ram_gb() -> float | None:
    """この機械の総メモリ（GB）。読めなければ ``None``。

    psutil を足さずに済ませるため ``/proc/meminfo`` を直接読む。Colab は
    Linux なので必ずある。無い環境（Windows など）では黙って ``None`` にする。
    """
    try:
        with open("/proc/meminfo", encoding="ascii") as meminfo:
            for line in meminfo:
                if line.startswith("MemTotal:"):
                    return round(int(line.split()[1]) / (1024 * 1024), 1)
    except (OSError, ValueError, IndexError):
        return None
    return None


def _probe_runtime() -> dict:
    """Colab など、Python がそのまま動く環境を調べる。追加の依存は使わない。"""
    import os
    import shutil

    found = _blank("colab")
    found["cores"] = os.cpu_count()
    found["ram_gb"] = _total_ram_gb()
    try:
        found["storage_mb"] = shutil.disk_usage(".").free // (1024 * 1024)
    except OSError:
        pass

    found["label"] = "CPU"
    try:
        import torch

        if torch.cuda.is_available():
            properties = torch.cuda.get_device_properties(0)
            found["vram_gb"] = round(properties.total_memory / (1024**3), 1)
            found["label"] = str(getattr(properties, "name", None) or "GPU")
    except ImportError:
        # まだ入れていないだけ。読み込もうとした時点で _load_with_transformers が
        # 入れ方を案内するので、ここでは CPU として進める
        pass
    except Exception:  # noqa: BLE001 — 壊れた torch で環境調べまで巻き添えにしない
        pass

    # 何ひとつ測れていないのに「調べた」と言うと、根拠の無いおすすめが出てしまう
    found["known"] = found["ram_gb"] is not None or found["vram_gb"] is not None
    return found


# ---------------------------------------------------------------------------
# おすすめを選ぶ
# ---------------------------------------------------------------------------

# 控えめなものから順に。おすすめは「動くもののうち、いちばん後ろ」になる
_RANKED = sorted(MODELS, key=lambda name: MODELS[name]["rank"])
_SAFEST = _RANKED[0]

# 測れなかったときに、その環境で何が分からなかったのかを言うための名前
_UNMEASURED = {"browser": "この端末のメモリ", "colab": "この環境のメモリ"}


def _short_label(name: str) -> str:
    """理由の文に混ぜるための短い名前。

    ``label`` は一覧で読む前提の長さ（括弧に特徴を書いてある）で、文に入れると
    一文が二行になって読めない。``Qwen2.5 0.5B`` のところまでで切る。
    """
    return MODELS[name]["label"].split("（")[0].strip()


def _unmet(name: str, environment: dict) -> list[str]:
    """``name`` に足りないものを並べる。空なら、その環境で動く見込み。

    **測れなかった値は足りないことにしない。** ``navigator.deviceMemory`` は
    Firefox と Safari には無く、そこで全部を弾くと「WebGPU があるのに最小の
    モデル」になってしまう。測れなかった場合の用心は ``choose()`` 側で行う。
    """
    needs = MODELS[name]["needs"][environment.get("where", "colab")]
    missing = []
    if environment.get("where") == "browser":
        if needs["webgpu"] and not environment.get("webgpu"):
            missing.append("WebGPU")
        memory = environment.get("memory_gb")
        if memory is not None and memory < needs["memory_gb"]:
            missing.append(f"メモリ {needs['memory_gb']}GB")
        storage = environment.get("storage_mb")
        if storage is not None and storage < needs["storage_mb"]:
            missing.append(f"空き容量 {needs['storage_mb']}MB")
    else:
        ram = environment.get("ram_gb")
        if ram is not None and ram < needs["ram_gb"]:
            missing.append(f"メモリ {needs['ram_gb']}GB")
        # GPU の有無は torch がはっきり答えるので、無い＝足りない で確定できる
        if needs["vram_gb"] is not None:
            vram = environment.get("vram_gb")
            if vram is None or vram < needs["vram_gb"]:
                missing.append(f"GPU（VRAM {needs['vram_gb']}GB）")
    return missing


def _measured_enough(environment: dict) -> bool:
    """おすすめの決め手になるメモリを、実際に測れたか。"""
    key = "memory_gb" if environment.get("where") == "browser" else "ram_gb"
    return environment.get(key) is not None


def _why(name: str, environment: dict) -> str:
    """``name`` になった理由。「なぜこれ以上にしなかったか」を言う。"""
    better = [n for n in _RANKED if MODELS[n]["rank"] > MODELS[name]["rank"]]
    if not better:
        return f"この環境なら、一覧でいちばん賢い{_short_label(name)}が動きます。"
    lacking = "・".join(_unmet(better[0], environment))
    return (
        f"{_short_label(better[0])}には{lacking}が足りないので、"
        f"{_short_label(name)}を選びました。"
    )


def choose(environment: dict) -> tuple[str, str]:
    """調べた環境から、おすすめのモデル名と理由を決める。

    ``Ai`` のメソッドにしていないのは、環境を作らずに総当たりで確かめられる
    ようにするため（``strip_thinking`` と同じ理由）。
    """
    if not environment.get("known"):
        return DEFAULT_MODEL, (
            f"環境を調べられなかったので、標準の{_short_label(DEFAULT_MODEL)}を選びました。"
        )

    fits = [name for name in _RANKED if not _unmet(name, environment)]
    if not fits:
        lacking = "・".join(_unmet(_SAFEST, environment))
        return _SAFEST, (
            f"{lacking}が足りず、動かないかもしれません。"
            f"いちばん軽い{_short_label(_SAFEST)}を選びました。"
        )

    if _measured_enough(environment):
        name = fits[-1]
    else:
        # 測れなかった項目がある。動くと分かっている範囲で、標準より上には行かない。
        # 「たぶん動く」で重いものを選ぶと、外れたときに固まって授業が止まる
        allowed = [n for n in fits if MODELS[n]["rank"] <= MODELS[DEFAULT_MODEL]["rank"]]
        name = allowed[-1] if allowed else fits[0]
        if name != fits[-1]:
            where = environment.get("where", "colab")
            return name, (
                f"{_UNMEASURED.get(where, 'メモリ')}が分からなかったので、"
                f"確実に動く{_short_label(name)}を選びました。"
            )

    return name, _why(name, environment)


class Recommendation:
    """おすすめのモデルと、その理由。セルに置くとそのまま表示される。

        found = await ai.recommend()
        found            # 表示される
        found.name       # "qwen05" のような、load() に渡せる名前

    ``ui`` の部品を組み立てて返すだけで、AI 用の見た目は別に持たない。
    """

    def __init__(self, name: str, reason: str, environment: dict) -> None:
        self.name = name
        self.reason = reason
        self.environment = environment

    def __repr__(self) -> str:
        return f"おすすめ: {self.name}（{self.reason}）"

    def rows(self) -> list[list[str]]:
        """調べて分かったことだけを、表の行にする。"""
        found = self.environment
        rows = []
        if found.get("label"):
            rows.append(["動いている場所", found["label"]])
        if found.get("where") == "browser":
            rows.append(["WebGPU", "使えます" if found.get("webgpu") else "使えません"])
        if found.get("vram_gb") is not None:
            rows.append(["GPU のメモリ", f"約 {found['vram_gb']}GB"])
        for key in ("memory_gb", "ram_gb"):
            if found.get(key) is not None:
                rows.append(["メモリ", f"約 {found[key]}GB"])
        if found.get("cores") is not None:
            rows.append(["CPU のコア数", str(found["cores"])])
        if found.get("storage_mb") is not None:
            rows.append(["空き容量", f"約 {round(found['storage_mb'] / 1024, 1)}GB"])
        rows.append(["読み込む名前", self.name])
        return rows

    def _repr_html_(self) -> str:
        # ui は AI と切り離して使えるようにしてあるので、表示するここで初めて
        # 読み込む（_forms.py が _components.thinking をそうしているのと同じ）
        from . import ui

        return ui.stack(
            ui.card(f"おすすめ: {MODELS[self.name]['label']}", self.reason, icon="✨"),
            ui.table(self.rows(), headers=["調べたこと", "結果"]),
        )._repr_html_()


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


def check_max_tokens(max_tokens: object) -> None:
    """字数の指定が使える値かを、モデルに渡す前に確かめる。

    素通しすると気付けない形で外れる。Colab では transformers の奥から
    読めない例外が出て、ブラウザでは本体が黙って既定値に戻すため、
    ``max_tokens=-50`` と書いた本人には何が起きたのか分からない。
    """
    if max_tokens is None:
        return
    # bool は int の一種。ai.ask(p, max_tokens=True) を 1 として通さない
    if isinstance(max_tokens, bool) or not isinstance(max_tokens, int) or max_tokens < 1:
        raise ValueError(
            f"max_tokens には 1 以上の整数を指定してください（指定値: {max_tokens!r}）。"
            "省略すると 256 になります。"
        )


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

    async def environment(self) -> dict:
        """いま動いている環境で、モデルに使えるものを調べる。

        返す形はどちらの経路でも同じ辞書。調べられなかったときは例外にせず
        ``known`` が ``False`` の辞書を返す（ここで止めると本題に進めないため）。
        """
        if in_browser():
            return await self._probe_browser()
        return _probe_runtime()

    async def recommend(self) -> Recommendation:
        """この環境で実用になるもののうち、いちばん良いモデルを選ぶ。

        そのままセルに置くと、調べた結果と理由が表示される。
        ``await ai.load("auto")`` は、これと同じ判断で読み込む。
        """
        found = await self.environment()
        name, reason = choose(found)
        return Recommendation(name, reason, found)

    async def load(self, model: str | None = None) -> str:
        """モデルを読み込む。初回だけ時間と通信量がかかる。

        ``ai.load("auto")`` にすると、環境を調べてから選ぶ（``recommend()``
        と同じ判断）。引数を省いたときは、環境によらず標準のモデルを読む。
        """
        if isinstance(model, str) and model.strip().lower() == "auto":
            model = (await self.recommend()).name
        base, browser_key = resolve(model)
        if in_browser():
            return await self._load_in_browser(browser_key)
        return self._load_with_transformers(base)

    async def ask(self, prompt: object, max_tokens: int | None = None) -> str:
        """文章を渡して、続きを書いてもらう。"""
        check_max_tokens(max_tokens)
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
        check_max_tokens(max_tokens)
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
    # kind は本体の許可リストにあるものだけを使う。
    #   必須 … ai-load / ai-ask
    #   任意 … ai-ask-start / ai-ask-next（少しずつ返す）、ai-probe（環境を調べる）
    # 任意のものは、本体が知らなければ自動的に必須のほうへ落ちる。
    # ai-models は許可リストにあっても呼ばない（理由は PYHIROBA_INTEGRATION.md）。

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

    async def _probe_browser(self) -> dict:
        """本体に端末のことを尋ねる。対応は任意なので、無理なら分からないままにする。"""
        import json

        try:
            result = await self._call_host("ai-probe", json.dumps({}))
        except Exception:  # noqa: BLE001 — 未対応の伝わり方は本体次第
            return _blank("browser")
        # 知らない kind に空の {} を返す本体もある。webgpu だけは必ず入れて
        # もらう約束なので、無ければ「答えられなかった」とみなす
        if "webgpu" not in result:
            return _blank("browser")

        found = _blank("browser")
        found.update(
            known=True,
            webgpu=bool(result.get("webgpu")),
            memory_gb=_number(result.get("memoryGB")),
            cores=_number(result.get("cores")),
            storage_mb=_number(result.get("storageMB")),
            label=str(result.get("browser") or ""),
        )
        return found

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
