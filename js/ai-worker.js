/* ==================================================
   PyHiroba - AI（小さな言語モデル）の実行ワーカー

   推論をメインスレッドから切り離し、生成中でも画面が固まらないようにする。
   Python の実行を別スレッドで動かす js/pyodide-worker.js と同じ考え方。

   安全のための約束（pyodide-worker.js の外向き通信封鎖と同じ）
   ------------------------------------------------------
   ワーカーはメインスレッドとは別の通信環境を持つため、ページ側の通信ガードは
   ここには効かない。そこで、このファイルの冒頭で同じ許可リスト判定を行い、
   許可した「モデル×版」と、版を固定した計算部品以外への通信を実際に遮断する。
   ================================================== */
/* eslint-disable no-restricted-globals */
'use strict';

/* --------------------------------------------------------------
   1. 許可リスト（メインスレッドの js/ai.js と同じ内容を保つこと）
   -------------------------------------------------------------- */
const AI_MODEL_HOST = 'https://huggingface.co/';
// Worker では importmap が効かないため、外部名の参照が無い完全同梱版を使う
const AI_LIB_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js';
const AI_WASM_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist/';

let ALLOWED_MODELS = [];   // メインスレッドから受け取る [{ id, revision }]

function urlAllowed(url) {
  const u = String(url);
  if (u === AI_LIB_URL || u.startsWith(AI_WASM_BASE)) return true;
  return ALLOWED_MODELS.some((m) => u.startsWith(`${AI_MODEL_HOST}${m.id}/resolve/${m.revision}/`));
}

/** 許可リスト外への通信を実際に遮断する */
(function lockdownNetwork() {
  const realFetch = self.fetch.bind(self);
  self.fetch = function (input, init) {
    const url = (input && input.url) ? input.url : input;
    const s = String(url);
    const isExternal = /^https?:/i.test(s);
    if (isExternal && !urlAllowed(s)) {
      return Promise.reject(new Error('PyHiroba: 許可されていない場所への通信は行いません（' + s + '）'));
    }
    return realFetch(input, init);
  };
  // 念のため、他の外向き経路も塞ぐ（この機能では使わない）。
  // Worker だけは塞がない。計算部品（onnxruntime）が複数スレッドで計算するために
  // 使うため、塞ぐと計算そのものが動かなくなる。そこで動くのは版を固定した
  // 計算部品のコードだけで、モデルの取得はこのワーカーが行う。
  const blocked = function () { throw new Error('PyHiroba: この通信機能は無効化されています。'); };
  ['XMLHttpRequest', 'WebSocket', 'EventSource', 'SharedWorker'].forEach((n) => {
    try { self[n] = blocked; } catch (_) { /* 差し替え不可なら無視 */ }
  });
})();

/* --------------------------------------------------------------
   2. モデルの読み込みと生成
   -------------------------------------------------------------- */

let lib = null;          // transformers.js 本体
let pipe = null;         // 読み込み済みモデル
let loadedId = null;
let loadedDevice = '';   // 実際に使っている計算方式（webgpu / wasm）
let stopper = null;      // 生成の中断に使う
let interrupted = false; // 「停止」が押されたか
const post = (msg) => self.postMessage(msg);

/** WebGPU が使えるかを調べる。使えると生成が大幅に速くなる */
async function pickDevice() {
  try {
    if (self.navigator && self.navigator.gpu) {
      const adapter = await self.navigator.gpu.requestAdapter();
      if (adapter) return 'webgpu';
    }
  } catch (_) { /* 判定できないときは WASM を使う */ }
  return 'wasm';
}

async function loadLibrary() {
  if (lib) return lib;
  lib = await import(AI_LIB_URL);
  const env = lib.env;
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.remoteHost = AI_MODEL_HOST;
  env.remotePathTemplate = '{model}/resolve/{revision}/';
  env.useBrowserCache = true;                    // 2回目以降は端末のキャッシュから
  if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
    env.backends.onnx.wasm.wasmPaths = AI_WASM_BASE;
  }
  return lib;
}

