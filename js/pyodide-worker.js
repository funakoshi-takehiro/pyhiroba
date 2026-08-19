/* ==================================================
   PyHiroba - Pyodide 実行ワーカー
   Python の実行をメインスレッドから切り離し、
   重い処理中でも画面が固まらないようにする。
   起動を速くするため、ライブラリは事前ロードせず、
   import されたときに自動で読み込む。
   ================================================== */

/* eslint-disable no-restricted-globals */
importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js');

let pyodide = null;
let richBokehPackageReady = false;
let richPanelPackageReady = false;
const RICH_PATCH_MAX_BYTES = 512 * 1024;
const RICH_SNAPSHOT_MAX_RETRIES = 3;
let richOperationQueue = Promise.resolve();
const richSnapshotStates = new Map();

function estimatePayloadBytes(value, seen) {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length * 2;
  if (typeof value === 'number' || typeof value === 'boolean') return 8;
  if (typeof value === 'bigint') return String(value).length;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof value !== 'object') return 0;

  const visited = seen || new WeakSet();
  if (visited.has(value)) return RICH_PATCH_MAX_BYTES + 1;
  visited.add(value);

  let total = 0;
  if (value instanceof Map) {
    for (const [key, val] of value.entries()) {
      total += estimatePayloadBytes(String(key), visited) + estimatePayloadBytes(val, visited);
      if (total > RICH_PATCH_MAX_BYTES) return total;
    }
    return total;
  }
  if (value instanceof Set) {
    for (const item of value.values()) {
      total += estimatePayloadBytes(item, visited);
      if (total > RICH_PATCH_MAX_BYTES) return total;
    }
    return total;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      total += estimatePayloadBytes(item, visited);
      if (total > RICH_PATCH_MAX_BYTES) return total;
    }
    return total;
  }
  for (const key of Object.keys(value)) {
    total += key.length * 2 + estimatePayloadBytes(value[key], visited);
    if (total > RICH_PATCH_MAX_BYTES) return total;
  }
  return total;
}

function isValidRichPatchPayload(patch, buffers) {
  if (!patch || typeof patch !== 'object') return false;
  if (buffers != null && typeof buffers !== 'object') return false;
  return estimatePayloadBytes({ patch, buffers }) <= RICH_PATCH_MAX_BYTES;
}

function enqueueRichOperation(fn) {
  richOperationQueue = richOperationQueue
    .catch(() => {})
    .then(fn)
    .catch((err) => {
      console.error(err);
    });
  return richOperationQueue;
}

function markRichSnapshotDirty(sessionId) {
  const state = richSnapshotStates.get(sessionId);
  if (state && state.active) {
    state.dirty = true;
  }
}

function sendPatch(patch, buffers, msg_id) {
  markRichSnapshotDirty(msg_id);
  postMessage({
    type: 'rich-patch',
    sessionId: msg_id,
    patch: safeJson(patch),
    buffers: safeJson(buffers || null),
  });
}

function unwrapProxy(value) {
  if (value && typeof value.toJs === 'function') {
    let out;
    try {
      out = value.toJs({ dict_converter: Object.fromEntries });
    } catch (_) {
      out = value.toJs();
    }
    if (typeof value.destroy === 'function') {
      try { value.destroy(); } catch (_) { /* noop */ }
    }
    return out;
  }
  return value;
}

function safeJson(value, seen) {
  const v = unwrapProxy(value);
  if (v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'undefined' || typeof v === 'function' || typeof v === 'symbol') return null;
  if (v instanceof ArrayBuffer) return v;
  if (ArrayBuffer.isView(v)) return Array.from(v);

  const visited = seen || new WeakSet();
  if (typeof v === 'object') {
    if (visited.has(v)) return null;
    visited.add(v);
  }
  if (Array.isArray(v)) return v.map((item) => safeJson(item, visited));
  if (v instanceof Map) {
    const out = {};
    for (const [key, val] of v.entries()) out[String(key)] = safeJson(val, visited);
    return out;
  }
  if (v instanceof Set) return Array.from(v, (item) => safeJson(item, visited));
  if (typeof v === 'object') {
    const out = {};
    for (const key of Object.keys(v)) out[key] = safeJson(v[key], visited);
    return out;
  }
  return String(v);
}

// ============================================================
// 同梱ファイル（py/library_hiroba/）
// ============================================================
// PyPI から取らずに同梱するのは、学校の閉域網でも import だけで使えるようにするため。
// 取得は init() の中、lockdownNetwork() より前に行う。したがって
// NET_ALLOW_PREFIXES（生徒コードから見た許可リスト）は一切広げていない。
//
// 一覧をここに持つのはビルド工程が無いため。ファイルが増減したら
// ここも更新すること（実ファイルとの一致は検証スクリプトが確かめる）。
const BUNDLE_DIR = '/lib/hiroba';
const BUNDLE_FILES = [
  'library_hiroba/__init__.py',
  'library_hiroba/ui.py',
  'library_hiroba/_core.py',
  'library_hiroba/_css.py',
  'library_hiroba/_components.py',
  'library_hiroba/_forms.py',
  'library_hiroba/_ai.py',
];

