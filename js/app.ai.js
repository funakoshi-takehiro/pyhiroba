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
 *  （Python から任意の処理を呼び出せる状態にしないため） */
const AI_ASK_KINDS = ['ai-load', 'ai-ask', 'ai-models'];

/** ai.js は ESM のため、必要になったときだけ読み込む（使わない人には一切影響しない） */
let _aiModule = null;
async function loadAiModule() {
  // 相対パスは表示中のページ（/nb/）が基準になるため ../js/ を指す
  if (!_aiModule) _aiModule = await import('../js/ai.js?v=20260808i');
  return _aiModule;
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

    if (msg.kind === 'ai-load') {
      const list = mod.aiReadyModels();
      const spec = args.model
        ? mod.AI_MODELS.find((m) => m.key === args.model || m.id === args.model)
        : list[0];
      if (!spec || !spec.ready) {
        throw new Error('そのモデルは選べません: ' + String(args.model)
          + '（await ai.models() で選べるものを確認できます）');
      }

      // 大きなダウンロードの前に必ず確認する（ai.html と同じ作法）
      const ok = await showModal({
        title: 'AIのモデルを読み込みます',
        message: `${spec.label}\n\n`
          + `最初の1回だけ、約${spec.approxMB}MB のダウンロードが発生します。\n`
          + '2回目以降は端末に保存されたものを使うため、通信は発生しません。\n\n'
          + '学校のネットワークでは、クラス全員での一斉ダウンロードは避けてください。',
        okText: '読み込む',
        cancelText: 'やめる',
      });
      if (!ok) throw new Error('読み込みをやめました。');

      const res = await mod.aiLoadModel(spec.key, (pct, text) => {
        // 実行中のセルの状態表示に出す（!pip のときと同じ経路）
        if (currentRun && currentRun.onPkg) currentRun.onPkg(`${text}（${pct}%）`);
      });
      const dev = res.device === 'webgpu' ? 'WebGPU' : 'CPU';
      reply(true, JSON.stringify({
        message: `準備ができました（${spec.label}／${dev}で動きます）`,
        device: res.device,
      }));
      return;
    }

    if (msg.kind === 'ai-ask') {
      if (currentRun && currentRun.onPkg) currentRun.onPkg('AIが考えています…');
      const res = await mod.aiGenerate(String(args.prompt || ''), {
        maxNewTokens: args.max_tokens || undefined,
      });
      reply(true, JSON.stringify({ text: res.text, ms: res.ms, device: res.device }));
      return;
    }
  } catch (e) {
    reply(false, null, aiAskErrorText(mod, e));
  }
}