async function handleLoad(msg) {
  ALLOWED_MODELS = msg.models || [];
  // 同じモデルを精度違いで持てるよう、id ではなく key で選ぶ
  const spec = ALLOWED_MODELS.find((m) => m.key === msg.modelKey);
  if (!spec) throw new Error('このモデルは許可されていません: ' + msg.modelKey);
  if (pipe && loadedId === spec.key) { post({ type: 'loaded', device: loadedDevice }); return; }

  post({ type: 'progress', pct: 0, text: 'AIの部品を準備しています…' });
  const t = await loadLibrary();
  const device = await pickDevice();
  post({ type: 'progress', pct: 0, text: 'モデルを読み込んでいます…' });

  // 進捗はファイルごとに届く。モデルは複数のファイルに分かれているため、
  // ファイル単位の％をそのまま出すと数字が行ったり来たりして分からない。
  // ここで全体の合計に直してから知らせる（あと何MBかも分かるようにする）。
  //
  // 数字が逆戻りしないための工夫が2つある。
  //  1. 設定ファイル（数KB）だけを受け取り終えた時点でも合計としては 100% になるが、
  //     そのあと本体（数百MB）が現れた瞬間に 1% へ落ちてしまう。
  //     そこで、本体が現れるまでは％を出さず「情報を受け取っています」と伝える。
  //  2. 受け取り終わってからも、AI を組み立てる時間（数秒〜数十秒）が残っている。
  //     ここで 100% を出すと「100%のまま止まった」ように見えるため、99% で止め、
  //     組み立て中であることを言葉で伝える。100% は最後に一度だけ出す。
  const BIG_FILE_BYTES = 8 * 1024 * 1024;   // これ以上なら「本体が始まった」とみなす
  const parts = new Map();                  // ファイル名 → { loaded, total }
  let lastSent = 0;
  const reportProgress = (force) => {
    const now = Date.now();
    if (!force && now - lastSent < 150) return;   // 送りすぎて画面を占領しないようにする
    lastSent = now;
    let loaded = 0;
    let total = 0;
    parts.forEach((v) => { loaded += v.loaded; total += v.total; });
    const started = total >= BIG_FILE_BYTES;
    const received = started && loaded >= total;
    post({
      type: 'progress',
      pct: started ? Math.min(99, Math.round((loaded / total) * 100)) : 0,
      loaded: started ? loaded : 0,
      total: started ? total : 0,
      text: !started ? 'モデルの情報を受け取っています…'
        : received ? '受け取りました。AIを組み立てています…'
          : 'モデルを受け取っています',
    });
  };

  pipe = await t.pipeline('text-generation', spec.id, {
    revision: spec.revision,
    dtype: spec.dtype || 'q4',
    device,
    progress_callback: (p) => {
      if (!p || !p.file) return;
      const cur = parts.get(p.file) || { loaded: 0, total: 0 };
      if (p.status === 'progress' && p.total) {
        cur.total = p.total;
        cur.loaded = p.loaded || 0;
      } else if (p.status === 'done') {
        cur.loaded = cur.total || cur.loaded;   // 取り終えたファイルは満了として数える
      }
      parts.set(p.file, cur);
      reportProgress(p.status === 'done');
    },
  });
  loadedId = spec.key;
  loadedDevice = device;
  // 進捗はファイルごとに来るため、最後に必ず 100% を送って表示を揃える
  post({ type: 'progress', pct: 100, text: '準備ができました' });
  post({ type: 'loaded', device });
}

/**
 * 生成結果の後始末。
 * 決められた長さで打ち切ると、文字の途中で終わることがある。Qwen などは文字を
 * バイト単位に分けて扱うため、その場合「�」（読めなかった印）が末尾に残る。
 * 打ち切りは必ず起こりうるので、そこで表示が壊れないように取り除く。
 */
function tidy(text) {
  return String(text || '').replace(/�+\s*$/, '').replace(/\s+$/, '');
}

async function handleGenerate(msg) {
  if (!pipe) throw new Error('先にモデルを読み込んでください。');
  const t = lib;
  interrupted = false;

  // 生成された文字を、届いたそばからメインスレッドへ送る（画面に少しずつ出る）
  const streamer = new t.TextStreamer(pipe.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text) => { if (text) post({ type: 'token', text }); },
  });

  stopper = new t.InterruptableStoppingCriteria();
  const started = Date.now();
  // 会話形式（chat template）を持つモデルはその形式で、持たないモデルは素の文章で渡す。
  // 持たないモデルに会話形式で渡すと、そこで失敗してしまうため。
  const hasChatTemplate = !!(pipe.tokenizer && pipe.tokenizer.chat_template);
  const input = hasChatTemplate
    ? [{ role: 'user', content: String(msg.prompt) }]
    : String(msg.prompt);
  // 生成する長さ。短すぎると文の途中で打ち切られてしまう（多バイト文字の途中で
  // 終わると文字化けにもなる）。WebGPU は速いので長め、CPU は待ち時間を考えて控えめ。
  // 逐次表示と「停止」があるので、長めでも待たされ感は増えない。
  const defaultTokens = loadedDevice === 'webgpu' ? 256 : 128;
  try {
    const out = await pipe(input, {
      max_new_tokens: msg.maxNewTokens || defaultTokens,
      // 小さなモデルは、確率のばらつきを大きくすると意味の通らない文章になりやすい。
      // 温度を下げ、上位の候補だけから選ぶことで、まだしも読める文章にする。
      temperature: msg.temperature != null ? msg.temperature : 0.3,
      top_p: 0.9,
      // 同じ語の繰り返しを抑える。
      // なお no_repeat_ngram_size は使わない。あれは「同じN個の並びを全面禁止」する指定で、
      // 番号つきリストの「1. 」「2. 」のような正当な繰り返しまで禁じてしまい、
      // かえって不自然な語を選ばせることになるため。
      repetition_penalty: 1.15,
      do_sample: true,
      return_full_text: false,
      streamer,
      stopping_criteria: stopper,
    });
    const g = out && out[0] && out[0].generated_text;
    const raw = Array.isArray(g) ? ((g[g.length - 1] || {}).content || '') : String(g || '');
    post({ type: 'done', text: tidy(raw), ms: Date.now() - started, device: loadedDevice, interrupted });
  } finally {
    stopper = null;
  }
}

/** 読み込んだモデルを破棄してメモリを解放する */
async function handleUnload() {
  if (pipe && typeof pipe.dispose === 'function') {
    try { await pipe.dispose(); } catch (_) { /* 解放できなくても続行 */ }
  }
  pipe = null;
  loadedId = null;
  loadedDevice = '';
  post({ type: 'unloaded' });
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === 'load') await handleLoad(msg);
    else if (msg.type === 'generate') await handleGenerate(msg);
    else if (msg.type === 'unload') await handleUnload();
    else if (msg.type === 'stop') {
      // 生成の途中でも受け取れる（推論はトークンごとに処理を譲るため）
      if (stopper) { interrupted = true; stopper.interrupt(); }
    }
  } catch (err) {
    stopper = null;
    post({ type: 'error', phase: msg.type, message: String((err && err.message) || err) });
  }
};

// 起動できたことをメインスレッドへ知らせる（対応環境の判定に使う）
post({ type: 'ready' });
