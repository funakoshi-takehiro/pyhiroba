/* ==================================================
   PyHiroba - ブラウザ内で動かす小さな言語モデル（AI体験）

   設計の考え方
   ------------
   ・推論は利用者の端末の中だけで行う。入力した文章が外部へ送られることはない。
     外部との通信は「モデルの部品をダウンロードするとき」だけに限られる。
   ・ダウンロード先は、この一覧（AI_MODELS）に書いたモデルのみに限定する。
     さらに revision（版）まで指定することで、同じ名前のモデルが後から
     すり替えられても取り込まないようにする。
   ・一覧に無いURLへの通信は、通信ガードが実際に遮断する（設定漏れがあっても
     素通りしない）。pyodide-worker.js の外向き通信封鎖と同じ考え方。
   ・利用者が「読み込む」を押すまで、通信も計算も一切始めない（オプトイン）。

   実行の場所
   ----------
   計算そのものは js/ai-worker.js（Web Worker）で行う。メインスレッドで
   推論すると、計算中は画面の描画も操作も止まり「ページが応答しません」に
   なるため。Python の実行を js/pyodide-worker.js に逃がしているのと同じ構造。
   このファイルは、許可リストの管理とワーカーとのやり取りを担当する。
   ================================================== */
'use strict';

/* --------------------------------------------------------------
   1. 取得を許可するモデルの一覧（ここに無いモデルは読み込めない）

   方針: 日本で作られたモデル（国産）に限る。
   ・LLM-jp-3 … 国立情報学研究所（NII）大規模言語モデル研究開発センター。Apache-2.0
   配布元の公式リポジトリは PyTorch 形式のみで、ブラウザでは動かせない。そのため
   ONNX 形式へ変換したものを読み込む（onnx-community は Hugging Face 公式系の変換元で、
   Pyodide と同じく「版を固定して使う」方針に合う）。

   ready の意味
   ------------
   ・true  … 実在を確認済み。画面の選択肢に出す（授業で使える）
   ・false … 実在が未確認の候補。選択肢には出さず、「使えるモデルを調べる」でのみ確認する
   推測でモデルを載せると「読み込めません」に行き当たるため、確認できたものだけを出す。

   2026-08-08 に開発環境の実ブラウザから確認した結果
   -------------------------------------------------
   ・下の2件（150M の instruct2 / instruct3）… 実在。model_q4.onnx が約255MB
   ・440M / 980M と Sarashina2.2 の ONNX 版 … いずれも 401（配布元に無い）。
     そのため一覧から外した。許可リストは通信を許す先そのものなので、
     実在しないものを残さず、必要になった時点で追加する。

   revision について
   ----------------
   'main' のままだと、配布元でモデルが更新されたとき内容が変わりうるため、
   本来はコミットIDで固定したい。確認時点のコミットは下記のとおりだが、
   短縮形（7桁）で配布元が解決できるか確かめられていないため、いまは 'main' のまま。
   「使えるモデルを調べる」がコミットIDを省略せずに出すようにしたので、
   次回の確認結果をもとに固定する。
   -------------------------------------------------------------- */
export const AI_MODELS = [
  {
    // 確認時点のコミット: 762812c…（安全性の調整まで済んでいる版なので、こちらを既定にする）
    id: 'onnx-community/llm-jp-3-150m-instruct3-ONNX',
    revision: 'main',
    label: 'LLM-jp-3 150M（国立情報学研究所・安全性を高めた版）',
    approxMB: 255,
    dtype: 'q4',
    ready: true,
  },
  {
    // 確認時点のコミット: 48da01c…
    id: 'onnx-community/llm-jp-3-150m-instruct2-ONNX',
    revision: 'main',
    label: 'LLM-jp-3 150M（国立情報学研究所・標準の版）',
    approxMB: 255,
    dtype: 'q4',
    ready: true,
  },
];

/** 画面の選択肢に出してよいモデル（実在を確認済みのもの） */
export function aiReadyModels() {
  return AI_MODELS.filter((m) => m.ready);
}

