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

   一覧の考え方（2026-08-08 運営者判断）
   ------------------------------------
   当初は国産モデルのみに絞ったが、**ブラウザで動かせる国産モデルは LLM-jp-3 150M しか
   実在せず、150M では会話が成立しない**ことが実機で分かった（出力が壊滅的だった）。
   一方 440M 以上・Sarashina・TinySwallow はいずれも ONNX 版が無く、変換しても
   語彙表の都合で1GB前後になる。そこで、
   ・実用になる多言語モデル（Qwen2.5・Apache-2.0）を既定にする
   ・国産モデルは「とても軽い体験用」として残す
   の二本立てにした。用途に応じて選べるよう、ラベルに性格を書いておく。

   ready の意味
   ------------
   ・true  … 実在を確認済み。画面の選択肢に出す（授業で使える）
   ・false … 実在が未確認の候補。選択肢には出さず、「使えるモデルを調べる」でのみ確認する
   推測でモデルを載せると「読み込めません」に行き当たるため、確認できたものだけを出す。

   ライセンス
   ---------
   ・Qwen2.5 の 0.5B / 1.5B は Apache-2.0。
     **3B と 72B は別ライセンス（研究用途などの制限つき）なので、ここには入れない。**
   ・LLM-jp-3 は Apache-2.0（国立情報学研究所 大規模言語モデル研究開発センター）

   approxMB について
   ----------------
   確認できていないものは**多めに見積もっている**（読み込み前の確認に出る数字なので、
   少なく言って学校の回線で驚かせるより安全側に倒す）。
   「使えるモデルを調べる」で実サイズが出るので、確認後に実測値へ直す。

   revision について
   ----------------
   'main' のままだと配布元の更新で内容が変わりうるため、本来はコミットIDで固定したい。
   短縮形（7桁）で配布元が解決できるか未確認のため、いまは 'main'。
   「使えるモデルを調べる」がコミットIDを省略せず出すので、次回の結果をもとに固定する。

   key について
   ----------
   同じモデルを精度違い（4bit / 8bit）で並べるため、id だけでは一意にならない。
   画面の選択やワーカーへの指定には、この key を使う。
   -------------------------------------------------------------- */
export const AI_MODELS = [
  {
    // 同じモデルの高精度版。4bit(q4) は小さいモデルほど劣化が効くため、
    // 8bit(q8) にして語彙の選び方が安定するかを見る。重みは model_quantized.onnx
    key: 'qwen05-q8',
    id: 'onnx-community/Qwen2.5-0.5B-Instruct',
    revision: 'main',
    label: 'Qwen2.5 0.5B 高精度版（いちばん品質が良い見込み）',
    approxMB: 900,
    dtype: 'q8',
    ready: true,
  },
  {
    // このセッションで実際に読み込み・生成まで動くことを確認済みの組み合わせ
    key: 'qwen05-q4',
    id: 'onnx-community/Qwen2.5-0.5B-Instruct',
    revision: 'main',
    label: 'Qwen2.5 0.5B 軽い版（通信量を抑えたいとき）',
    approxMB: 700,
    dtype: 'q4',
    ready: true,
  },
  {
    // 日本語がより自然になる大きさ。ただし重いので、端末診断で目安を出したうえで選ばせる
    key: 'qwen15-q4',
    id: 'onnx-community/Qwen2.5-1.5B-Instruct',
    revision: 'main',
    label: 'Qwen2.5 1.5B（日本語がより自然・重い）',
    approxMB: 1700,
    dtype: 'q4',
    ready: true,
  },
  {
    // Qwen2.5 0.5B より新しい。答えの前に <think>…</think> で考えを書くため、
    // ai-worker.js 側で enable_thinking: false を渡し、残りも取り除く
    key: 'qwen3_06-q4',
    id: 'onnx-community/Qwen3-0.6B-ONNX',
    revision: 'main',
    label: 'Qwen3 0.6B（Qwen2.5 0.5B より新しい・日本語が少し良い）',
    approxMB: 877,
    dtype: 'q4',
    ready: true,
  },
  {
    // 実測では 8bit(589MB) のほうが 4bit(877MB) より小さく、精度も高い。
    // 4bit の書き出しは語彙表を圧縮していないためで、こちらを既定に近い扱いにする。
    key: 'qwen3_06-q8',
    id: 'onnx-community/Qwen3-0.6B-ONNX',
    revision: 'main',
    label: 'Qwen3 0.6B 高精度版（軽くて品質も良い）',
    approxMB: 589,
    dtype: 'q8',
    ready: true,
  },
  {
    key: 'qwen3_17-q4',
    id: 'onnx-community/Qwen3-1.7B-ONNX',
    revision: 'main',
    label: 'Qwen3 1.7B（この一覧でいちばん賢い・重い）',
    approxMB: 2000,
    dtype: 'q4',
    ready: true,
  },
  {
    // instruct3 ではなく instruct2。ONNX に変換されているのが instruct2 だけで、
    // Colab 側（library-hiroba）もこちらを使う。揃えないと、同じ名前なのに
    // 環境ごとに別のモデルが動いてしまう。
    key: 'llmjp150m-q4',
    id: 'onnx-community/llm-jp-3-150m-instruct2-ONNX',
    revision: 'main',
    label: 'LLM-jp-3 150M（国産・とても軽い／文章は不自然です）',
    approxMB: 255,
    dtype: 'q4',
    ready: true,
  },
  {
    // 文の埋め込み（feature-extraction）用。チャット生成用ではないので task で区別し、
    // aiReadyModels()（チャットの選択肢）には出さない。多言語 MiniLM・接頭辞不要・
    // mean pooling。実測で日本語の蔵書検索が効くことを確認済み（int8＝model_quantized.onnx）。
    key: 'minilm',
    id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    revision: '2c4055b12046f11709e9df2c122e59ffbdc2f900',
    label: '文の埋め込み（多言語MiniLM・384次元）',
    approxMB: 118,
    dtype: 'q8',                    // → onnx/model_quantized.onnx（int8・118MB。q4 は逆に肥大するため使わない）
    task: 'feature-extraction',
    dim: 384,
    ready: true,
  },
];

