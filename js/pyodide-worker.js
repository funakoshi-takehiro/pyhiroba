/* ==================================================
   PyHiroba - Pyodide 実行ワーカー
   Python の実行をメインスレッドから切り離し、
   重い処理中でも画面が固まらないようにする。
   ================================================== */

/* eslint-disable no-restricted-globals */
importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js');

let pyodide = null;

// ============================================================
// Pythonセットアップコード（環境の初期化）
// ============================================================
const PYTHON_SETUP_CODE = `
import sys, io, base64, traceback, builtins, ast as _ast

# matplotlibを設定（画像として出力できるようにする）
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

# 日本語フォントの設定（利用可能な場合）
try:
    from matplotlib import rcParams
    rcParams['font.family'] = 'DejaVu Sans'
    rcParams['axes.unicode_minus'] = False
except:
    pass

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
`;

// ============================================================
// Python実行コード（各セル実行時に呼ぶ）
// ============================================================
const PYTHON_EXEC_CODE = `
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

# 前のグラフをクリア
plt.close('all')

try:
    _tree = _ast.parse(_cell_code)
    # 最後の文が「式」かどうか判定（Jupyter と同じ自動表示ロジック）
    if _tree.body and isinstance(_tree.body[-1], _ast.Expr):
        # 最後の式より前の行を exec
        _exec_part = _tree.body[:-1]
        if _exec_part:
            _mod = _ast.Module(body=_exec_part, type_ignores=[])
            _ast.fix_missing_locations(_mod)
            exec(compile(_mod, '<セル>', 'exec'), _nb_globals)
        # 最後の式を eval
        _expr_node = _ast.Expression(body=_tree.body[-1].value)
        _ast.fix_missing_locations(_expr_node)
        _last_val = eval(compile(_expr_node, '<セル>', 'eval'), _nb_globals)
        # None 以外なら表示
        if _last_val is not None:
            if hasattr(_last_val, '_repr_html_'):
                _display_html = _last_val._repr_html_()
            else:
                _last_display = repr(_last_val)
    else:
        exec(compile(_cell_code, '<セル>', 'exec'), _nb_globals)
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

# matplotlibのグラフをPNG画像として取得
_figures = []
for _fn in plt.get_fignums():
    try:
        _fig = plt.figure(_fn)
        _buf = io.BytesIO()
        _fig.savefig(_buf, format='png', bbox_inches='tight', dpi=110)
        _buf.seek(0)
        _figures.append(base64.b64encode(_buf.read()).decode('utf-8'))
    except Exception:
        pass

plt.close('all')
`;

// ============================================================
// 初期化
// ============================================================
async function init() {
  try {
    postMessage({ type: 'progress', pct: 10, msg: 'Pyodideを読み込んでいます...' });
    pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/' });

    postMessage({ type: 'progress', pct: 40, msg: '基本ライブラリ（numpy, pandas, matplotlib）を読み込んでいます...' });
    await pyodide.loadPackage(['numpy', 'pandas', 'matplotlib']);

    postMessage({ type: 'progress', pct: 80, msg: 'Python実行環境を準備しています...' });
    await pyodide.runPythonAsync(PYTHON_SETUP_CODE);

    postMessage({ type: 'progress', pct: 100, msg: '準備完了！' });
    postMessage({ type: 'ready' });
  } catch (err) {
    postMessage({ type: 'fatal', msg: String((err && err.message) || err) });
  }
}

// ============================================================
// コード実行
// ============================================================
async function runCode(runId, code) {
  // import文を解析してパッケージを自動ロード
  try {
    await pyodide.loadPackagesFromImports(code, {
      messageCallback: (m) => postMessage({ type: 'pkg', runId, msg: m })
    });
  } catch (_) { /* 失敗してもコード実行は試みる */ }

  pyodide.globals.set('_cell_code', code);

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
      }
    });
  } catch (err) {
    postMessage({
      type: 'result', runId, result: {
        status: 'done', stdout: '', stderr: '',
        errType: 'SystemError', errMsg: String((err && err.message) || err),
        errTb: null, figs: [], displayHtml: '', lastDisplay: '',
      }
    });
  }
}

onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type === 'run') runCode(msg.runId, msg.code);
};

init();
