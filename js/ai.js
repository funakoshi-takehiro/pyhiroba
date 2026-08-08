/* ==================================================
   PyHiroba - ブラウザ内で動かす小さな言語モデル（AI体験）

   設計の考え方
   ------------
   ・推論は利用者の端末の中だけで行う。入力した文章が外部へ送られることはない。
     外部との通信は「モデルの部品をダウンロードするとき」だけに限られる。
   ・ダウンロード先は、この一覧（AI_MODELS）に書いたモデルのみに限定する。
     さらに revision（版）まで指定することで、同じ名前のモデルが後から
     すり替えられても取り込まないようにする。
   ・一覧に無いURLへの通信は、下の通信ガードが実際に遮断する（設定漏れがあっても
     素通りしない）。pyodide-worker.js の外向き通信封鎖と同じ考え方。
   ・利用者が「読み込む」を押すまで、通信も計算も一切始めない（オプトイン）。
   ================================================== */
'use strict';

/* --------------------------------------------------------------
   1. 取得を許可するモデルの一覧（ここに無いモデルは読み込めない）

   revision には、その時点のコミットIDを書くのが望ましい。
   'main' のままだと、配布元でモデルが更新されたとき内容が変わりうる。
   コミットIDは Hugging Face のモデルページ「Files and versions」で確認できる。
   -------------------------------------------------------------- */
export const AI_MODELS = [
  {
    id: 'onnx-community/Qwen2.5-0.5B-Instruct',
    revision: 'main',          // TODO: 動作確認後、コミットIDに固定する
    label: 'Qwen2.5 0.5B（日本語が使えます）',
    note: '日本語と英語に対応した小さなモデルです。',
    approxMB: 400,
    dtype: 'q4',
  },
  {
    id: 'onnx-community/SmolLM2-135M-Instruct',
    revision: 'main',          // TODO: 動作確認後、コミットIDに固定する
    label: 'SmolLM2 135M（英語・いちばん軽い）',
    note: '英語向けのごく小さなモデルです。通信量を抑えたいときに。',
    approxMB: 110,
    dtype: 'q4',
  },
];

/** モデル配布元。transformers.js の既定値と同じだが、明示して固定する */
const AI_MODEL_HOST = 'https://huggingface.co/';
/** AI の計算に使う部品の配布元。Pyodide と同じ jsDelivr で、許可ドメインの追加は不要。
 *  いずれも版まで固定しているため、あとから中身が入れ替わることはない。 */
const AI_LIB_URL  = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.web.min.js';
const AI_WASM_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist/';
const AI_ORT_COMMON = 'https://cdn.jsdelivr.net/npm/onnxruntime-common@1.24.0-dev.20251116-b39e144322/dist/';

/* --------------------------------------------------------------
   2. 通信ガード
   許可した「モデル×版」の組み合わせと、計算部品の配布元だけを通す。
   それ以外への通信は、この関数が拒否する。
   -------------------------------------------------------------- */

/** 許可されたURLかどうかを判定する */
function aiUrlAllowed(url) {
  const u = String(url);
  // 計算部品（jsDelivr・いずれも版まで固定）
  if (u === AI_LIB_URL || u.startsWith(AI_WASM_BASE) || u.startsWith(AI_ORT_COMMON)) return true;
  // 許可した「モデル×版」の組み合わせ
  return AI_MODELS.some((m) => u.startsWith(`${AI_MODEL_HOST}${m.id}/resolve/${m.revision}/`));
}

let _aiGuardInstalled = false;
/** 許可リスト外への通信を実際に遮断する（設定漏れがあっても素通りさせないため） */
export function installAiFetchGuard() {
  if (_aiGuardInstalled) return;
  _aiGuardInstalled = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = (input && input.url) ? input.url : input;
    const s = String(url);
    // 同一オリジン（自分のサイト）と、教材読み込みなど既存の通信はそのまま通す。
    // ここで止めるのは「AI用の外部配布元に見えるのに、許可リストに無いもの」だけ。
    // なお import 文による読み込みはブラウザが直接行うためここを通らない。そちらは
    // ページ側の importmap で版を固定し、CSP の script-src で配布元を絞っている。
    const isAiHost = s.startsWith(AI_MODEL_HOST)
      || s.startsWith('https://cdn.jsdelivr.net/npm/onnxruntime-')
      || s.startsWith('https://cdn.jsdelivr.net/npm/@huggingface/');
    if (isAiHost && !aiUrlAllowed(s)) {
      return Promise.reject(new Error('PyHiroba: 許可されていないモデルの読み込みは行いません（' + s + '）'));
    }
    return realFetch(input, init);
  };
}