/** 答えの前に「考えていること」を書くモデル（Qwen3 系）。生成時に抑える */
export const AI_THINKING_KEYS = new Set(['qwen3_06-q4', 'qwen3_06-q8', 'qwen3_17-q4']);

/** 画面の選択肢に出してよいモデル（実在を確認済みのもの） */
export function aiReadyModels() {
  // チャット（生成）用だけを返す。埋め込みモデル（task: 'feature-extraction'）は
  // ai.load() / 一覧 / おすすめに混ざらないよう、ここから除外する。
  return AI_MODELS.filter((m) => m.ready && m.task !== 'feature-extraction');
}

/** 埋め込み（feature-extraction）に使えるモデル。チャット一覧とは別に持つ。 */
export function aiEmbedModels() {
  return AI_MODELS.filter((m) => m.ready && m.task === 'feature-extraction');
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

/** 精度の呼び名（数字が大きいほど元のモデルに忠実で、容量も増える） */
const DTYPE_LABEL = {
  fp32: '32bit',
  fp16: '16bit',
  q8: '8bit',
  q4f16: '4bit(16bit混在)',
  q4: '4bit',
};

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
 *
 * 運営者向けの道具で、画面は持たない（試験公開ページを廃止したため）。
 * モデルを追加・変更したときは、/nb/ を開いて開発者コンソールで次を実行する:
 *
 *   const ai = await import('../js/ai.js');
 *   (await ai.aiCheckModels()).forEach(r => console.log(r.ok ? '○' : '×', r.id, r.detail));
 *
 *   1. config.json … リポジトリと版が存在するか（あわせてコミットIDを控える）
 *   2. onnx/…      … ブラウザで動く重みが実在するか、その大きさ（HEADのみ）
 *   3. tokenizer_config.json … 会話形式（chat template）に対応しているか
 * 通信ガードを通るため、ここでも許可リスト外へは一切アクセスしない。
 */
export async function aiCheckModels(onEach) {
  const results = [];
  // 同じモデルを精度違いで並べているため、配布元への問い合わせは「モデル×版」ごとに1回でよい
  const seen = new Set();
  const targets = AI_MODELS.filter((m) => {
    const k = `${m.id}@${m.revision}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  for (const m of targets) {
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
          // 用意されている精度をすべて出す。どれを採用するかの判断に直結するため、
          // 見つかった先頭ひとつではなく全部を並べる（精度が高いほど品質は良く、容量は増える）
          const list = r.weights
            .map((w) => `${DTYPE_LABEL[w.dtype] || w.dtype} ${w.size || 'サイズ不明'}`)
            .join('、');
          const parts = [`使える精度: ${list}`];
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
   3-3. この端末で動きそうかを調べる（事前診断）

   モデルの重さは端末によって「動く／動かない」がはっきり分かれる。
   数百MB〜1.6GB を落としてから動かないと分かるのは負担が大きいので、
   ダウンロードの前に、ブラウザから分かる範囲で目安を出す。

   あくまで目安であり、保証ではない。分からない項目は安全側（控えめ）に倒す。
   -------------------------------------------------------------- */

/** モジュール形式のワーカーが使えるか（この機能の前提。Firefox は 114 以降） */
function detectModuleWorker() {
  let supported = false;
  let url = '';
  try {
    url = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }));
    // type を読みに来たか＝オプションを解釈できるか。古い Firefox はここで例外になる
    const w = new Worker(url, { get type() { supported = true; return 'module'; } });
    w.terminate();
  } catch (_) {
    supported = false;
  } finally {
    if (url) { try { URL.revokeObjectURL(url); } catch (_) { /* 無視 */ } }
  }
  return supported;
}

/** 計算の速さをその場で測る。AI の計算は行列のかけ算が中心なので、それを模した処理で測る */
function benchmarkCpu() {
  const N = 96;
  const a = new Float32Array(N * N);
  const b = new Float32Array(N * N);
  for (let i = 0; i < a.length; i++) { a[i] = (i % 17) * 0.01; b[i] = (i % 13) * 0.02; }
  const c = new Float32Array(N * N);
  const t0 = performance.now();
  for (let rep = 0; rep < 6; rep++) {
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < N; k++) {
        const av = a[i * N + k];
        if (av === 0) continue;
        for (let j = 0; j < N; j++) c[i * N + j] += av * b[k * N + j];
      }
    }
  }
  const ms = performance.now() - t0;
  return { ms: Math.round(ms), checksum: c[0] };   // checksum は最適化で消されないため
}

/**
 * この端末の力量を調べ、「どのくらいの大きさまでなら動かせそうか」を返す。
 * @returns {Promise<Object>} maxMB（目安の上限）と、その根拠になった項目
 */
export async function aiDiagnose() {
  const r = { notes: [], webgpu: { available: false } };

  r.moduleWorker = detectModuleWorker();

  // WebGPU（画像処理装置）が使えると、計算が大幅に速くなり、重みもGPU側に置ける
  try {
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        r.webgpu.available = true;
        const lim = adapter.limits || {};
        r.webgpu.maxBufferMB = Math.round((lim.maxBufferSize || 0) / 1048576);
        r.webgpu.maxStorageMB = Math.round((lim.maxStorageBufferBindingSize || 0) / 1048576);
        try {
          const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null);
          if (info) r.webgpu.vendor = [info.vendor, info.architecture].filter(Boolean).join(' ');
        } catch (_) { /* 取れなくてよい */ }
      }
    }
  } catch (_) { /* 判定できなければ「使えない」扱い */ }

  // 端末のメモリとCPU。deviceMemory は一部のブラウザだけ、しかも 8GB で頭打ちになる
  r.memoryGB = (typeof navigator.deviceMemory === 'number') ? navigator.deviceMemory : null;
  r.cores = navigator.hardwareConcurrency || null;
  r.mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Mac/i.test(navigator.platform || ''));

  // モデルは端末に保存して再利用するため、保存できる空きも見る
  try {
    const est = await (navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : null);
    if (est && est.quota) {
      r.storage = {
        quotaMB: Math.round(est.quota / 1048576),
        usageMB: Math.round((est.usage || 0) / 1048576),
      };
      r.storage.freeMB = Math.max(0, r.storage.quotaMB - r.storage.usageMB);
    }
  } catch (_) { /* 分からなければ触れない */ }

  r.bench = benchmarkCpu();

  /* ---- 目安の上限を決める ---- */
  let maxMB;
  if (!r.moduleWorker) {
    maxMB = 0;
    r.notes.push('この機能に必要な仕組み（モジュール形式のワーカー）が使えません。ブラウザを最新版に更新してください。');
  } else if (r.webgpu.available) {
    const mem = r.memoryGB != null ? r.memoryGB : 8;   // 分からないときは中庸に見る
    if (r.mobile) {
      maxMB = 800;
      r.notes.push('スマートフォン・タブレットは、パソコンより余裕が少なめです。軽いモデルをおすすめします。');
    } else if (mem >= 8 && r.webgpu.maxStorageMB >= 1024) {
      maxMB = 2000;
    } else if (mem >= 4) {
      maxMB = 800;
    } else {
      maxMB = 300;
      r.notes.push('端末のメモリが少なめです。いちばん軽いモデルをおすすめします。');
    }
  } else {
    // WebGPU が無い＝CPU計算。速度もメモリの上限も厳しくなる
    const mem = r.memoryGB != null ? r.memoryGB : 4;
    r.notes.push('WebGPU が使えないため CPU で計算します。動きますが、返事までかなり時間がかかります。');
    if (r.mobile) maxMB = 300;
    else if (mem >= 8) maxMB = 800;
    else maxMB = 300;
  }

  // 計算が遅い端末では、大きいモデルは待ち時間が現実的でなくなる
  if (maxMB > 800 && r.bench.ms > 400) {
    maxMB = 800;
    r.notes.push('計算の速さを測ったところ控えめでした。大きいモデルは待ち時間が長くなるため、ひとつ下をおすすめします。');
  }

  // 保存できる空きが足りなければ、そこに合わせる
  if (r.storage && r.storage.freeMB && r.storage.freeMB < maxMB * 1.3) {
    const fit = Math.floor(r.storage.freeMB / 1.3);
    r.notes.push(`端末に保存できる空きが約 ${r.storage.freeMB}MB です。これに収まる大きさをおすすめします。`);
    maxMB = Math.max(0, Math.min(maxMB, fit));
  }

  r.maxMB = maxMB;
  return r;
}

/* --------------------------------------------------------------
   4. ワーカーとのやり取り
   -------------------------------------------------------------- */

let _worker = null;
let _loadedId = null;
let _embedLoadedId = null;   // 埋め込みモデルを読み込み済みか（確認モーダルの出し分けに使う）
/** 進行中の依頼（load / generate / embed）の解決関数を保持する */
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
    w = new Worker(new URL('./ai-worker.js?v=20260819d', import.meta.url), { type: 'module' });
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
        // 第3引数には受け取ったバイト数を渡す。％だけだと「あと何MBか」が
        // 分からず、数百MBのダウンロードでは待ち時間の見当がつかないため。
        if (p && typeof p.onProgress === 'function') {
          p.onProgress(msg.pct, msg.text, { loaded: msg.loaded || 0, total: msg.total || 0 });
        }
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
      case 'embedded':
        _pending = null;
        if (p) p.resolve({ vectors: msg.vectors || [], dim: msg.dim || 0, device: msg.device, model: msg.model });
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
    if (_worker === w) { _worker = null; _loadedId = null; _embedLoadedId = null; }
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
  return AI_MODELS.map((m) => ({
    key: m.key, id: m.id, revision: m.revision, dtype: m.dtype,
    thinking: AI_THINKING_KEYS.has(m.key),
  }));
}

/**
 * 進捗を「410MB / 900MB」の形にする。
 * 総量が分からないうちは、受け取った分だけを出す（0MB と出して止まって見せない）。
 */
export function aiFormatProgressSize(loaded, total) {
  const unit = (n) => (n >= 1024 * 1024 * 1024
    ? `${(n / 1024 / 1024 / 1024).toFixed(1)}GB`
    : `${Math.round(n / 1024 / 1024)}MB`);
  const l = Number(loaded) || 0;
  const t = Number(total) || 0;
  if (t <= 0) return l > 0 ? unit(l) : '';
  return `${unit(l)} / ${unit(t)}`;
}

/**
 * 指定したモデルを読み込む。
 * @param {string} modelKey AI_MODELS の key（同じモデルの精度違いを区別するため id ではない）
 * @param {(pct:number, text:string, size:{loaded:number,total:number})=>void} onProgress 進捗の通知
 * @returns {Promise<{device:string}>} 実際に使う計算方式（webgpu / wasm）
 */
export async function aiLoadModel(modelKey, onProgress) {
  const spec = AI_MODELS.find((m) => m.key === modelKey);
  if (!spec) throw new Error('このモデルは許可されていません: ' + modelKey);
  const res = await request(
    { type: 'load', modelKey: spec.key, models: allowListForWorker() },
    { onProgress },
  );
  _loadedId = spec.key;
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
      // 未指定なら、ワーカー側が計算方式（WebGPU / CPU）に応じて決める。
      // ここで既定値を入れてしまうと、その判断が効かなくなる。
      maxNewTokens: opts.maxNewTokens,
      temperature: opts.temperature,
    },
    { onToken: opts.onToken },
  );
}

/**
 * 文を埋め込みベクトルにする（feature-extraction）。入力も出力も端末の中だけで扱う。
 * 初回のみモデルを取得する（呼び出し側で確認モーダルを出してから呼ぶこと）。
 * @param {string[]} texts 埋め込む文の配列
 * @param {Object} opts { model, onProgress }
 * @returns {Promise<{vectors:number[][], dim:number, device:string, model:string}>}
 */
export async function aiEmbed(texts, opts = {}) {
  const list = aiEmbedModels();
  const spec = opts.model
    ? AI_MODELS.find((m) => (m.key === opts.model || m.id === opts.model) && m.task === 'feature-extraction')
    : list[0];
  if (!spec) throw new Error('その埋め込みモデルは選べません: ' + String(opts.model));
  const arr = Array.isArray(texts) ? texts : [texts];
  const res = await request(
    { type: 'embed', modelKey: spec.key, texts: arr.map((t) => String(t == null ? '' : t)), models: allowListForWorker() },
    { onProgress: opts.onProgress },
  );
  _embedLoadedId = spec.key;
  return { vectors: res.vectors, dim: res.dim, device: res.device, model: spec.key };
}

/** 埋め込みモデルを読み込み済みか（確認モーダルの出し分けに使う） */
export function aiEmbedIsLoaded(modelKey) {
  return _embedLoadedId === modelKey;
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
  _embedLoadedId = null;
}

/** モデルを読み込み済みかどうか */
export function aiIsLoaded() {
  return !!_loadedId;
}
