'use strict';

// ============================================================
// ノートブックから AI を呼べるようにする（Python ↔ AI ワーカーの取り次ぎ）
// ============================================================
// Python 側は pyhiroba モジュール（js/pyodide-worker.js の PYTHON_SETUP_CODE）から
// pyhirobaAsk(kind, argsJson) を呼ぶ。その依頼がここへ届く。
//
//   Python（Pyodideワーカー） → メインスレッド（ここ） → AIワーカー（js/ai-worker.js）
//
// ここは取り次ぐだけで、AI の通信そのものは従来どおり js/ai-worker.js の中で行われる。
// つまり許可リスト（モデル×版）と通信ガードはそのまま効き、
// Pyodide ワーカーの外向き通信封鎖も一切緩めない。

/** 取り次いでよい依頼の種類。ここに無いものは受け付けない。
 *  （Python から任意の処理を呼び出せる状態にしないため）
 *  ai-probe は ai.load("auto") が端末を尋ねるためのもの。 */
const AI_ASK_KINDS = ['ai-load', 'ai-ask', 'ai-models', 'ai-probe', 'ai-embed'];

/** ai.js は ESM のため、必要になったときだけ読み込む（使わない人には一切影響しない） */
let _aiModule = null;
async function loadAiModule() {
  // 相対パスは表示中のページ（/nb/）が基準になるため ../js/ を指す
  if (!_aiModule) _aiModule = await import('../js/ai.js?v=20260819d');
  return _aiModule;
}

/** どの依頼を処理しているかの手掛かり。フォームから呼ばれた場合はフォームの ID が入る */
let _askContext = null;

/**
 * 進み具合を出す。出し先は依頼元によって変わる。
 *  ・セルの実行中 … そのセルの出力欄
 *  ・フォームの送信中 … そのフォームの出力欄（セルは動いていないため）
 * フォームの handler の中で ai.load() を呼ぶ教材があり、そこで数百MBの取得が
 * 起きても何も出ないと「固まった」ようにしか見えないため、両方に出す。
 */
function showAiProgress(info) {
  if (currentRun && typeof currentRun.onAiProgress === 'function') {
    currentRun.onAiProgress(info);
    return;
  }
  if (_askContext && typeof showHuiProgress === 'function') showHuiProgress(_askContext, info);
}

/** 「停止」が押されたときに、AI の生成も止める（js/app.core.js から呼ばれる）。
 *  AI は別のワーカーで動くため、Python を止めただけでは動き続けてしまう。 */
function stopAiIfRunning() {
  if (_aiModule && typeof _aiModule.aiStop === 'function') {
    try { _aiModule.aiStop(); } catch (_) { /* 止められなくても続行 */ }
  }
}

/**
 * 読み込む前に、この端末で動かせそうかを調べて注意文を作る。
 * 数百MB〜2GB を受け取ってから動かないと分かるのは負担が大きいため、手前で伝える。
 * 調べられなければ空文字を返す（判定できないことを理由に止めはしない）。
 */
async function aiWeightWarning(mod, spec) {
  try {
    const d = await mod.aiDiagnose();
    if (!d || !d.maxMB) return '';
    if (spec.approxMB <= d.maxMB) return '';
    return `\n※ この端末で動かせる目安は約${d.maxMB}MB でした。`
      + 'このモデルは重すぎて、途中で止まったり、返事がとても遅くなったりするかもしれません。';
  } catch (_) {
    return '';
  }
}

/** エラーを日本語にする。ai.js が読めていればそちらの言い換えを使う */
function aiAskErrorText(mod, e) {
  const raw = String((e && e.message) || e || '');
  try { return mod && mod.aiExplainError ? mod.aiExplainError(e) : raw; } catch (_) { return raw; }
}