// ============================================================
// Pythonセットアップコード（環境の初期化）
// ============================================================
const PYTHON_SETUP_CODE = `
import sys, io, base64, traceback, ast as _ast, os as _os

# matplotlib が後で読み込まれたときに、画面表示なしの Agg バックエンドを使う
_os.environ['MPLBACKEND'] = 'Agg'

# 標準出力をキャプチャするクラス
class _CapIO:
    def __init__(self):
        self._buf = []
    def write(self, s):
        if s:
            self._buf.append(str(s))
    def flush(self):
        pass
    def getvalue(self):
        return ''.join(self._buf)

# ノートブック全体で共有される変数空間
_nb_globals = {}
exec("", _nb_globals)

# ============================================================
# 同梱した library-hiroba（ui と ai）を import できるようにする
# ============================================================
# 実体は py/library_hiroba/。ファイルは init() が封鎖前に取得して置いてある。
# ここでは読める場所として sys.path に足すだけ。
# 生徒は次のように書ける（Colab でも同じコードが動く）:
#     from library_hiroba import ai, ui
if '${BUNDLE_DIR}' not in sys.path:
    sys.path.insert(0, '${BUNDLE_DIR}')

_rich_sessions = {}
_rich_safety_problem = None
_RICH_BLOCKED_MESSAGE = 'このPanel/Bokeh出力はPyHirobaの安全設定では表示できません。'
_RICH_MAX_MODELS = 3000
_RICH_JS_MODEL_HINTS = ('CustomJS', 'ReactiveHTML', 'ReactiveESM')
_RICH_JS_CALLBACK_ATTRS = ('js_event_callbacks', 'js_property_callbacks')
_RICH_HTML_HINTS = ('<script', 'javascript:', ' onload=', ' onerror=', '<iframe', '<object', '<embed', 'srcdoc', 'data:text/html')

def _rich_node_name(node):
    if isinstance(node, _ast.Name):
        return node.id
    if isinstance(node, _ast.Attribute):
        parent = _rich_node_name(node.value)
        return f'{parent}.{node.attr}' if parent else node.attr
    return ''

def _rich_blocked_output(reason=None):
    message = _RICH_BLOCKED_MESSAGE
    if reason:
        message += '\\n理由: ' + str(reason)
    return [{'mimeType': 'text/plain', 'data': message}]

def _rich_safety_problem_for_code(code):
    # Panel/Bokeh のフロントエンドは sandbox iframe 内で実行されるため、
    # ソース文字列だけで HTML/JavaScript 表現を一律禁止しない。
    # 生成後の Bokeh Document を補助的に検査する。
    return None

def _rich_scan_value(value, features, depth=0):
    if depth > 4:
        return
    if isinstance(value, str):
        lowered = value.lower()
        if '<' in lowered or 'style=' in lowered:
            features.add('html')
        if any(token in lowered for token in _RICH_HTML_HINTS):
            features.add('active-html')
        return
    if isinstance(value, dict):
        for item in value.values():
            _rich_scan_value(item, features, depth + 1)
        return
    if isinstance(value, (list, tuple, set)):
        for item in value:
            _rich_scan_value(item, features, depth + 1)

def _rich_inspect_document(doc):
    features = set()
    seen = set()
    count = 0
    for root in getattr(doc, 'roots', []):
      models = [root]
      try:
        models.extend(list(root.references()))
      except Exception:
        pass
      for model in models:
        marker = id(model)
        if marker in seen:
          continue
        seen.add(marker)
        count += 1
        if count > _RICH_MAX_MODELS:
          return features, 'Panel/Bokeh出力の部品数が多すぎます。'
        cls = type(model)
        name = cls.__name__
        module = getattr(cls, '__module__', '')
        if any(hint in name for hint in _RICH_JS_MODEL_HINTS) or module.startswith('panel.custom'):
          features.add('client-javascript')
        for attr in _RICH_JS_CALLBACK_ATTRS:
          try:
            if getattr(model, attr, None):
              features.add('client-javascript')
          except Exception:
            pass
        try:
          props = model.properties_with_values(include_defaults=False)
        except Exception:
          props = {}
        _rich_scan_value(props, features)
    return features, None

async def _build_rich_output(value):
  import uuid

  outputs = []
  session_id = uuid.uuid4().hex

  try:
    from bokeh.document import Document
    from bokeh.model import Model
  except Exception:
    return outputs

  async def _make_output(doc, kind, features):
    data = await _rich_serialize_document(session_id, doc, kind, features)
    return {
      'mimeType': 'application/bokeh',
      'data': data,
    }

  if hasattr(value, 'server_doc'):
    try:
      from panel.io.pyodide import init_doc
      from panel.io.state import state

      if globals().get('_rich_safety_problem'):
        return _rich_blocked_output(globals().get('_rich_safety_problem'))
      init_doc()
      doc = state.curdoc
      value.server_doc(doc=doc)
      features, problem = _rich_inspect_document(doc)
      if problem:
        return _rich_blocked_output(problem)
      _rich_sessions[session_id] = {'doc': doc, 'rendered': False, 'linked': False, 'kind': 'panel'}
      outputs.append(await _make_output(doc, 'panel', features))
      return outputs
    except Exception:
      pass

  if isinstance(value, Model):
    if globals().get('_rich_safety_problem'):
      return _rich_blocked_output(globals().get('_rich_safety_problem'))
    doc = Document()
    doc.hold()
    doc.add_root(value)
    features, problem = _rich_inspect_document(doc)
    if problem:
      return _rich_blocked_output(problem)
    _rich_sessions[session_id] = {'doc': doc, 'rendered': False, 'linked': False, 'kind': 'bokeh'}
    outputs.append(await _make_output(doc, 'bokeh', features))
    return outputs

  return outputs

async def _rich_serialize_document(session_id, doc, kind, features=None):
  import json
  if features is None:
    features, problem = _rich_inspect_document(doc)
    if problem:
      raise RuntimeError(problem)
  if kind == 'panel':
    from panel.io.pyodide import write_doc
    docs_json, render_items, root_ids = await write_doc(doc)
    return {
      'sessionId': session_id,
      'docs_json': docs_json,
      'render_items': render_items,
      'root_ids': root_ids,
      'features': sorted(features),
    }

  from bokeh.embed.util import standalone_docs_json_and_render_items
  docs_json, render_items = standalone_docs_json_and_render_items(doc.roots, suppress_callback_warning=True)
  root_ids = [m.id for m in doc.roots]
  return {
    'sessionId': session_id,
    'docs_json': json.dumps(docs_json),
    'render_items': json.dumps([item.to_json() for item in render_items]),
    'root_ids': json.dumps(root_ids),
    'features': sorted(features),
  }

async def _rich_snapshot_for_session(session_id):
  _session = _rich_sessions.get(session_id)
  if not _session or _session.get('disposed'):
    raise KeyError('rich session not found')
  return await _rich_serialize_document(session_id, _session['doc'], _session.get('kind', 'bokeh'))
`;

