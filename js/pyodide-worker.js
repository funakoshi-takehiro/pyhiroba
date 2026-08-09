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
# pyhiroba モジュール（ノートブックから使える道具）
# ============================================================
# Colab でも同じコードが動くよう、同じ名前・同じ形にしてある。
# Colab 側の中身は py/pyhiroba.py（transformers + torch）。
import json as _json, types as _types
import js as _js

class _Ai:
    """ブラウザの中だけで動く、小さな言語モデル。

    入力した文章が外部に送られることはない。通信はモデルを受け取るときだけ。

    使い方（Colab でも同じ）:
        from pyhiroba import ai
        await ai.load()
        print(await ai.ask("日本の四季について、2行で書いて"))
    """

    def __init__(self):
        self._loaded = False

    async def load(self, model=None):
        """モデルを読み込む。初回だけ時間と通信量がかかる。"""
        _res = _json.loads(await _js.pyhirobaAsk('ai-load', _json.dumps({'model': model})))
        self._loaded = True
        return _res.get('message', '準備ができました')

    async def ask(self, prompt, max_tokens=None):
        """文章を渡して、続きを書いてもらう。"""
        if not self._loaded:
            await self.load()
        _res = _json.loads(await _js.pyhirobaAsk(
            'ai-ask', _json.dumps({'prompt': str(prompt), 'max_tokens': max_tokens})))
        return _res.get('text', '')

    async def models(self):
        """選べるモデルの一覧（名前と目安の通信量）。"""
        return _json.loads(await _js.pyhirobaAsk('ai-models', 'null'))

ai = _Ai()

_pyhiroba = _types.ModuleType('pyhiroba')
_pyhiroba.__doc__ = 'PyHiroba でノートブックから使える道具（Colab でも同じ形で使えます）'
_pyhiroba.ai = ai
sys.modules['pyhiroba'] = _pyhiroba
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
            if hasattr(_last_val, '_repr_html_'):
                _display_html = _last_val._repr_html_()
            else:
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
    await pyodide.runPythonAsync(PYTHON_SETUP_CODE);

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
    // それ以外の ! / % 行（Pythonではないコマンド）→ 非対応として記録
    const sh = line.match(/^\s*[!%]\s*(\S.*)$/);
    if (sh) { unsupported.push(sh[1].trim()); return ''; }
    return line;
  }).join('\n');
  return { cleaned, pipPkgs, unsupported };
}

async function runCode(runId, code) {
  _netReqCount = 0;   // 実行ごとに通信レート上限をリセット
  const { cleaned, pipPkgs, unsupported } = extractDirectives(code);

  // !pip install → micropip でインストール（Pyodideの pip 相当）
  const pipResults = [];
  if (pipPkgs.length) {
    try { await pyodide.loadPackage('micropip'); } catch (_) {}
    for (const pkg of pipPkgs) {
      postMessage({ type: 'pip', runId, pkg });
      try {
        pyodide.globals.set('_pip_pkg', pkg);
        await pyodide.runPythonAsync('import micropip\nawait micropip.install(_pip_pkg)');
        pipResults.push({ pkg: pkg, ok: true });
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

    const g = (k) => pyodide.globals.get(k);
    const figsProxy = g('_figures');
    const figs = figsProxy ? figsProxy.toJs() : [];
    if (figsProxy && figsProxy.destroy) figsProxy.destroy();

    postMessage({
      type: 'result', runId, result: {
        status: 'done',
        stdout: g('_out_text') || '',
        stderr: g('_err_text') || '',
        errType: g('_err_type') || null,
        errMsg: g('_err_msg') || null,
        errTb: g('_err_tb') || null,
        displayHtml: g('_display_html') || '',
        lastDisplay: g('_last_display') || '',
        figs: figs,
        pip: pipResults,
        unsupported: unsupported,
      }
    });
  } catch (err) {
    postMessage({
      type: 'result', runId, result: {
        status: 'done', stdout: '', stderr: '',
        errType: 'SystemError', errMsg: String((err && err.message) || err),
        errTb: null, figs: [], displayHtml: '', lastDisplay: '',
        pip: pipResults, unsupported: unsupported,
      }
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

self.pyhirobaAsk = function (kind, argsJson) {
  return new Promise((resolve, reject) => {
    const askId = ++_askSeq;
    _askWaiting.set(askId, { resolve, reject });
    postMessage({
      type: 'ask',
      askId,
      kind: String(kind),
      argsJson: String(argsJson == null ? 'null' : argsJson),
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

onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type === 'run') runCode(msg.runId, msg.code);
  else if (msg.type === 'ask-result') handleAskResult(msg);
};

init();