/** Pyodide ワーカーからの依頼を処理して返す */
async function handleWorkerAsk(msg) {
  const reply = (ok, valueJson, error) => {
    if (!pyWorker) return;
    try {
      pyWorker.postMessage({ type: 'ask-result', askId: msg.askId, ok, valueJson, error });
    } catch (_) { /* ワーカーが落ちていれば何もしない */ }
  };

  if (!AI_ASK_KINDS.includes(msg.kind)) {
    reply(false, null, 'この依頼は受け付けていません: ' + msg.kind);
    return;
  }

  let mod = null;
  _askContext = msg.huiForm || null;   // フォームの handler の中から来た依頼か
  try {
    const args = JSON.parse(msg.argsJson || 'null') || {};
    mod = await loadAiModule();

    if (msg.kind === 'ai-models') {
      const list = mod.aiReadyModels().map((m) => ({
        name: m.key, label: m.label, approxMB: m.approxMB,
      }));
      reply(true, JSON.stringify(list));
      return;
    }

    if (msg.kind === 'ai-probe') {
      // ai.load("auto") が「この端末にちょうどよいモデル」を選ぶための材料。
      // 通信は発生せず、ブラウザから分かる範囲だけを返す。
      // webgpu が入っていないと library-hiroba は「答えられなかった」とみなすので必ず入れる。
      const d = await mod.aiDiagnose();
      reply(true, JSON.stringify({
        webgpu: !!(d && d.webgpu && d.webgpu.available),
        memoryGB: (d && d.memoryGB) || null,
        cores: (d && d.cores) || null,
        storageMB: (d && d.storage && d.storage.freeMB) || null,
        browser: (d && d.webgpu && d.webgpu.vendor) || '',
      }));
      return;
    }

    if (msg.kind === 'ai-load') {
      const list = mod.aiReadyModels();
      const spec = args.model
        ? mod.AI_MODELS.find((m) => m.key === args.model || m.id === args.model)
        : list[0];
      if (!spec) {
        throw new Error('そのモデルは選べません: ' + String(args.model)
          + '（いま使えるのは ' + list.map((m) => m.key).join('・') + ' です）');
      }
      // 一覧には入れたが、配布元に本当にあるかをまだ確認できていないモデル。
      // 数百MBの取得を始めてから失敗するのは負担が大きいので、手前で止める。
      if (!spec.ready) {
        throw new Error('「' + spec.label + '」は、この環境でまだ動作確認ができていません。'
          + 'いま使えるのは ' + list.map((m) => m.key).join('・') + ' です。');
      }

      // 大きなダウンロードの前に必ず確認する。
      // あわせて、この端末に対して重すぎないかも調べて伝える（通信は発生しない）。
      const warning = await aiWeightWarning(mod, spec);
      const ok = await showModal({
        title: 'AIのモデルを読み込みます',
        message: `${spec.label}\n\n`
          + `最初の1回だけ、約${spec.approxMB}MB のダウンロードが発生します。\n`
          + '2回目以降は端末に保存されたものを使うため、通信は発生しません。\n\n'
          + '学校のネットワークでは、クラス全員での一斉ダウンロードは避けてください。'
          + warning,
        okText: warning ? 'それでも読み込む' : '読み込む',
        cancelText: 'やめる',
        danger: !!warning,
      });
      if (!ok) throw new Error('読み込みをやめました。');

      // 押した直後から表示を出す。ここから最初の進捗が届くまでに数秒あり、
      // その間なにも出ないと「押しても反応がない」ように見えるため。
      showAiProgress({ status: 'ai-loading', pct: 0, text: 'AIの準備を始めています' });
      const res = await mod.aiLoadModel(spec.key, (pct, text, size) => {
        showAiProgress({
          status: 'ai-loading',
          pct,
          text,
          // 「あと何MBか」も出す。％だけでは、数百MBの残りが読めないため
          sizeText: mod.aiFormatProgressSize(size && size.loaded, size && size.total),
        });
      });
      const dev = res.device === 'webgpu' ? 'WebGPU' : 'CPU';
      reply(true, JSON.stringify({
        message: `準備ができました（${spec.label}／${dev}で動きます）`,
        device: res.device,
      }));
      return;
    }

    if (msg.kind === 'ai-ask') {
      // 生成中も、どこまで進んだかを出す。文章は最後にまとめて Python へ返すが、
      // CPU で動く端末では数十秒かかるため、書けた文字数だけでも見せる。
      let chars = 0;
      let lastShown = 0;
      showAiProgress({ status: 'ai-thinking', chars: 0 });
      const res = await mod.aiGenerate(String(args.prompt || ''), {
        maxNewTokens: args.max_tokens || undefined,
        onToken: (t) => {
          chars += String(t || '').length;
          const now = Date.now();
          if (now - lastShown < 120) return;   // 出しすぎて画面を占領しないようにする
          lastShown = now;
          showAiProgress({ status: 'ai-thinking', chars });
        },
      });
      reply(true, JSON.stringify({ text: res.text, ms: res.ms, device: res.device }));
      return;
    }

    if (msg.kind === 'ai-embed') {
      const list = mod.aiEmbedModels();
      const spec = args.model
        ? mod.AI_MODELS.find((m) => (m.key === args.model || m.id === args.model) && m.task === 'feature-extraction')
        : list[0];
      if (!spec) {
        throw new Error('その埋め込みモデルは選べません: ' + String(args.model));
      }
      if (!spec.ready) {
        throw new Error('「' + spec.label + '」は、この環境でまだ動作確認ができていません。');
      }
      const texts = Array.isArray(args.texts) ? args.texts : [];
      // 空なら取得せずに空の結果を返す（次元はモデルの既知の値を使う）
      if (!texts.length) {
        reply(true, JSON.stringify({ vectors: [], dim: spec.dim || 0, device: 'wasm', model: spec.key }));
        return;
      }
      // 一度に渡せる件数の上限（橋の JSON が重くなりすぎないように。教材の10件は当然OK）
      if (texts.length > 256) {
        throw new Error('一度に渡せるのは256件までです。分割してお試しください。');
      }
      // 初回のみ、大きなダウンロードの前に確認する（AIのモデルと同じ作法）
      if (!mod.aiEmbedIsLoaded(spec.key)) {
        const warning = await aiWeightWarning(mod, spec);
        const ok = await showModal({
          title: '文の埋め込みモデルを読み込みます',
          message: `${spec.label}\n\n`
            + `最初の1回だけ、約${spec.approxMB}MB のダウンロードが発生します。\n`
            + '2回目以降は端末に保存されたものを使うため、通信は発生しません。\n\n'
            + '学校のネットワークでは、クラス全員での一斉ダウンロードは避けてください。'
            + warning,
          okText: warning ? 'それでも読み込む' : '読み込む',
          cancelText: 'やめる',
          danger: !!warning,
        });
        if (!ok) throw new Error('読み込みをやめました。');
      }
      showAiProgress({ status: 'ai-loading', pct: 0, text: '埋め込みの準備を始めています' });
      const res = await mod.aiEmbed(texts, {
        model: spec.key,
        onProgress: (pct, text, size) => {
          showAiProgress({
            status: 'ai-loading',
            pct,
            text,
            sizeText: mod.aiFormatProgressSize(size && size.loaded, size && size.total),
          });
        },
      });
      reply(true, JSON.stringify({ vectors: res.vectors, dim: res.dim, device: res.device, model: res.model }));
      return;
    }
  } catch (e) {
    reply(false, null, aiAskErrorText(mod, e));
  } finally {
    _askContext = null;
  }
}