/**
 * 同梱ファイルを取得して Pyodide のファイルシステムへ書く。
 * 取得できなかった場合も起動は続ける（import が失敗するだけに留める）。
 * @returns {Promise<boolean>} すべて書けたか
 */
async function installBundle() {
  try {
    // 取得先はワーカー自身の場所から組み立てる（github.io の /pyhiroba/ 配下と
    // 独自ドメインの直下、どちらでも解決できるようにするため）。
    const base = new URL('../py/', self.location.href);
    // 版数はこのワーカー自身の ?v= をそのまま使う（別の定数を持つと更新漏れが起きるため）
    const ver = self.location.search;
    const sources = await Promise.all(BUNDLE_FILES.map(async (rel) => {
      const res = await fetch(new URL(rel + ver, base));
      if (!res.ok) throw new Error(`${rel}: ${res.status}`);
      return [rel, await res.text()];
    }));
    for (const dir of new Set(BUNDLE_FILES.map((f) => f.slice(0, f.lastIndexOf('/'))))) {
      pyodide.FS.mkdirTree(`${BUNDLE_DIR}/${dir}`);
    }
    for (const [rel, text] of sources) {
      pyodide.FS.writeFile(`${BUNDLE_DIR}/${rel}`, text, { encoding: 'utf8' });
    }
    return true;
  } catch (e) {
    // オフラインの初回など。ここで止めると Python 自体が使えなくなるので続行する
    return false;
  }
}

// ============================================================
// フォームの送信を受ける Python コード（ボタンが押されたときに呼ぶ）
// ============================================================
// ui.form() は「表示していったんセルを終える」→「押されたら登録済みの関数を呼ぶ」
// という2段階で動く。ここはその2段階目。セルの実行とは独立して呼ばれる。
//
// handler の書き方は3通りあり、すべてに対応する必要がある。
//   def            … 部品がそのまま返る
//   async def      … 待つもの（awaitable）が返る。ai.ask() を使う教材はこれになる
//   async def+yield… 非同期の反復子が返る。書けたところから見せる教材で使う
// await を忘れると _repr_html_() が失敗するため、ここで必ず見分ける。
const PYTHON_HUI_CODE = `
import inspect as _inspect

async def _hui_submit(_form_id, _values, _send):
    from library_hiroba import ui as _ui
    _form = _ui.get_form(_form_id)
    if _form is None:
        # 保存した .ipynb を開き直した直後など、登録が残っていない場合。
        # 黙って何も起きないと「壊れている」と見えるので、やることを伝える。
        _send('__hui_stale__')
        return
    # 押した直後に「考え中」を出す（Colab と同じものが出るので見え方が変わらない）
    _pending = _form.pending_html()
    if _pending:
        _send(_pending)
    _result = _form.submit(**_values)
    if _inspect.isasyncgen(_result):
        async for _item in _result:
            _send(_item._repr_html_())
        return
    if _inspect.isawaitable(_result):
        _result = await _result
    _send(_result._repr_html_())
`;

