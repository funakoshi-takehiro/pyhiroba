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

# 次の1文字を待つ上限（秒）。ここを無しにすると永久に待つため、生成側が黙って
# 止まったときに「考え中」から抜けられなくなる。1文字あたりの上限なので、
# CPU だけで大きめのモデルを動かす場合を見込んで長めにとる。
STREAM_TIMEOUT_SECONDS = 300.0

# 上の上限を、この長さに区切って待つ。1回の待ちを短くしておかないと、生成が
# 詰まったときに待ち役のスレッドが解放されず、後片付けでぶら下がる
# （run_in_executor の既定スレッドは終了時に join されるため）。
STREAM_POLL_SECONDS = 1.0

# ---------------------------------------------------------------------------
# 埋め込み（文を数のならびにする）モデル
# ---------------------------------------------------------------------------
# **チャットの MODELS とは別にする。** 同じ辞書に入れると、次の3つが壊れる。
#   - ai.models() の一覧に、生成できないモデルが「選べるもの」として並ぶ
#   - ai.load("minilm") が通り、生成用でないモデルが _pipe に載って ask() が壊れる
#   - recommend() が rank を見るので、条件次第で埋め込みモデルを薦めてしまう
#
# colab_id と browser_repo は**同じモデルの別形式**でなければいけない
# （チャット側と同じ約束。テストで名前の一致を確かめている）。
EMBED_MODELS = {
    "minilm": {
        "label": "多言語 MiniLM（文の意味をベクトルにする）",
        "colab_id": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        "browser_repo": "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
        "approx_mb": {"browser": 118, "colab": 480},
        "dim": 384,
    },
}

DEFAULT_EMBED_MODEL = "minilm"

# 一度に本体へ渡す文の数。本体は 257 件以上を断るので、こちらで分けてから渡す。
# 素通しすると、同じコードが PyHiroba では失敗して Colab では通ってしまう。
EMBED_BATCH = 256


def resolve_embed(name: str | None) -> str:
    """埋め込みモデルの名前を確かめる。``ai.load()`` とは別の一覧を見る。"""
    if name is None:
        return DEFAULT_EMBED_MODEL
    name = str(name)
    if name in EMBED_MODELS:
        return name
    raise ValueError(
        f"その埋め込みモデルは選べません: {name}"
        f"（選べるのは {list(EMBED_MODELS)}）"
    )


# 一度に受け取る文の上限。教室で使う数（10〜100冊）からは十分に離してあるが、
# 際限なく受けるとブラウザが何分も固まったまま落ちる。理由を言って先に止める。
EMBED_LIMIT = 10000


def as_texts(value: object, argument: str) -> list[str]:
    """文の並びとして受け取れる形にそろえる。

    **黙って別の意味になる書き方を、ここで止める。** 文字列をそのまま渡すと
    1文字ずつに分かれ、辞書を渡すとキーだけが使われる。どちらも例外にならず、
    「なぜか結果がおかしい」とだけ見える。
    """
    if isinstance(value, str):
        raise ValueError(
            f"{argument} には文のリストを渡してください。"
            "文字列をそのまま渡すと、1文字ずつ別の文として扱われます"
            '（1文だけなら ["…"] のように包んでください）'
        )
    if isinstance(value, dict):
        raise ValueError(
            f"{argument} に辞書を渡すと、キーだけが使われて中身が消えます。"
            'リストにしてください（例: [b["desc"] for b in books]）'
        )
    try:
        items = [str(item) for item in value]
    except TypeError:
        raise ValueError(
            f"{argument} には文のリストを渡してください"
            f"（渡されたのは {type(value).__name__}）"
        ) from None
    if len(items) > EMBED_LIMIT:
        raise ValueError(
            f"一度に渡せるのは {EMBED_LIMIT} 件までです（渡されたのは {len(items)} 件）。"
            "分けて呼んでください。"
        )
    return items


def dot(a, b) -> float:
    """内積。ベクトルが L2 正規化済みなら、これがそのままコサイン類似度になる。

    numpy は使わない。10冊×384次元なら掛け算 3840 回で、追加の依存を増やす
    ほどではないため（利用者が教材の中で numpy を使うのは自由）。

    長さが違うものは比べない。``zip`` は黙って短いほうに切りそろえるので、
    そのままだと**近い順だけが静かに狂う**。
    """
    if len(a) != len(b):
        raise ValueError(f"長さの違うベクトルは比べられません（{len(a)} と {len(b)}）")
    return float(sum(x * y for x, y in zip(a, b)))


