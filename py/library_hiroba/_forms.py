"""入力を受け取って Python の関数に渡すためのフォーム。

環境によって使える経路が違うため、次の順で自動的に選ぶ。

1. ipywidgets がある（Colab / Jupyter）… テキスト欄とボタンの対話 UI
2. IPython があり ipywidgets が無い … ``input()`` で順番に聞く
3. PyHiroba の受け渡し経路がある … HTML のフォームを出し、本体が値を返す
4. どれも無い … フォームを表示だけして、書きかえて実行する方法を案内する

3 の経路は PyHiroba 本体（出力からワーカーへ値を渡すしくみ）が必要で、
その仕様は docs/PYHIROBA_FORMS.md にまとめてある。ここで出す HTML は、
本体が対応した時点でそのまま動くように ``data-hui-*`` を付けてある。
"""

from __future__ import annotations

import asyncio
import inspect
import keyword
from collections.abc import Sequence
from typing import Callable, Union

from ._core import Widget, esc, esc_attr, unique_name
from ._css import COMPONENT_CSS, base_css


def _add_class(widget: object, name: str) -> None:
    """ipywidgets の部品に CSS クラスを付ける。付けられない相手なら何もしない。"""
    adder = getattr(widget, "add_class", None)
    if callable(adder):
        adder(name)

FieldLike = Union["Field", str]

# 表示したフォームを ID で引けるようにしておく置き場。
# PyHiroba 本体は、ボタンが押されたときに get_form(form_id).submit(**values) を呼ぶ。
# 教材を長く開いたままでも増え続けないよう、古いものから捨てる。
_REGISTRY: dict[str, Form] = {}
_REGISTRY_LIMIT = 64

# 表示待ちの処理。回収されないよう、終わるまでここで持つ（display_result 参照）
_PENDING: set = set()

# 別スレッドで走らせている処理。テストから終わりを待てるようにしておく
_WORKERS: set = set()


def run_detached(coro) -> None:
    """コルーチンを、自前のループを持つ別スレッドで最後まで走らせる。

    ノートブックのループに載せる（``ensure_future``）やり方は Colab で動かない。
    セルの実行が終わっているあいだ本体がループを回しておらず、予約したタスクが
    順番待ちのまま止まるためで、``asyncio.get_running_loop()`` は
    ``running=True`` と答えるので気付きにくい。
    """
    import threading

    async def guarded() -> None:
        # ここで受け止めないと、スレッドの中で消える（show_each 側でも受けているが、
        # 念のため。表に出ないまま終わるのがいちばん困る）
        try:
            await coro
        except Exception:  # noqa: BLE001
            import traceback

            traceback.print_exc()

    def target() -> None:
        try:
            asyncio.run(guarded())
        finally:
            _WORKERS.discard(threading.current_thread())

    worker = threading.Thread(target=target, daemon=True, name="hui-form")
    _WORKERS.add(worker)
    worker.start()

# pending を書かなかったときの印。None は「出さない」の指定に使うため、
# 「指定なし」と区別できる別の値が要る。
_DEFAULT_PENDING = object()


def _resolve_pending(pending: object) -> object:
    """``pending`` の指定を、実際に表示する部品にする。

    - 書かなかった … 既定の「考え中」
    - ``None`` … 何も出さない
    - 文字列 … その言葉の「考え中」
    - 部品 … そのまま
    """
    from ._components import thinking

    if pending is _DEFAULT_PENDING:
        return thinking()
    if pending is None:
        return None
    if isinstance(pending, Widget):
        return pending
    return thinking(pending)


def get_form(form_id: str) -> Form | None:
    """表示済みのフォームを ID で取り出す。見つからなければ ``None``。

    PyHiroba 本体から呼ぶための入口。詳しくは docs/PYHIROBA_FORMS.md を参照。
    """
    return _REGISTRY.get(form_id)


def _register(form: Form) -> None:
    _REGISTRY[form.form_id] = form
    while len(_REGISTRY) > _REGISTRY_LIMIT:
        _REGISTRY.pop(next(iter(_REGISTRY)))