// ============================================================
// Python実行コード（各セル実行時に呼ぶ）
// ============================================================
const PYTHON_EXEC_CODE = `
# 実行するコードを linecache に登録し、トレースバックに該当行が出るようにする。
# ファイル名 '<セル>' は SyntaxError.filename・compile のファイル名と一致させ、
# メイン側（app.exec.js）の行番号/該当コード抽出が機能するようにする。
import linecache as _linecache
_linecache.cache['<セル>'] = (len(_cell_code), None, _cell_code.splitlines(keepends=True), '<セル>')

_out_cap = _CapIO()
_err_cap = _CapIO()
_old_out = sys.stdout
_old_err = sys.stderr
sys.stdout = _out_cap
sys.stderr = _err_cap

_err_type    = None
_err_msg     = None
_err_tb      = None
_display_html = None   # DataFrame などの HTML repr
_last_display = None   # その他の値の text repr
_rich_outputs = []
_rich_safety_problem = _rich_safety_problem_for_code(_cell_code)

# 前のグラフをクリア（matplotlib が使われている場合のみ）
if 'matplotlib.pyplot' in sys.modules:
    try:
        sys.modules['matplotlib.pyplot'].close('all')
    except Exception:
        pass

# セルの中で await が使えるようにする（Jupyter / Colab と同じ振る舞い）。
# await を含むコードは、compile がコルーチンのコードオブジェクトを返すので、
# その場合だけ await する。await を含まないコードの動きはこれまでと変わらない。
_AWAIT_FLAGS = _ast.PyCF_ALLOW_TOP_LEVEL_AWAIT
_CO_COROUTINE = 0x80   # コルーチンかどうかを示す印（inspect.CO_COROUTINE と同じ）

async def _run_block(_node_or_src, _mode):
    _code = compile(_node_or_src, '<セル>', _mode, _AWAIT_FLAGS)
    if _code.co_flags & _CO_COROUTINE:
        return await eval(_code, _nb_globals)
    if _mode == 'eval':
        return eval(_code, _nb_globals)
    exec(_code, _nb_globals)
    return None

try:
    # await を含むコードは通常の parse では構文エラーになるため、ここでも同じ印をつける
    _tree = compile(_cell_code, '<セル>', 'exec', _AWAIT_FLAGS | _ast.PyCF_ONLY_AST)
    # 最後の文が「式」かどうか判定（Jupyter と同じ自動表示ロジック）
    if _tree.body and isinstance(_tree.body[-1], _ast.Expr):
        # 最後の式より前の行を実行
        _exec_part = _tree.body[:-1]
        if _exec_part:
            _mod = _ast.Module(body=_exec_part, type_ignores=[])
            _ast.fix_missing_locations(_mod)
            await _run_block(_mod, 'exec')
        # 最後の式を評価
        _expr_node = _ast.Expression(body=_tree.body[-1].value)
        _ast.fix_missing_locations(_expr_node)
        _last_val = await _run_block(_expr_node, 'eval')
        # None 以外なら表示
        if _last_val is not None:
            try:
                _rich_outputs = await _build_rich_output(_last_val)
            except Exception:
                _rich_outputs = []
            if not _rich_outputs and hasattr(_last_val, '_repr_html_'):
                _display_html = _last_val._repr_html_()
            elif not _rich_outputs:
                _last_display = repr(_last_val)
    else:
        await _run_block(_cell_code, 'exec')
except SystemExit:
    pass
except Exception as _e:
    _err_type = type(_e).__name__
    _err_msg  = str(_e)
    _err_tb   = traceback.format_exc()
finally:
    sys.stdout = _old_out
    sys.stderr = _old_err

_out_text = _out_cap.getvalue()
_err_text = _err_cap.getvalue()

# matplotlibのグラフをPNG画像として取得（matplotlib が使われている場合のみ）
_figures = []
if 'matplotlib.pyplot' in sys.modules:
    _plt = sys.modules['matplotlib.pyplot']
    for _fn in _plt.get_fignums():
        try:
            _fig = _plt.figure(_fn)
            _buf = io.BytesIO()
            _fig.savefig(_buf, format='png', bbox_inches='tight', dpi=110)
            _buf.seek(0)
            _figures.append(base64.b64encode(_buf.read()).decode('utf-8'))
        except Exception:
            pass
    try:
        _plt.close('all')
    except Exception:
        pass
`;