def check_normalized(vector) -> None:
    """本体が返したベクトルの長さが 1 か確かめる。

    正規化されていないと内積がコサイン類似度にならず、**近い順が静かに狂う**。
    気付けないまま教材が「なぜかおかしい」状態になるので、ここで止める。
    """
    if not vector:
        return
    length = sum(x * x for x in vector) ** 0.5
    if not 0.9 <= length <= 1.1:
        raise RuntimeError(
            f"PyHiroba 本体から返ったベクトルが正規化されていません（長さ {length:.3f}）。"
            "本体側の不具合の可能性があります。"
        )


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


class Talk:
    """AI との会話。前のやりとりを覚えていて、続きが通じる。

        talk = ai.talk()
        await talk.ask("日本で一番高い山は？")
        await talk.ask("その高さは？")      # 「その」が山を指すと分かる

    ``ask()`` と ``stream()`` は :class:`Conversation` を返すので、セル最後の
    式に置けば吹き出しで表示される。

    :meth:`Ai.ask` が受け取るのは1回分の文章だけで、前に何を話したかは覚えて
    いない。ここが引き受けているのは、その差を埋める3つの後始末:

    1. 直前 ``keep`` 往復ぶんを添えて渡す（記憶）
    2. 答えたあとにモデルが自分で書き足した会話の続きを切り落とす
    3. 少しずつ届く答えを、そのつど吹き出しに組み直す
    """

    #: 添える指示。何も言わないと、小さなモデルは延々と書き続けがち
    DEFAULT_INSTRUCTION = "これまでの会話です。AI として、最後の質問に日本語で短く答えてください。"

    #: モデルが勝手に会話を続けたときの切れ目
    CONTINUATIONS = ("あなた:", "あなた：", "\nAI:")

    #: 一文字も返らなかったときに出す言葉。空の吹き出しは故障に見える
    NO_ANSWER = "（答えが返りませんでした。max_tokens を増やすか、別のモデルを試してみてください）"

    def __init__(
        self,
        ai: Ai,
        keep: int = 4,
        max_tokens: int = 96,
        names: dict | None = None,
        instruction: str | None = None,
    ) -> None:
        if keep < 1:
            raise ValueError(f"keep は1以上にしてください（指定値: {keep!r}）")
        check_max_tokens(max_tokens)
        from . import ui

        self._ai = ai
        self.keep = keep
        self.max_tokens = max_tokens
        self.instruction = self.DEFAULT_INSTRUCTION if instruction is None else instruction
        self.conversation = ui.conversation(names=names)

    def __repr__(self) -> str:
        return f"<library_hiroba.Talk 発言 {len(self.conversation)} 件>"

    def _repr_html_(self) -> str:
        return self.conversation._repr_html_()

    def clear(self) -> Talk:
        """会話をやり直す。"""
        self.conversation.clear()
        return self

    @property
    def messages(self) -> list[dict]:
        """いままでの会話。``ui.chat()`` にそのまま渡せる。"""
        return self.conversation.messages

    def _prompt(self, message: object) -> str:
        """直前のやりとりを添えた、モデルに渡す文章を作る。"""
        recent = self.messages[-self.keep * 2 :]
        lines = [self.instruction, ""]
        for said in recent:
            who = "あなた" if said["role"] == "user" else "AI"
            lines.append(f"{who}: {said['content']}")
        lines.append(f"あなた: {message}")
        lines.append("AI:")
        return "\n".join(lines)

    def _clean(self, text: str) -> str:
        """モデルが書き足した会話の続きを切り落とす。"""
        for marker in self.CONTINUATIONS:
            if marker in text:
                text = text.split(marker)[0]
        return text.strip()

    async def ask(self, message: object):
        """1往復して、会話ぜんぶを返す。"""
        prompt = self._prompt(message)
        self.conversation.say(message)
        answer = await self._ai.ask(prompt, max_tokens=self.max_tokens)
        self.conversation.reply(self._clean(answer) or self.NO_ANSWER)
        return self.conversation

    #: 待っているあいだ、経過を出し直す間隔（秒）
    TICK_SECONDS = 1.0

    def _waiting(self, seconds: float = 0.0):
        """答えを待つあいだ、AI の側に出しておくもの。

        **経過した秒数を出す。** 止まっているのか進んでいるのかが、これでしか
        分からない。動かない「考え中」は、故障と見分けが付かない。

        読み込みと生成も分けて言う。初回の読み込みは数分かかることがある。
        """
        from . import ui

        passed = f"{int(seconds)}秒" if seconds >= 1 else ""
        if self._ai.is_loaded():
            return ui.thinking(f"考え中 {passed}".strip())
        return ui.thinking(f"モデルを読み込んでいます（初回は数分かかります）{passed}")

    async def stream(self, message: object):
        """同じことを、書けたところから少しずつ返す。

        書きかけは会話に入れず、**その回だけの写しに載せて**返す。入れてしまうと
        次の質問に渡す記憶が、書きかけの文で埋まる。
        """
        import asyncio
        import time

        from . import ui

        prompt = self._prompt(message)
        self.conversation.say(message)

        def view(content):
            return ui.conversation(
                [*self.messages, {"role": "assistant", "content": content}],
                names=self.conversation.names,
            )

        # 打った内容を、答えを待たずに先に返す。ここを待ってから出すと、
        # 画面には「考え中」しか無い時間が続き、送れたのかどうかも分からない
        started = time.monotonic()
        yield view(self._waiting())

        text = ""
        # 1文字ずつ待つあいだも、経過を出し直す。じっと動かない「考え中」は
        # 故障と見分けが付かず、実際それで何度も止まったと判断された。
        # __anext__ を task にして待つ（wait_for は待ちきれないと相手を
        # 取り消してしまい、途中まで進んだ生成が壊れる）
        source = self._ai.stream(prompt, max_tokens=self.max_tokens).__aiter__()
        while True:
            coming = asyncio.ensure_future(source.__anext__())
            try:
                while not (await asyncio.wait({coming}, timeout=self.TICK_SECONDS))[0]:
                    if not self._clean(text):
                        yield view(self._waiting(time.monotonic() - started))
                chunk = coming.result()
            except StopAsyncIteration:
                break
            except BaseException:
                coming.cancel()
                raise
            text += chunk
            partial = self._clean(text)
            if partial:
                yield view(partial)
        # 一文字も出ないまま終わることがある（考えている途中だけを書いて
        # 字数が尽きた場合など）。空の吹き出しは故障に見えるので、そう言う
        self.conversation.reply(self._clean(text) or self.NO_ANSWER)
        yield self.conversation

    def form(self, placeholder: str = "メッセージを入力", submit_label: str = "送信", **kwargs):
        """入力欄・送信ボタン・吹き出しをまとめて出す。

        >>> chat = ai.talk()
        >>> chat.form()

        ``ui.form()`` は入力欄の name をそのままキーワード引数にするため、
        :meth:`stream` の引数名と揃っている必要がある。ここが両方を持つので、
        使う側で名前を合わせなくてよい。

        フォームに対応していない古い PyHiroba で開いた場合だけ、注意書きを
        添えて出す。対応済みの本体（``pyhirobaFeatures`` に ``forms`` がある）
        と Colab では、そのまま出す。
        """
        from . import ui

        built = ui.form(
            self.stream,
            ui.field("message", label="", placeholder=placeholder),
            submit_label=submit_label,
            clear_on_submit=True,
            **kwargs,
        )
        if not in_browser() or host_supports("forms"):
            return built
        # 押しても何も起きないフォームだけを出すと、書いた人は自分の誤りを疑う。
        # 判定に in_browser() を使ってはいけない（PyHiroba なら常に真なので、
        # フォームが動く本体にも警告を出してしまう）
        return ui.stack(
            ui.alert(
                "この入力欄は、いまお使いの PyHiroba では動きません。"
                "本体が新しくなると動くようになります。"
                "それまでは await talk.ask(...) の形で書いてください。",
                kind="warning",
            ),
            built,
        )


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