class Field:
    """フォームの入力欄1つぶんの指定。"""

    KINDS = ("text", "number", "choice", "multiline")

    def __init__(
        self,
        name: str,
        label: str | None = None,
        placeholder: str = "",
        kind: str = "text",
        choices: Sequence[object] | None = None,
        default: object = "",
    ):
        if not name.isidentifier():
            raise ValueError(f"name は Python の変数名として使える文字にしてください（指定値: {name!r}）")
        # class・for・if などは変数名の形をしているが、handler の引数にはできない。
        # ここで止めないと、ボタンを押した時点で初めて TypeError になり、
        # 書いた本人には何が悪いのか分からない。
        if keyword.iskeyword(name):
            raise ValueError(
                f"name に Python の予約語は使えません（指定値: {name!r}）。"
                f"handler の引数にできないためです。{name}_ のように少し変えてください。"
            )
        if kind not in self.KINDS:
            raise ValueError(f"kind は {list(self.KINDS)} のいずれかにしてください（指定値: {kind!r}）")
        if kind == "choice" and not choices:
            raise ValueError("kind='choice' のときは choices を指定してください")
        self.name = name
        self.label = name if label is None else label
        self.placeholder = placeholder
        self.kind = kind
        self.choices = [str(c) for c in choices] if choices else []
        # 選択欄で default を書かなかった場合は最初の選択肢にする。
        # 指定しないと ipywidgets は未選択（handler が None を受け取る）、
        # HTML の select は先頭が選択済みとなり、経路で結果がずれる。
        if kind == "choice" and str(default) not in self.choices:
            default = self.choices[0]
        self.default = default

    def control_html(self) -> str:
        """入力欄そのもののマークアップ。"""
        common = f'class="hui-input" data-hui-field="{esc_attr(self.name)}"'
        placeholder = f' placeholder="{esc_attr(self.placeholder)}"' if self.placeholder else ""
        value = esc_attr(self.default) if self.default != "" else ""
        if self.kind == "multiline":
            # ここは esc（改行を <br> にする）を使わない。textarea の中身はタグとして
            # 解釈されないので、<br> がそのまま「<br>」という文字で見えてしまう。
            return f"<textarea {common} rows=\"3\"{placeholder}>{esc_attr(self.default)}</textarea>"
        if self.kind == "choice":
            options = "".join(
                f'<option value="{esc_attr(c)}"'
                f'{" selected" if str(self.default) == c else ""}>{esc(c)}</option>'
                for c in self.choices
            )
            return f"<select {common}>{options}</select>"
        input_type = "number" if self.kind == "number" else "text"
        return f'<input {common} type="{input_type}" value="{value}"{placeholder}>'

    def fragment(self) -> str:
        return (
            f'<label class="hui-field"><span class="hui-field-label">{esc(self.label)}</span>'
            f"{self.control_html()}</label>"
        )

    def convert(self, raw: str) -> object:
        """``input()`` で受け取った文字列を、この欄の型に合わせる。

        ipywidgets 経路は数値欄で float を返すため、``input()`` 経路も
        揃えないと同じコードの計算結果が変わってしまう。
        """
        if self.kind == "number":
            try:
                return float(raw)
            except (TypeError, ValueError):
                raise ValueError("数を入力してください") from None
        if self.kind == "choice":
            if str(raw) not in self.choices:
                raise ValueError(f"{'／'.join(self.choices)} のどれかを入力してください")
            return str(raw)
        return raw

    def ask_via_input(self, attempts: int = 3) -> object:
        """``input()`` で1つ聞く（ipywidgets が使えない環境向け）。

        入力が型に合わないときは聞き直す。それでも合わなければ例外にする。
        """
        hint = f"（{'／'.join(self.choices)}）" if self.kind == "choice" else ""
        for remaining in range(attempts - 1, -1, -1):
            raw = input(f"{self.label}{hint}： ")
            try:
                return self.convert(raw)
            except ValueError as error:
                if remaining == 0:
                    raise ValueError(f"{self.label}: {error}") from None
                message = error if self.kind == "choice" else "数を入力してください"
                print(f"  {message}（あと{remaining}回）")
        raise AssertionError("到達しない")


def as_field(item: FieldLike) -> Field:
    return item if isinstance(item, Field) else Field(str(item))


def put_into(into: object, item: object) -> None:
    """ipywidgets の ``Output`` へ、表示するものを1つ書き込む。

    ``with into:`` で囲んで ``display()`` する書き方は使わない。あの捕捉は
    「いまセルを実行している文脈」に紐づくため、``await`` をまたいで別のタスク
    から使うと届け先を見失う。ボタンを押しても何も出ない、という形で表に出る。

    ``outputs`` に入れ替えるやり方なら、いつ・どのタスクから呼んでも同じ場所に
    出る。前の中身と置き換わるので、少しずつ書き足す表示もそのまま作れる。
    """
    if hasattr(item, "_repr_html_"):
        data = {"text/html": item._repr_html_(), "text/plain": repr(item)}
    else:
        data = {"text/plain": repr(item)}
    into.outputs = ({"output_type": "display_data", "data": data, "metadata": {}},)