// ============================================================
// 踏み台/DoS 対策：ワーカーからの外向き通信を「許可制＋レート制限」にする
// ============================================================
// 生徒/教材の Python は js.fetch / pyfetch / XMLHttpRequest / WebSocket 等で任意ホストへ
// 通信でき（ページのCSPはワーカーに効かない）、学校のIPを加害元にした DoS・内部探索・
// 情報流出の踏み台になり得る。そこでユーザーコード実行前に通信原語を封鎖する。
// Pyodide 自身のパッケージ取得（jsDelivr）と !pip install（PyPI）は許可リストで通す。
const NET_ALLOW_PREFIXES = [
  'https://cdn.jsdelivr.net/pyodide/',   // Pyodide本体・同梱パッケージ
  'https://cdn.holoviz.org/panel/',      // Panel/Bokeh の Pyodide wheel
  'https://pypi.org/',                    // micropip（!pip install）
  'https://files.pythonhosted.org/',      // micropip のwheel配布
];
const NET_MAX_REQ_PER_RUN = 800;          // 1実行あたりの許可リクエスト上限（DoSループ抑止）
let _netReqCount = 0;

function _netAllowed(url) {
  try { const u = String(url); return NET_ALLOW_PREFIXES.some((p) => u.startsWith(p)); }
  catch (e) { return false; }
}

function lockdownNetwork() {
  const realFetch = (typeof self.fetch === 'function') ? self.fetch.bind(self) : null;
  // fetch は許可リスト＋レート制限でラップ（js.fetch / pyodide.http.pyfetch もこれを通る）
  self.fetch = function (input, init) {
    const url = (input && input.url) ? input.url : input;
    if (!_netAllowed(url)) {
      return Promise.reject(new Error('PyHiroba: 外部サーバーへの通信は無効化されています（学習環境の安全のため）。'));
    }
    if (++_netReqCount > NET_MAX_REQ_PER_RUN) {
      return Promise.reject(new Error('PyHiroba: 通信回数が上限に達しました。'));
    }
    return realFetch ? realFetch(input, init) : Promise.reject(new Error('fetch unavailable'));
  };
  // fetch 以外の外向き経路を封鎖（バイパス防止）。Pyodide はこれらをパッケージ取得に使わない。
  const blocked = function () { throw new Error('PyHiroba: この通信機能は無効化されています。'); };
  const kill = (name) => { try { self[name] = blocked; } catch (e) { /* 差し替え不可なら無視 */ } };
  kill('XMLHttpRequest');
  kill('WebSocket');
  kill('EventSource');
  kill('Worker');          // ネストしたWorkerでのバイパス防止
  kill('SharedWorker');
  kill('importScripts');   // 任意JSの取得＆実行の防止（起動後は不要）
  try { if (self.navigator && 'sendBeacon' in self.navigator) self.navigator.sendBeacon = blocked; } catch (e) {}
}