// このファイルが読み込まれた時点でガードを有効にする（ボタンを押す前から効かせる）
installAiFetchGuard();

/* --------------------------------------------------------------
   3. モデルの読み込みと文章生成
   -------------------------------------------------------------- */

let _aiLib = null;        // transformers.js 本体
let _aiPipeline = null;   // 読み込み済みのモデル
let _aiLoadedId = null;

/** transformers.js を読み込む（初回のみ）。版を固定した jsDelivr から取得する。
 *  ライブラリ本体を自ホストしても、計算部品（onnxruntime）は容量の都合で
 *  jsDelivr から取る必要があり、守れる範囲が変わらないため配布元を揃えている。 */
async function aiLoadLibrary() {
  if (_aiLib) return _aiLib;
  installAiFetchGuard();
  const lib = await import(/* @vite-ignore */ AI_LIB_URL);
  const env = lib.env;
  env.allowLocalModels = false;                  // 自サイト内をモデル置き場として探させない
  env.allowRemoteModels = true;
  env.remoteHost = AI_MODEL_HOST;
  env.remotePathTemplate = '{model}/resolve/{revision}/';
  env.useBrowserCache = true;                    // 2回目以降は端末のキャッシュから
  if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
    env.backends.onnx.wasm.wasmPaths = AI_WASM_BASE;
  }
  _aiLib = lib;
  return lib;
}

/**
 * 指定したモデルを読み込む。
 * @param {string} modelId AI_MODELS に載っているモデルID
 * @param {(pct:number, text:string)=>void} onProgress 進捗の通知
 */
export async function aiLoadModel(modelId, onProgress) {
  const spec = AI_MODELS.find((m) => m.id === modelId);
  if (!spec) throw new Error('このモデルは許可されていません: ' + modelId);
  if (_aiPipeline && _aiLoadedId === modelId) return _aiPipeline;

  const lib = await aiLoadLibrary();
  const report = (pct, text) => { if (typeof onProgress === 'function') onProgress(pct, text); };
  report(0, 'モデルを読み込んでいます…');

  _aiPipeline = await lib.pipeline('text-generation', spec.id, {
    revision: spec.revision,
    dtype: spec.dtype,
    progress_callback: (p) => {
      if (p && p.status === 'progress' && p.total) {
        report(Math.round((p.loaded / p.total) * 100), `ダウンロード中… ${p.file || ''}`);
      } else if (p && p.status === 'ready') {
        report(100, '準備ができました');
      }
    },
  });
  _aiLoadedId = modelId;
  report(100, '準備ができました');
  return _aiPipeline;
}

/**
 * 文章を生成する。入力も出力も端末の中だけで扱われる。
 * @param {string} prompt 利用者が入力した文章
 * @param {Object} opts { maxNewTokens, temperature }
 */
export async function aiGenerate(prompt, opts = {}) {
  if (!_aiPipeline) throw new Error('先にモデルを読み込んでください。');
  const messages = [{ role: 'user', content: String(prompt) }];
  const out = await _aiPipeline(messages, {
    max_new_tokens: opts.maxNewTokens || 128,
    temperature: opts.temperature != null ? opts.temperature : 0.7,
    do_sample: true,
    return_full_text: false,
  });
  // transformers.js は [{ generated_text: ... }] を返す。
  // チャット形式のときは配列（会話履歴）で返るため、最後の発言を取り出す。
  const g = out && out[0] && out[0].generated_text;
  if (Array.isArray(g)) {
    const last = g[g.length - 1];
    return (last && last.content) || '';
  }
  return String(g || '');
}

/** 読み込み済みのモデルを破棄して、メモリを解放する */
export async function aiUnload() {
  if (_aiPipeline && typeof _aiPipeline.dispose === 'function') {
    try { await _aiPipeline.dispose(); } catch (_) { /* 解放できなくても続行 */ }
  }
  _aiPipeline = null;
  _aiLoadedId = null;
}