def display_result(result: object, into: object = None, pending: object = None) -> None:
    """``handler`` の返り値を表示する。

    受け取れる形は3つあり、どれも同じ場所に出す。

    - ふつうの部品 … そのまま表示する
    - ``await`` の要るもの（``async def``）… 待ってから表示する
    - 何度も ``yield`` するもの（``async def`` + ``yield``）… 届くたびに差し替える

    3つめが、AI の答えを書きかけのまま少しずつ見せるための経路。

    ``pending`` を渡すと、待ちに入る前にそれを先に表示する。答えが出るまで
    画面が変わらないと、押せていないと思われるため。

    ``into`` に ipywidgets の Output を渡すと、その中に表示する（待っている
    あいだにセルの実行が終わっても、結果がフォームの下に出るようにするため）。
    書き込みは :func:`put_into` が行う。3つの形すべてで ``into`` を見るので、
    Colab では待つ・待たないにかかわらず、結果はフォームの下に出る。
    """
    from IPython.display import display

    waits = inspect.isawaitable(result)
    streams = inspect.isasyncgen(result)
    if not waits and not streams:
        # 待たないなら「考え中」を出す意味がない
        if into is not None:
            put_into(into, result)
        else:
            display(result)
        return

    async def steps():
        """表示するものを、出す順に並べる。"""
        if pending is not None:
            yield pending
        if streams:
            async for item in result:
                yield item
        else:
            yield await result

    async def show_each() -> None:
        try:
            if into is not None:
                async for item in steps():
                    put_into(into, item)
                return
            # Output が無い場合。差し替えが要るときだけ取っ手を使う
            # （cell 全体を消すと、フォーム自体まで消えてしまうため）。
            # 1回しか出さないなら、ふつうに display する。
            replaces = streams or pending is not None
            handle = None
            async for item in steps():
                if not replaces:
                    display(item)
                elif handle is None:
                    handle = display(item, display_id=True)
                else:
                    handle.update(item)
        except Exception:  # noqa: BLE001 — 黙って消えるほうが困る
            import traceback

            text = traceback.format_exc()
            if into is not None:
                # 出せる場所が Output しかない。print では拾われずに消える
                into.outputs = ({"output_type": "stream", "name": "stderr", "text": text},)
            else:
                traceback.print_exc()

    try:
        asyncio.get_running_loop()
        running = True
    except RuntimeError:
        running = False

    if not running:
        # ノートブックの外（素の Python）。回っているループが無いので自分で回す
        asyncio.run(show_each())
    elif into is not None:
        # ボタンの押下から呼ばれている（ipywidgets 経路）。
        #
        # ここで ensure_future を使ってはいけない。Colab はセルの実行が終わって
        # いるあいだループを回しておらず、予約したタスクは順番待ちのまま止まる。
        # ループ自体は running=True と答えるので気付きにくい（tools/
        # check_form_colab.py で実測: 押下処理は走り、Output への書き込みも届く
        # のに、予約したタスクだけが走らない）。「押しても何も起きない」の正体。
        #
        # 自前のループを別スレッドで回せば、本体がループを回しているかに関係なく
        # 最後まで走る。表示は Output の outputs へ入れるだけで、別スレッドから
        # でも届く（display() と違い、セルの実行文脈に紐づかないため）。
        run_detached(show_each())
    else:
        # ループが回っていて、出す先が Output ではない場合。display() は実行中の
        # セルに紐づくので、別スレッドへ逃がさずこのループに載せる。
        # 参照を持たないと、待っている最中に回収されて結果が出ないことがある
        # （ループはタスクを弱参照でしか持たない）。
        task = asyncio.ensure_future(show_each())
        _PENDING.add(task)
        task.add_done_callback(_PENDING.discard)