// ============================================================
// 初期化（ライブラリは事前ロードしない＝起動が速い）
// ============================================================
async function init() {
  let heartbeat = null;
  try {
    postMessage({ type: 'progress', pct: 20, msg: 'Pyodideを読み込んでいます...' });
    // loadPyodide 中（数十MBのWASM/stdlibのDL）は進捗が出ないため、定期的にハートビートを
    // 送り、メイン側のストールタイムアウト誤発火（低速回線での正常DLの失敗扱い）を防ぐ。
    let _hbPct = 20;
    heartbeat = setInterval(() => {
      _hbPct = Math.min(_hbPct + 4, 75);
      postMessage({ type: 'progress', pct: _hbPct, msg: 'Pyodideを読み込んでいます...' });
    }, 10000);
    pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/' });
    clearInterval(heartbeat); heartbeat = null;

    postMessage({ type: 'progress', pct: 80, msg: 'Python実行環境を準備しています...' });
    // 同梱ファイルの取得は「封鎖の前」に済ませる。こうすることで、生徒コードから見た
    // 許可リスト（NET_ALLOW_PREFIXES）を広げずに、閉域網でも import だけで使えるようにする。
    await installBundle();
    await pyodide.runPythonAsync(PYTHON_SETUP_CODE);
    await pyodide.runPythonAsync(PYTHON_HUI_CODE);

    // ユーザーコード実行前に外向き通信を封鎖（Pyodide のパッケージ取得は許可リストで維持）
    lockdownNetwork();

    postMessage({ type: 'progress', pct: 100, msg: '準備完了！' });
    // indexURL は上の loadPyodide と同じ値。メインスレッドが Service Worker への
    // Pyodideコア先読み依頼に使う（値を変えるときは両方あわせて更新すること）。
    postMessage({ type: 'ready', indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/' });
  } catch (err) {
    if (heartbeat) clearInterval(heartbeat);
    postMessage({ type: 'fatal', msg: String((err && err.message) || err) });
  }
}

// ============================================================
// コード実行
// ============================================================
// Colab流の !pip install / %pip install や、その他の ! / % コマンド行を抽出する。
// これらは Python の文法ではないため、実行用コードからは取り除く（行数は維持）。
function extractDirectives(code) {
  const lines = code.split('\n');
  const pipPkgs = [];
  const unsupported = [];
  let needsPanel = false;
  let needsBokeh = false;
  const cleaned = lines.map((line) => {
    // !pip install / %pip install / !pip3 install ...
    const m = line.match(/^\s*[!%]\s*pip[0-9]*\s+install\s+(.+)$/);
    if (m) {
      m[1].replace(/\s+#.*$/, '').trim().split(/\s+/).forEach((tok) => {
        if (!tok || tok.startsWith('-')) return;         // -q --upgrade 等のフラグは無視
        pipPkgs.push(tok.replace(/^["']|["']$/g, ''));   // 前後のクオートを除去
      });
      return '';
    }
    // %matplotlib inline などのマジックは黙って無視（Colab互換／Pyodideでは不要）
    if (/^\s*%\s*matplotlib\b/.test(line)) return '';
    if (/^\s*(?:import\s+panel\b|from\s+panel\b)/.test(line)) needsPanel = true;
    if (/^\s*(?:import\s+bokeh\b|from\s+bokeh\b)/.test(line)) needsBokeh = true;
    // それ以外の ! / % 行（Pythonではないコマンド）→ 非対応として記録
    const sh = line.match(/^\s*[!%]\s*(\S.*)$/);
    if (sh) { unsupported.push(sh[1].trim()); return ''; }
    return line;
  }).join('\n');
  return { cleaned, pipPkgs, unsupported, needsPanel, needsBokeh };
}

async function runCode(runId, code) {
  _netReqCount = 0;   // 実行ごとに通信レート上限をリセット
  const { cleaned, pipPkgs, unsupported, needsPanel, needsBokeh } = extractDirectives(code);

  const autoPkgs = [];
  if (needsPanel) {
    if (!richBokehPackageReady) {
      autoPkgs.push({ kind: 'bokeh', pkg: 'https://cdn.holoviz.org/panel/wheels/bokeh-3.6.3-py3-none-any.whl' });
    }
    if (!richPanelPackageReady) {
      autoPkgs.push({ kind: 'panel', pkg: 'https://cdn.holoviz.org/panel/wheels/panel-1.5.5-py3-none-any.whl' });
    }
  } else if (needsBokeh && !richBokehPackageReady) {
    autoPkgs.push({ kind: 'bokeh', pkg: 'https://cdn.holoviz.org/panel/wheels/bokeh-3.6.3-py3-none-any.whl' });
  }

  // !pip install → micropip でインストール（Pyodideの pip 相当）
  const pipResults = [];
  if (pipPkgs.length || autoPkgs.length) {
    try { await pyodide.loadPackage('micropip'); } catch (_) {}
    const installItems = [...autoPkgs, ...pipPkgs.map((pkg) => ({ kind: null, pkg }))];
    for (const item of installItems) {
      const pkg = item.pkg;
      postMessage({ type: 'pip', runId, pkg });
      try {
        pyodide.globals.set('_pip_pkg', pkg);
        if (item.kind === 'bokeh') {
          // holoviz の bokeh wheel は、ブラウザでは使わない tornado を外している一方で、
          // bokeh-sampledata（約17MBのサンプルデータ・授業には不要）を必須依存として
          // 付けている。micropip はこの解決に失敗し、bokeh の導入ごと落ちてしまう
          // （その結果 Pyodide 同梱の古い bokeh に落ち、描画も panel も動かなくなる）。
          // bokeh 本来の実行時依存はすべて Pyodide に同梱されているため、それらを先に
          // 読み込み、wheel は deps=False で入れて bokeh-sampledata を引かせない。
          await pyodide.loadPackage(
            ['contourpy', 'numpy', 'jinja2', 'pandas', 'pillow', 'pyyaml', 'xyzservices', 'packaging'],
          );
          await pyodide.runPythonAsync('import micropip\nawait micropip.install(_pip_pkg, deps=False)');
        } else {
          // panel は deps=True のまま。bokeh は上で導入済みなので満たされ、
          // bokeh の依存（＝bokeh-sampledata）を再解決することはない。
          await pyodide.runPythonAsync('import micropip\nawait micropip.install(_pip_pkg)');
        }
        pipResults.push({ pkg: pkg, ok: true });
        if (item.kind === 'bokeh') richBokehPackageReady = true;
        if (item.kind === 'panel') richPanelPackageReady = true;
      } catch (e) {
        pipResults.push({ pkg: pkg, ok: false, error: String((e && e.message) || e) });
      }
    }
  }

  // import文を解析してパッケージを自動ロード（初回のみダウンロード）
  try {
    await pyodide.loadPackagesFromImports(cleaned, {
      messageCallback: (m) => postMessage({ type: 'pkg', runId, msg: m })
    });
  } catch (_) { /* 失敗してもコード実行は試みる */ }

  pyodide.globals.set('_cell_code', cleaned);

  try {
    await pyodide.runPythonAsync(PYTHON_EXEC_CODE);

    const g = (k) => unwrapProxy(pyodide.globals.get(k));
    const figs = g('_figures') || [];
    const richOutputs = g('_rich_outputs') || [];

    const result = safeJson({
        status: 'done',
        stdout: String(g('_out_text') || ''),
        stderr: String(g('_err_text') || ''),
        errType: g('_err_type') ? String(g('_err_type')) : null,
        errMsg: g('_err_msg') ? String(g('_err_msg')) : null,
        errTb: g('_err_tb') ? String(g('_err_tb')) : null,
        displayHtml: String(g('_display_html') || ''),
        lastDisplay: String(g('_last_display') || ''),
        richOutputs: richOutputs || [],
        figs: figs,
        pip: pipResults,
        unsupported: unsupported,
    });
    postMessage({ type: 'result', runId, result });
  } catch (err) {
    postMessage({
      type: 'result', runId, result: safeJson({
        status: 'done', stdout: '', stderr: '',
        errType: 'SystemError', errMsg: String((err && err.message) || err),
          errTb: null, figs: [], displayHtml: '', lastDisplay: '', richOutputs: [],
        pip: pipResults, unsupported: unsupported,
      })
    });
  }
}

// ============================================================
// メインスレッドへの問い合わせ（依頼 → 応答）
// ============================================================
// Python から「外へ聞いて、答えを待つ」ための橋。
// AI の実行はメインスレッド側の専用ワーカー（js/ai-worker.js）が担うため、
// ここは取り次ぐだけで、このワーカーの外向き通信封鎖は一切緩めない。
//
// やり取りは文字列（JSON）に限る。Pyodide と JS の間でオブジェクトを渡すと
// プロキシの解放漏れなど面倒が増えるので、境界は単純に保つ。
let _askSeq = 0;
const _askWaiting = new Map();

// フォームの handler の中から呼ばれたときは、そのフォームの ID を添える。
// メイン側が「どこに進み具合を出せばよいか」を知るために要る（AI の読み込みは
// 数百MBかかるため、何も出ないと固まったように見える）。送信は1件ずつ順に
// 処理しているので、この1つで取り違えは起きない。
let _activeHuiForm = null;

// この本体が何に対応しているかの目印。Python からは js.pyhirobaFeatures として
// 読める（'forms' in js.pyhirobaFeatures のように使う）。
//
// library-hiroba は「フォームの入力が Python に戻るか」を知る手段が無く、
// js.pyhirobaAsk の有無（＝AI の橋があるか）で代用していた。そのため
// ai.talk().form() は、動く環境でも「Colab でだけ動きます」と出してしまう。
// ここを見てもらえば、本体の版に関係なく正しく出し分けられる。
//
// 境界は文字列だけに保つ方針に合わせ、カンマ区切りの1つの文字列にする。
// 逐次出力（ai-ask-start / ai-ask-next）に対応したら 'ai-stream' を足す。
self.pyhirobaFeatures = 'forms,ai,ai-probe';

self.pyhirobaAsk = function (kind, argsJson) {
  return new Promise((resolve, reject) => {
    const askId = ++_askSeq;
    _askWaiting.set(askId, { resolve, reject });
    postMessage({
      type: 'ask',
      askId,
      kind: String(kind),
      argsJson: String(argsJson == null ? 'null' : argsJson),
      huiForm: _activeHuiForm,
    });
  });
};

function handleAskResult(msg) {
  const w = _askWaiting.get(msg.askId);
  if (!w) return;                      // 取り消し済み・二重応答は無視
  _askWaiting.delete(msg.askId);
  if (msg.ok) w.resolve(msg.valueJson);
  else w.reject(new Error(msg.error || '処理できませんでした。'));
}

// ============================================================
// フォームの送信を受ける
// ============================================================
// セルの実行とは独立して届く（生徒がボタンを押したとき）。
// 値は必ず文字列で受け取り、型の変換は library-hiroba の submit() に任せる
// （ブラウザの入力欄からは文字列しか取れないが、Colab の数値欄は float を返す。
//   その差を library-hiroba 側で吸収してもらうことで、handler に届く型が揃う）。
// 送信は1件ずつ順番に処理する。同時に走らせると、Python へ渡すための一時変数
// （_hui_form_id など）を互いに上書きし、別のフォームの値で呼んでしまうため。
let _huiChain = Promise.resolve();

function handleHuiSubmit(msg) {
  _huiChain = _huiChain.then(() => runHuiSubmit(msg)).catch(() => {});
}

async function runHuiSubmit(msg) {
  const formId = String(msg.formId || '');
  const send = (html) => postMessage({ type: 'hui-html', formId, html: String(html) });
  try {
    if (!pyodide || !pyodide.globals.has('_hui_submit')) { send('__hui_stale__'); return; }
    _activeHuiForm = formId;
    const values = {};
    Object.keys(msg.values || {}).forEach((k) => { values[String(k)] = String(msg.values[k]); });
    // 値は JSON 文字列で渡し、Python 側で読み解く（境界にオブジェクトを持ち込まない）
    pyodide.globals.set('_hui_form_id', formId);
    pyodide.globals.set('_hui_values_json', JSON.stringify(values));
    pyodide.globals.set('_hui_send', send);
    await pyodide.runPythonAsync(
      'import json as _json\n'
      + 'await _hui_submit(_hui_form_id, _json.loads(_hui_values_json), _hui_send)\n',
    );
  } catch (err) {
    postMessage({ type: 'hui-error', formId, message: String((err && err.message) || err) });
  } finally {
    _activeHuiForm = null;
    // 渡した関数を握ったままにしない
    try { pyodide.globals.set('_hui_send', null); } catch (_) { /* 無視 */ }
  }
}

async function handleRichRenderedMessage(msg) {
  if (!msg.sessionId) return;
  try {
    pyodide.globals.set('_rich_session_id', msg.sessionId);
    pyodide.globals.set('sendPatch', sendPatch);
    pyodide.globals.set('rich_session_id', msg.sessionId);
    await pyodide.runPythonAsync(`
from panel.io.pyodide import _link_docs_worker
from panel.io.state import state

_session = _rich_sessions.get(rich_session_id)
if _session and not _session.get('disposed'):
    _session['rendered'] = True
    if not _session.get('linked'):
        _link_docs_worker(_session['doc'], sendPatch, msg_id=rich_session_id, setter='js')
        _session['linked'] = True
`);
  } catch (err) {
    console.error(err);
  }
}

async function handleRichPatchMessage(msg) {
  if (!msg.sessionId) return;
  if (!isValidRichPatchPayload(msg.patch, msg.buffers)) return;
  try {
    pyodide.globals.set('rich_session_id', msg.sessionId);
    pyodide.globals.set('patch', msg.patch);
    await pyodide.runPythonAsync(`
from panel.io.pyodide import _convert_json_patch

_session = _rich_sessions.get(rich_session_id)
if _session and _session.get('rendered') and not _session.get('disposed'):
    _session['doc'].apply_json_patch(_convert_json_patch(patch), setter='js')
`);
  } catch (err) {
    console.error(err);
  }
}

async function handleRichSnapshotRequestMessage(msg) {
  if (!msg.sessionId || !msg.requestId) return;

  for (let attempt = 0; attempt < RICH_SNAPSHOT_MAX_RETRIES; attempt += 1) {
    const state = { active: true, dirty: false };
    richSnapshotStates.set(msg.sessionId, state);
    try {
      pyodide.globals.set('rich_session_id', msg.sessionId);
      await pyodide.runPythonAsync(`
_rich_snapshot = await _rich_snapshot_for_session(rich_session_id)
`);
      const snapshot = unwrapProxy(pyodide.globals.get('_rich_snapshot'));
      state.active = false;
      richSnapshotStates.delete(msg.sessionId);
      if (state.dirty) {
        continue;
      }
      postMessage({
        type: 'rich-snapshot',
        requestId: msg.requestId,
        sessionId: msg.sessionId,
        ok: true,
        data: safeJson(snapshot),
      });
      return;
    } catch (err) {
      state.active = false;
      richSnapshotStates.delete(msg.sessionId);
      postMessage({
        type: 'rich-snapshot',
        requestId: msg.requestId,
        sessionId: msg.sessionId,
        ok: false,
        error: String((err && err.message) || err),
      });
      return;
    }
  }

  richSnapshotStates.delete(msg.sessionId);
  postMessage({
    type: 'rich-snapshot',
    requestId: msg.requestId,
    sessionId: msg.sessionId,
    ok: false,
    error: 'リッチ出力の現在状態が更新中のため、安定したsnapshotを取得できませんでした。',
  });
}

async function handleRichDisposeMessage(msg) {
  if (!msg.sessionId) return;
  richSnapshotStates.delete(msg.sessionId);
  try {
    pyodide.globals.set('rich_session_id', msg.sessionId);
    await pyodide.runPythonAsync(`
_session = _rich_sessions.pop(rich_session_id, None)
if _session:
    _session['disposed'] = True
    _doc = _session.get('doc')
    try:
        _doc.clear()
    except Exception:
        pass
`);
  } catch (err) {
    console.error(err);
  }
}

onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === 'run') {
    runCode(msg.runId, msg.code);
  } else if (msg.type === 'ask-result') {
    handleAskResult(msg);
  } else if (msg.type === 'hui-submit') {
    handleHuiSubmit(msg);
  } else if (msg.type === 'rich-rendered') {
    enqueueRichOperation(() => handleRichRenderedMessage(msg));
  } else if (msg.type === 'rich-patch') {
    enqueueRichOperation(() => handleRichPatchMessage(msg));
  } else if (msg.type === 'rich-snapshot-request') {
    enqueueRichOperation(() => handleRichSnapshotRequestMessage(msg));
  } else if (msg.type === 'rich-dispose') {
    enqueueRichOperation(() => handleRichDisposeMessage(msg));
  }
};

init();