def host_features() -> set[str]:
    """本体が「対応している」と名乗っている機能の名前。

    本体が ``self.pyhirobaFeatures = 'forms,ai,ai-probe'`` の形で出す文字列を
    読む。無い版では空になる。

    ``in_browser()`` では代わりにならない。あれは ``pyhirobaAsk`` があるかしか
    答えず、**AI が動くことと、フォームが動くことは別**だから。実際、フォームが
    使えるようになった本体でも ``in_browser()`` は真のままで、library-hiroba は
    「PyHiroba では動きません」と出し続けていた。

    名前は「,」区切りの完全一致で見る。部分一致にすると ``ai-probe`` しか
    無いときに ``ai`` が真になってしまう。
    """
    try:
        import js
    except ImportError:
        return set()
    listed = getattr(js, "pyhirobaFeatures", "") or ""
    return {name.strip() for name in str(listed).split(",") if name.strip()}


def host_supports(feature: str) -> bool:
    """本体がその機能に対応していると名乗っているか。"""
    return feature in host_features()


# ---------------------------------------------------------------------------


class Ai:
    """小さな言語モデルを動かす。PyHiroba と Colab で同じ使い方ができる。"""

    def __init__(self) -> None:
        import threading

        self._pipe = None
        self._name: str | None = None
        # 埋め込みは生成とは別のモデルなので、別に持つ（load() とも無関係）
        self._embedder = None
        self._embed_name: str | None = None
        # 生成が同時に2本走らないようにする（下の _stream_with_transformers 参照）
        self._generating = threading.Lock()
        # 埋め込みモデルの読み込み用。生成とは別のモデルなので鍵も分ける。
        # 共用にすると、生成中の embed() が待たされてノートブックが止まる
        self._loading_embedder = threading.Lock()

    def is_loaded(self) -> bool:
        """モデルの準備ができているか。

        まだなら、最初の :meth:`ask` / :meth:`stream` の中で読み込みが走る。
        初回は数分かかることがあるので、待たせる側はこれを見て言葉を変える。
        """
        if in_browser():
            return self._name is not None
        return self._pipe is not None

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

    def talk(
        self,
        keep: int = 4,
        max_tokens: int = 96,
        names: dict | None = None,
        instruction: str | None = None,
    ) -> Talk:
        """会話を始める。前のやりとりを覚えているので、続きが通じる。

        >>> talk = ai.talk()
        >>> await talk.ask("日本で一番高い山は？")
        >>> await talk.ask("その高さは？")

        ``ui.chat()`` が「渡した会話を表示する」のに対し、こちらは「会話をする」。
        ``await`` が要るのは :meth:`Talk.ask` のほうで、ここには要らない。
        モデルは最初の :meth:`Talk.ask` で自動的に読み込まれる。

        - ``keep``: 覚えておく往復の数。小さなモデルは長い文章が苦手なので、
          話がかみ合わなくなってきたら減らす
        - ``max_tokens``: 1回の答えの長さ
        - ``names``: 表示名（``{"user": "生徒", "assistant": "先生"}``）
        - ``instruction``: 会話の先頭に添える指示
        """
        return Talk(
            self, keep=keep, max_tokens=max_tokens, names=names, instruction=instruction
        )

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

    async def embed(self, texts: object, model: str | None = None):
        """文を、意味を表す数のならび（ベクトル）にする。

        >>> await ai.embed("怖い本")                    # list[float]（384 個）
        >>> await ai.embed(["怖い本", "料理の本"])        # list[list[float]]

        ``texts`` が文字列なら1本ぶん、リストなら同じ順で返す。
        **L2 正規化済み**なので、近さは内積で測れる（＝コサイン類似度）。

        ``ai.load()`` は要らない。埋め込みは生成とは別のモデルで、最初に呼んだ
        ときに読み込まれる（PyHiroba では本体が確認を出す）。

        件数が多いときは自動で分けて渡すので、上限を気にしなくてよい。
        """
        one = isinstance(texts, str)
        items = [texts] if one else as_texts(texts, "texts")
        name = resolve_embed(model)
        if not items:
            return []
        vectors = await self._embed_all(items, name)
        return vectors[0] if one else vectors

    async def search(self, query: object, documents, top_k: int | None = None):
        """``query`` に意味が近いものを ``documents`` から探して、近い順に返す。

        >>> hits = await ai.search("怖い本を教えて", [b["desc"] for b in books], top_k=3)
        >>> for hit in hits:
        ...     print(books[hit["index"]]["title"], round(hit["score"], 3))

        返すのは ``{"index", "score", "text"}`` の並び（``score`` の大きい順）。
        ``score`` は −1〜1 で、1 に近いほど意味が近い。
        """
        docs = as_texts(documents, "documents")
        if top_k is not None and (isinstance(top_k, bool) or not isinstance(top_k, int)):
            raise ValueError(f"top_k には整数を指定してください（指定値: {top_k!r}）")
        if top_k is not None and top_k < 1:
            raise ValueError(f"top_k には 1 以上を指定してください（指定値: {top_k!r}）")
        if not docs:
            return []
        # 質問と文書をまとめて1回で渡す。別々に呼ぶと往復が2回になる
        vectors = await self.embed([str(query), *docs])
        asked, rest = vectors[0], vectors[1:]
        found = [
            {"index": i, "score": dot(asked, vector), "text": docs[i]}
            for i, vector in enumerate(rest)
        ]
        found.sort(key=lambda hit: hit["score"], reverse=True)
        return found if top_k is None else found[:top_k]

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

        # 本体が断ったとき（Promise の reject）は、理由が日本語で入っている。
        # 包まずに通すと JsException のまま出て、何が起きたのか読み取れない
        try:
            raw = await js.pyhirobaAsk(kind, args_json)
        except Exception as error:  # 伝わり方は本体・Pyodide 次第
            raise RuntimeError(f"PyHiroba 本体が {kind} を断りました: {error}") from error
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
        # 本体が対応機能を名乗っているなら、それに従う（毎回失敗すると分かって
        # いる往復を省ける）。何も名乗らない古い本体には、今までどおり聞いてみる
        named = host_features()
        if named and "ai-stream" not in named:
            yield await self._ask_in_browser(prompt, max_tokens)
            return
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

    # --- 埋め込みの中身（経路ごと） ----------------------------------------

    async def _embed_all(self, items: list[str], name: str) -> list[list[float]]:
        """本体の上限に合わせて分けて渡し、つなげて返す。

        本体は 257 件以上を断る。素通しすると、同じコードが PyHiroba では
        失敗して Colab では通る、という「同じコードが両方で動く」の反例になる。
        """
        vectors: list[list[float]] = []
        for start in range(0, len(items), EMBED_BATCH):
            chunk = items[start : start + EMBED_BATCH]
            if in_browser():
                vectors.extend(await self._embed_in_browser(chunk, name))
            else:
                vectors.extend(self._embed_with_transformers(chunk, name))
        return vectors

    async def _embed_in_browser(self, texts: list[str], name: str) -> list[list[float]]:
        import json

        if not host_supports("ai-embed"):
            raise RuntimeError(
                "お使いの PyHiroba は、まだ文のベクトル化に対応していません。"
                "本体が新しくなると使えるようになります。"
            )
        result = await self._call_host(
            "ai-embed", json.dumps({"model": name, "texts": texts})
        )
        vectors = result.get("vectors")
        if not isinstance(vectors, list) or len(vectors) != len(texts):
            raise RuntimeError(
                f"PyHiroba 本体が返したベクトルの数が合いません"
                f"（{len(texts)} 文に対して {len(vectors) if isinstance(vectors, list) else '?'} 本）。"
            )
        try:
            vectors = [[float(value) for value in vector] for vector in vectors]
        except (TypeError, ValueError) as error:
            raise RuntimeError(
                f"PyHiroba 本体が返したベクトルに、数でないものが混じっています（{error}）。"
                "本体側の不具合の可能性があります。"
            ) from error
        # **全部の長さを見る。** 本体は配布元を版で固定しておらず、上流でモデルが
        # 差し替わると黙って別のベクトルが返る。1本目だけ見ていると、途中から
        # 長さの違うものが混じったときに素通りし、dot() が zip で切りそろえて
        # 近い順だけが静かに狂う
        expected = EMBED_MODELS[name]["dim"]
        for number, vector in enumerate(vectors, start=1):
            if len(vector) != expected:
                raise RuntimeError(
                    f"{number}本目のベクトルの長さが {len(vector)} です（{expected} のはず）。"
                    "配布元のモデルが差し替わったか、本体側の不具合の可能性があります。"
                )
        # 正規化されていないと内積がコサイン類似度にならず、近い順が狂う
        check_normalized(vectors[0] if vectors else None)
        return vectors

    def _embed_with_transformers(self, texts: list[str], name: str) -> list[list[float]]:
        """平均プーリング＋L2 正規化を自前で行う。

        ``sentence-transformers`` は使わない。あれは transformers>=5 を要求し、
        scikit-learn と scipy まで連れてくるが、ここでやることは十数行で済む。
        本体と同じ処理を自分で書くぶん、両経路の一致も保証しやすい。
        """
        import torch

        tokenizer, model = self._load_embedder(name)
        batch = tokenizer(texts, padding=True, truncation=True, return_tensors="pt")
        with torch.no_grad():
            output = model(**batch)
        # 埋め込みは「文全体の平均」。padding の分を平均に混ぜないよう mask で消す
        mask = batch["attention_mask"].unsqueeze(-1).to(output.last_hidden_state.dtype)
        pooled = (output.last_hidden_state * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
        return torch.nn.functional.normalize(pooled, p=2, dim=1).tolist()

    def _load_embedder(self, name: str):
        """埋め込み用のモデルを読む（1回だけ）。生成用の _pipe とは別物。"""
        # フォームの別スレッドとセルがかち合っても、同じモデルを二重に読まない。
        # 生成用の鍵とは分ける（共用だと生成が終わるまで embed が待たされる）
        with self._loading_embedder:
            return self._load_embedder_locked(name)

    def _load_embedder_locked(self, name: str):
        if self._embed_name == name and self._embedder is not None:
            return self._embedder
        try:
            from transformers import AutoModel, AutoTokenizer
        except ImportError as error:
            raise ImportError(
                "transformers と torch が必要です。次の行を先に実行してください:\n"
                '    !pip install -q -U "library-hiroba[ai]"'
            ) from error
        repo = EMBED_MODELS[name]["colab_id"]
        model = AutoModel.from_pretrained(repo)
        model.eval()
        self._embedder = (AutoTokenizer.from_pretrained(repo), model)
        self._embed_name = name
        return self._embedder

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
        from queue import Empty

        try:
            from transformers import TextIteratorStreamer
        except ImportError:
            # 少しずつ返せない版。全部書けてから一度に返す（同じコードは動く）
            yield self._ask_with_transformers(prompt, max_tokens)
            return

        # timeout を渡さないと、次の1文字を「永久に」待つ。生成側が黙って
        # 止まった場合、画面は考え中のまま構造上ぜったいに抜けられなくなる。
        # ここは1文字あたりの上限なので、CPU だけの環境でも十分に長くとる。
        streamer = TextIteratorStreamer(
            self._pipe.tokenizer,
            skip_prompt=True,
            skip_special_tokens=True,
            timeout=STREAM_POLL_SECONDS,
        )
        messages = [{"role": "user", "content": str(prompt)}]
        failure: list[BaseException] = []

        # 同じ pipeline を2本のスレッドから同時に叩かない。transformers の
        # pipeline はスレッド安全ではなく、フォームの送信中にノートブックの
        # セルからもう1回聞くと、両方が壊れて片方が返らなくなる
        if not self._generating.acquire(blocking=False):
            raise RuntimeError(
                "前の生成がまだ終わっていません。終わるのを待ってから、もう一度試してください。"
            )

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
            finally:
                self._generating.release()

        worker = threading.Thread(target=generate, daemon=True)
        worker.start()

        loop = asyncio.get_running_loop()
        iterator = iter(streamer)
        stop = object()
        thinking = ThinkingFilter()
        silent = 0.0
        while True:
            try:
                piece = await loop.run_in_executor(None, lambda: next(iterator, stop))
            except Empty:
                # まだ1文字も来ていない。短く区切って待ち直し、通算で上限を超えたら諦める
                silent += STREAM_POLL_SECONDS
                if silent < STREAM_TIMEOUT_SECONDS:
                    continue
                raise TimeoutError(
                    f"モデルが {STREAM_TIMEOUT_SECONDS:.0f} 秒のあいだ何も返しませんでした。"
                    "軽いモデル（ai.load('llmjp150m')）を試すか、"
                    "セッションを再起動してからやり直してください。"
                ) from None
            silent = 0.0
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