class Form(Widget):
    """入力欄とボタンを出し、押されたら ``handler`` を呼ぶ部品。"""

    css_keys = ("form",)

    def __init__(
        self,
        handler: Callable[..., object],
        fields: Sequence[FieldLike],
        submit_label: str = "送信",
        title: object = None,
        clear_on_submit: bool = False,
        pending: object = _DEFAULT_PENDING,
    ):
        if not callable(handler):
            raise ValueError("handler には関数を渡してください")
        if not fields:
            raise ValueError("入力欄を1つ以上渡してください")
        self.handler = handler
        self.fields = [as_field(f) for f in fields]
        names = [f.name for f in self.fields]
        if len(set(names)) != len(names):
            raise ValueError(f"入力欄の name が重複しています: {names}")
        self.submit_label = submit_label
        self.title = title
        self.clear_on_submit = clear_on_submit
        self.pending = _resolve_pending(pending)
        self.form_id = unique_name("hui-form")

    # --- 表示 ---------------------------------------------------------------

    def fragment(self) -> str:
        title = (
            f'<div class="hui-form-title">{esc(self.title)}</div>' if self.title is not None else ""
        )
        rows = "".join(f.fragment() for f in self.fields)
        # 送信後に入力欄を空にするかどうかは本体側が実行する。印が無いと伝わらない
        clear = ' data-hui-clear="true"' if self.clear_on_submit else ""
        return (
            f'<div class="hui-form" data-hui-form="{esc_attr(self.form_id)}"{clear}>'
            f"{title}{rows}"
            f'<button class="hui-submit" type="button" '
            f'data-hui-submit="{esc_attr(self.form_id)}">{esc(self.submit_label)}</button>'
            f'<div class="hui-form-out" data-hui-output="{esc_attr(self.form_id)}"></div>'
            f"</div>"
        )

    def _widget_style_block(self) -> str:
        """ipywidgets 経路で出す ``<style>``。

        あちらは HTML ではなく ipywidgets の部品を並べるため、部品側の
        ``<style>`` が出てこない。ここで一度だけ出す。``widgets`` の分は
        ipywidgets を相手にした上書きなので、HTML 経路には含めない。
        """
        parts = [base_css(), COMPONENT_CSS["form"], COMPONENT_CSS["widgets"]]
        return "<style>" + "\n".join(parts) + "</style>"

    def _repr_html_(self) -> str:
        # PyHiroba 経路（IPython が無い環境）ではこちらが使われる。
        # 本体がボタンの押下を受け取ったときに引けるよう、ここで登録する。
        _register(self)
        return super()._repr_html_()

    def _ipython_display_(self) -> None:
        """IPython のある環境（Colab など）での表示。

        ipywidgets があれば対話 UI、無ければ ``input()`` で聞く。
        """
        if self._display_with_ipywidgets():
            return
        self._run_with_input()

    # --- 経路ごとの実装 -----------------------------------------------------

    def _build_ipywidgets(self):
        """ipywidgets の部品を組み立てる。使えない場合は None。"""
        try:
            import ipywidgets as widgets
        except ImportError:
            return None
        controls = {}
        for field in self.fields:
            label = field.label
            if field.kind == "choice":
                control = widgets.Dropdown(
                    options=field.choices,
                    value=str(field.default) if str(field.default) in field.choices else None,
                    description=label,
                )
            elif field.kind == "number":
                control = widgets.FloatText(value=float(field.default or 0), description=label)
            elif field.kind == "multiline":
                control = widgets.Textarea(
                    value=str(field.default), placeholder=field.placeholder, description=label
                )
            else:
                control = widgets.Text(
                    value=str(field.default), placeholder=field.placeholder, description=label
                )
            _add_class(control, "hui-wfield")
            controls[field.name] = control
        return widgets, controls

    def _display_with_ipywidgets(self) -> bool:
        built = self._build_ipywidgets()
        if built is None:
            return False
        widgets, controls = built
        from IPython.display import display

        # button_style は ipywidgets の既定色。こちらの CSS で塗るので使わない
        button = widgets.Button(description=self.submit_label)
        _add_class(button, "hui-wsubmit")
        output = widgets.Output()
        _add_class(output, "hui-wout")

        clearable = {f.name for f in self.fields if f.kind in ("text", "multiline")}

        def on_click(_):
            values = {name: control.value for name, control in controls.items()}
            if self.clear_on_submit:
                for name in clearable:
                    controls[name].value = ""
            # display_result まで含めて囲む。ipywidgets の押下処理から出た例外は
            # 呼び出し元に戻る先が無く、Colab では画面にもログにも出ないまま消える
            # （押しても何も起きない、という形だけが残る）
            try:
                # handler を直に呼ばず submit() を通す。欄の種類に合わせた変換が
                # ここにあり、飛ばすと Colab だけ handler に違う型が渡る
                result = self.submit(**values)
                display_result(result, into=output, pending=self.pending)
            except Exception:  # noqa: BLE001 — 入力の誤りも、出さないと直せない
                import traceback

                output.outputs = (
                    {"output_type": "stream", "name": "stderr", "text": traceback.format_exc()},
                )

        button.on_click(on_click)
        # ipywidgets の部品には .hui-... の CSS が付いてこないので、ここで一度だけ出す
        # （HTML を出さない経路なので、部品側の <style> も出ない）
        style = widgets.HTML(self._widget_style_block())
        header = [widgets.HTML(f"<b>{esc(self.title)}</b>")] if self.title is not None else []
        box = widgets.VBox([style, *header, *controls.values(), button, output])
        # 配色・角丸・書体は base_css が .hui に載せている。ここを付け忘れると
        # var(--hui-accent) がどこにも無い変数になり、色も枠も無い素の見た目に戻る
        _add_class(box, "hui")
        _add_class(box, "hui-wform")
        display(box)
        return True

    def _run_with_input(self) -> None:
        """``input()`` で順番に聞いて、結果を表示する。"""
        values = {field.name: field.ask_via_input() for field in self.fields}
        display_result(self.handler(**values), pending=self.pending)

    def pending_html(self) -> str:
        """待っているあいだに出す「考え中」の HTML。出さない設定なら空文字。

        PyHiroba 本体が、押された直後にこれを出力欄へ入れるための口。
        Colab 側と同じものが出るので、環境で見え方が変わらない。
        """
        return "" if self.pending is None else self.pending._repr_html_()

    def submit(self, **values: object) -> object:
        """入力値を渡して ``handler`` を呼ぶ。

        PyHiroba 本体が値を受け取ったときに呼ぶ入口でもある。
        自分でテストするときにも使える。

        **値は欄の種類に合わせて変換してから渡す。** ブラウザの入力欄から
        取れるのは常に文字列だが、Colab の ipywidgets は数値欄で float を返す。
        ここで揃えないと、同じ ``ui.form(...)`` が環境によって違う型を
        handler に渡してしまう（``age * 2`` が 20.0 ではなく "1010" になる）。

        ``handler`` が ``async def`` のときは、返り値が待つもの（awaitable）に
        なる。呼び出し側で ``await`` してから表示すること。``yield`` で書かれて
        いるときは非同期の反復子になるので、回しながら表示を差し替えること。

        **渡すのは ``fields`` に宣言した欄だけ**で、それ以外の値は捨てる。
        本体は画面の ``data-hui-field`` を集めて呼ぶ（docs/PYHIROBA_FORMS.md
        6-1）が、画面は検証ツールで書き換えられる。素通しすると、画面側の
        書き換えが handler の引数を決められてしまう。何を受け取るかは、
        教材に書かれた Python のほうを正とする。
        """
        missing = [f.name for f in self.fields if f.name not in values]
        if missing:
            raise ValueError(f"入力値が足りません: {missing}")
        typed = {}
        for field_ in self.fields:
            try:
                typed[field_.name] = field_.convert(values[field_.name])
            except ValueError as error:
                raise ValueError(f"{field_.label}: {error}") from None
        return self.handler(**typed)