/** モデル配布元。transformers.js の既定値と同じだが、明示して固定する */
const AI_MODEL_HOST = 'https://huggingface.co/';
/** AI の計算に使う部品の配布元。Pyodide と同じ jsDelivr で、許可ドメインの追加は不要。
 *  いずれも版まで固定しているため、あとから中身が入れ替わることはない。
 *  ワーカー内では importmap が効かないため、外部名の参照が無い完全同梱版を使う
 *  （js/ai-worker.js の AI_LIB_URL と必ず同じ値にすること）。 */
const AI_LIB_URL  = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js';
const AI_WASM_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist/';

/* --------------------------------------------------------------
   2. 通信ガード
   許可した「モデル×版」の組み合わせと、計算部品の配布元だけを通す。
   それ以外への通信は、この関数が拒否する。
   ワーカー側にも同じ判定を置いている（ページ側のガードはワーカーに効かないため）。
   -------------------------------------------------------------- */

/** 許可されたURLかどうかを判定する */
function aiUrlAllowed(url) {
  const u = String(url);
  // 計算部品（jsDelivr・いずれも版まで固定）
  if (u === AI_LIB_URL || u.startsWith(AI_WASM_BASE)) return true;
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
   3. 失敗の理由を日本語で伝える
   -------------------------------------------------------------- */

/** ライブラリが返す英語のエラーを、利用者に分かる言葉へ言い換える */
export function aiExplainError(err) {
  const m = String((err && err.message) || err || '');
  if (m.includes('許可されていない') || m.includes('お使いのブラウザ')) return m;
  if (/Unauthorized|401|403/i.test(m)) {
    return 'このモデルが配布元に見つかりませんでした。モデルの指定が正しくない可能性があります（下の「使えるモデルを調べる」で確認できます）。';
  }
  if (/404|not ?found/i.test(m)) {
    return 'このモデルのファイルが配布元にありませんでした。別のモデルをお試しください。';
  }
  if (/Failed to fetch|NetworkError|dynamically imported module|ERR_|net::/i.test(m)) {
    return '配布元に接続できませんでした。学校のネットワークで huggingface.co と cdn.jsdelivr.net への通信が許可されているかご確認ください。';
  }
  if (/out of memory|Aborted|RangeError|allocat/i.test(m)) {
    return 'メモリが足りませんでした。もっと小さいモデルをお試しいただくか、他のタブを閉じてからやり直してください。';
  }
  return m;
}

/* --------------------------------------------------------------
   3-2. モデルが本当に使えるかを調べる

   「リポジトリはあるが ONNX の重みが無い」ことがよくある（配布元の公式リポジトリは
   PyTorch 形式だけ、という場合）。設定ファイルの有無だけでは判定できないため、
   重みの実在まで確かめる。重みは数百MBあるので、中身は取らず HEAD で存在と大きさだけ見る。
   -------------------------------------------------------------- */

/** transformers.js が探す重みのファイル名（左から順に、使いたい順） */
const ONNX_WEIGHT_FILES = [
  { file: 'onnx/model_q4.onnx', dtype: 'q4' },
  { file: 'onnx/model_q4f16.onnx', dtype: 'q4f16' },
  { file: 'onnx/model_quantized.onnx', dtype: 'q8' },
  { file: 'onnx/model_fp16.onnx', dtype: 'fp16' },
  { file: 'onnx/model.onnx', dtype: 'fp32' },
];

const fileUrl = (m, path) => `${AI_MODEL_HOST}${m.id}/resolve/${m.revision}/${path}`;

/** バイト数を「約110MB」のような読みやすい形にする */
function humanMB(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n >= 1024 * 1024 * 1024
    ? `約${(n / 1024 / 1024 / 1024).toFixed(1)}GB`
    : `約${Math.round(n / 1024 / 1024)}MB`;
}

/**
 * 許可リストの各モデルについて、次を確かめる。
 *   1. config.json … リポジトリと版が存在するか（あわせてコミットIDを控える）
 *   2. onnx/…      … ブラウザで動く重みが実在するか、その大きさ（HEADのみ）
 *   3. tokenizer_config.json … 会話形式（chat template）に対応しているか
 * 通信ガードを通るため、ここでも許可リスト外へは一切アクセスしない。
 */
export async function aiCheckModels(onEach) {
  const results = [];
  for (const m of AI_MODELS) {
    const r = {
      id: m.id, label: m.label, ready: !!m.ready,
      ok: false, detail: '', weights: [], commit: '', chat: null,
    };
    try {
      // 1. リポジトリと版
      const cfg = await fetch(fileUrl(m, 'config.json'), { method: 'GET' });
      if (!cfg.ok) {
        // 配布元は、存在しないモデルにも 401 を返すことがある（非公開との区別を
        // つけさせないため）。404 と同じ扱いで案内する。
        r.detail = (cfg.status === 404 || cfg.status === 401)
          ? `このモデルは配布元にないか、公開されていません（${cfg.status}）`
          : `配布元が応答しませんでした（${cfg.status}）`;
      } else {
        // 版の固定に使えるよう、コミットIDが読めれば控える
        r.commit = cfg.headers.get('X-Repo-Commit') || '';

        // 2. ブラウザで動く重み（HEAD なので中身は落とさない）
        for (const w of ONNX_WEIGHT_FILES) {
          try {
            const head = await fetch(fileUrl(m, w.file), { method: 'HEAD' });
            if (head.ok) {
              r.weights.push({
                dtype: w.dtype,
                file: w.file.replace('onnx/', ''),
                size: humanMB(head.headers.get('Content-Length')),
              });
            }
          } catch (_) { /* 個別の失敗は「無い」として扱う */ }
        }

        // 3. 会話形式に対応しているか
        try {
          const tk = await fetch(fileUrl(m, 'tokenizer_config.json'), { method: 'GET' });
          if (tk.ok) r.chat = (await tk.text()).includes('chat_template');
        } catch (_) { /* 判定できなければ null のまま */ }

        if (r.weights.length === 0) {
          r.detail = 'ブラウザ用の重み（ONNX）がありません。このままでは読み込めません';
        } else {
          r.ok = true;
          const w = r.weights[0];
          const parts = [`${w.file}${w.size ? ' ' + w.size : ''}`];
          // コミットIDは revision の固定に使うため、省略せずそのまま出す
          if (r.commit) parts.push(`コミット ${r.commit}`);
          if (r.chat === false) parts.push('会話形式には未対応（そのまま文章を渡します）');
          r.detail = `使えます（${parts.join('／')}）`;
        }
      }
    } catch (e) {
      r.detail = aiExplainError(e);
    }
    results.push(r);
    if (typeof onEach === 'function') onEach(r);
  }
  return results;
}

/* --------------------------------------------------------------
   4. ワーカーとのやり取り
   -------------------------------------------------------------- */

let _worker = null;
let _loadedId = null;
/** 進行中の依頼（load / generate）の解決関数を保持する */
let _pending = null;

/** 依頼中のものがあれば、その失敗として通知する */
function rejectPending(message) {
  const p = _pending;
  _pending = null;
  if (p) p.reject(new Error(message));
}

/** ワーカーを起動する（初回のみ）。この時点ではまだ通信も計算も始まらない。
 *  モジュール形式のワーカーは Firefox 114 以降が必要で、それより古い環境では
 *  ここで例外になる（対応環境の下限をわずかに上回るため、案内を出す）。 */
function ensureWorker() {
  if (_worker) return _worker;
  let w;
  try {
    w = new Worker(new URL('./ai-worker.js?v=20260808e', import.meta.url), { type: 'module' });
  } catch (_) {
    throw new Error('お使いのブラウザでは、この機能に必要な仕組みが使えません。ブラウザを最新版に更新してからお試しください。');
  }

  w.onmessage = (e) => {
    const msg = e.data || {};
    const p = _pending;
    switch (msg.type) {
      case 'ready':
        break;
      case 'progress':
        if (p && typeof p.onProgress === 'function') p.onProgress(msg.pct, msg.text);
        break;
      case 'token':
        if (p && typeof p.onToken === 'function') p.onToken(msg.text);
        break;
      case 'loaded':
        _pending = null;
        if (p) p.resolve({ device: msg.device });
        break;
      case 'done':
        _pending = null;
        if (p) p.resolve({ text: msg.text, ms: msg.ms, device: msg.device, interrupted: !!msg.interrupted });
        break;
      case 'unloaded':
        _pending = null;
        if (p) p.resolve({});
        break;
      case 'error':
        // 読み込みに失敗しても、前に読み込んだモデルはワーカーに残っている。
        // そのため _loadedId は触らない（成功したときだけ更新する）。
        _pending = null;
        if (p) p.reject(new Error(msg.message));
        break;
      default:
        break;
    }
  };
  w.onerror = (e) => {
    // ワーカー自体を起動できなかった場合（読み込み失敗など）。
    // 壊れたワーカーを抱えたままにせず破棄し、次回は起動からやり直す。
    rejectPending((e && e.message) || 'AIの実行部分を起動できませんでした。');
    try { w.terminate(); } catch (_) { /* 無視 */ }
    if (_worker === w) { _worker = null; _loadedId = null; }
  };

  _worker = w;
  return w;
}

/** ワーカーへ依頼を送り、結果を待つ。同時に1件だけ受け付ける */
function request(payload, handlers = {}) {
  const w = ensureWorker();
  if (_pending) return Promise.reject(new Error('前の処理がまだ終わっていません。'));
  return new Promise((resolve, reject) => {
    _pending = { resolve, reject, ...handlers };
    w.postMessage(payload);
  });
}

/** ワーカーへ渡す許可リスト（画面から任意のモデルを指定させないため、ここでも絞る） */
function allowListForWorker() {
  return AI_MODELS.map((m) => ({ id: m.id, revision: m.revision, dtype: m.dtype }));
}

/**
 * 指定したモデルを読み込む。
 * @param {string} modelId AI_MODELS に載っているモデルID
 * @param {(pct:number, text:string)=>void} onProgress 進捗の通知
 * @returns {Promise<{device:string}>} 実際に使う計算方式（webgpu / wasm）
 */
export async function aiLoadModel(modelId, onProgress) {
  const spec = AI_MODELS.find((m) => m.id === modelId);
  if (!spec) throw new Error('このモデルは許可されていません: ' + modelId);
  const res = await request(
    { type: 'load', modelId: spec.id, models: allowListForWorker() },
    { onProgress },
  );
  _loadedId = spec.id;
  return res;
}

/**
 * 文章を生成する。入力も出力も端末の中だけで扱われる。
 * 計算はワーカーで行うため、生成中も画面の操作は止まらない。
 * @param {string} prompt 利用者が入力した文章
 * @param {Object} opts { maxNewTokens, temperature, onToken }
 * @returns {Promise<{text:string, ms:number, device:string, interrupted:boolean}>}
 */
export async function aiGenerate(prompt, opts = {}) {
  if (!_loadedId) throw new Error('先にモデルを読み込んでください。');
  return request(
    {
      type: 'generate',
      prompt: String(prompt),
      maxNewTokens: opts.maxNewTokens || 64,
      temperature: opts.temperature,
    },
    { onToken: opts.onToken },
  );
}

/** 生成を途中で止める（次の1文字が出る前に反映される） */
export function aiStop() {
  if (_worker) _worker.postMessage({ type: 'stop' });
}

/** 読み込み済みのモデルを破棄して、メモリを解放する。
 *  ワーカーごと終了させるのが最も確実なため、そうしている（次回は再起動する）。 */
export async function aiUnload() {
  if (_worker) {
    rejectPending('モデルを解放したため、処理を中止しました。');
    _worker.terminate();
    _worker = null;
  }
  _loadedId = null;
}

/** モデルを読み込み済みかどうか */
export function aiIsLoaded() {
  return !!_loadedId;
}