def field(name, label=None, placeholder="", kind="text", choices=None, default="") -> Field:
    """フォームの入力欄を1つ作る。

    >>> ui.field("question", label="質問", placeholder="スマホは持っていっていい？")
    >>> ui.field("size", label="大きさ", kind="choice", choices=["小", "中", "大"])
    """
    return Field(
        name, label=label, placeholder=placeholder, kind=kind, choices=choices, default=default
    )


def form(
    handler,
    *fields,
    submit_label="送信",
    title=None,
    clear_on_submit=False,
    pending=_DEFAULT_PENDING,
) -> Form:
    """入力欄とボタンを表示し、押されたら ``handler`` を呼ぶ。

    ``handler`` は入力欄の name をキーワード引数として受け取り、
    表示したい部品を返す。

    >>> def ask(question):
    ...     return ui.card(question, "答えです")
    >>> ui.form(ask, ui.field("question", label="質問"))

    入力欄は文字列だけでも指定できる（その名前のテキスト欄になる）。

    >>> ui.form(ask, "question")

    ``handler`` が ``async def`` のときは、待っているあいだ「考え中」が出る。
    言葉を変えたいときは ``pending="AI が考えています"``、出したくないときは
    ``pending=None`` を渡す。

    ``handler`` を ``yield`` で書くと、届いたものから順に差し替えて表示する。
    AI の答えを書きかけのまま見せたいときに使う。

    >>> async def ask(question):
    ...     text = ""
    ...     async for chunk in ai.stream(question):
    ...         text += chunk
    ...         yield ui.card("答え", text)
    """
    return Form(
        handler,
        fields,
        submit_label=submit_label,
        title=title,
        clear_on_submit=clear_on_submit,
        pending=pending,
    )
