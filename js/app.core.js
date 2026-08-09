/* ==================================================
   Pythonノートブック - アプリケーション本体
   高校生向けプログラミング環境
   ================================================== */

'use strict';

// ============================================================
// グローバル状態
// ============================================================
let pyWorker = null;         // Pyodide 実行ワーカー（別スレッド）
let pyodideReady = false;    // ワーカーの準備完了フラグ
let pyodideIndexURL = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/'; // Pyodide配信元（Service Workerでのキャッシュに使用）
let currentRun = null;       // 実行中のセル { runId, resolve, onPkg }
let runIdCounter = 0;        // 実行の通し番号
let stopRequested = false;   // 停止ボタンが押されたか
let cells   = [];            // セルデータの配列
let nextId  = 0;             // セルIDカウンター
let editors = {};            // CodeMirrorインスタンス { id: editor }
let outputs = {};            // 実行結果キャッシュ    { id: result }
let isRunning = false;       // 実行中フラグ

// 未保存（＝最後のダウンロード以降に変更があるか）フラグ
let isDirty = false;         // 変更されたが未ダウンロード
let suppressDirty = false;   // ノート読み込み中は変更として数えない
let bypassUnloadOnce = false;// 外部リンク遷移など、意図的な離脱では未保存警告を出さない

// ライトボックス状態
let lbCellId = null;
let lbIdx    = 0;

/** ユーザー操作による変更を「未保存」として記録する */
function markDirty() {
  if (!suppressDirty) isDirty = true;
}

// 巨大ノートによるブラウザのフリーズを防ぐ読み込み上限
const MAX_IPYNB_BYTES = 8 * 1024 * 1024; // ファイルサイズ 8MB（埋め込み画像込みの現実的上限）
const MAX_IPYNB_CELLS = 500;             // セル数（大量のエディタ描画による固まりを防ぐ）

// セル実行がこの時間を超えたら「停止しますか？」を確認する
const LONG_RUN_MS = 60000;               // 1分

/**
 * 読み込もうとしている .ipynb が上限を超えていないか検査する。
 * @returns {string|null} 超過理由（'size'|'cells'）、問題なければ null
 */
function ipynbSizeProblem(json, byteLen) {
  if (byteLen != null && byteLen > MAX_IPYNB_BYTES) return 'size';
  const n = (json && Array.isArray(json.cells)) ? json.cells.length : 0;
  if (n > MAX_IPYNB_CELLS) return 'cells';
  return null;
}

/** サイズ超過時のエラーモーダルを表示する */
function showSizeLimitError(reason) {
  const mb = Math.round(MAX_IPYNB_BYTES / (1024 * 1024));
  const message = reason === 'cells'
    ? `セル数が多すぎます（上限 ${MAX_IPYNB_CELLS} 個）。\n` +
      'ノートブックを分割してからお試しください。'
    : `ファイルサイズが大きすぎます（上限 ${mb}MB）。\n` +
      '埋め込み画像を減らすか、ノートブックを分割してからお試しください。';
  return showModal({ title: '読み込めませんでした', message, okText: '閉じる', cancelText: null });
}

// ============================================================
// 初期化
// ============================================================
// ページ読み込み時に自動起動
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  // 対応環境チェック（WebAssembly / Web Worker が無ければ動かせない）。
  // 古い端末や機能制限されたブラウザで「青い画面のまま固まる」のを防ぎ、案内を出す。
  if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') {
    showUnsupportedBrowser();
    return;
  }

  setProgress(5, 'Pyodideを読み込んでいます...');

  // オフライン対応（初回ロード後にアプリ資産・Pyodideをキャッシュ）
  registerServiceWorker();

  // 外部リンククリック時の確認ガードを有効化
  initExternalLinkGuard();

  // フッターの「入力補助」ボタンに、保存済みの設定（既定はオフ）を反映する
  syncInputAssistButtons();

  // タブを閉じる/リロード/戻る時、未保存ならブラウザ標準の離脱警告を出す
  // （タブ閉じ等ではブラウザ仕様上カスタムUIは出せないため、標準ダイアログで代替）
  window.addEventListener('beforeunload', (e) => {
    // 外部リンクを開くなど、意図的な遷移では警告しない
    if (bypassUnloadOnce) { bypassUnloadOnce = false; return; }
    if (isDirty) { e.preventDefault(); e.returnValue = ''; }
  });

  try {
    // Pyodide を Web Worker（別スレッド）で起動し、準備完了まで待つ
    await startWorker();
    setProgress(100, '準備完了！');

    // 少し待ってからロード画面を消す
    await sleep(300);
    document.getElementById('loading-overlay').classList.add('hidden');

    // URL パラメータで分岐
    const params = new URLSearchParams(window.location.search);
    // PyHiroba 自身（公開教材ページ等）からの遷移なら「外部から読み込んだ」注意は不要
    const fromSite = referrerIsMaterialsPage();
    if (params.get('lesson')) {
      buildDefaultNotebook();              // ?lesson=xxx → レッスン直接ロード
    } else if (params.get('gdrive')) {
      await loadFromUrl(params.get('gdrive'), { trusted: fromSite }); // ?gdrive=ID/URL → Drive直接ロード
    } else if (params.get('nb')) {
      await loadFromUrl(params.get('nb'), { trusted: fromSite });   // ?nb=URL → .ipynb 直接ロード（Colab/Drive可）
    } else {
      showWelcomeScreen();                 // パラメータなし → ウェルカム画面
    }

  } catch (err) {
    console.error(err);
    // 青い読み込み画面のまま固めず、原因の見当と対処（許可ドメイン・再試行）を出す
    showLoadFailure(err);
  }
}

/** Pyodide ワーカーを起動し、準備完了まで待つ */
function startWorker() {
  return new Promise((resolve, reject) => {
    pyodideReady = false;
    let settled = false;
    let timer = null;
    // 一定時間まったく進捗が無ければ「ネットワーク遮断の可能性」として失敗扱いにする。
    // 進捗メッセージのたびに延長するので、低速回線での正常ロードは誤検知しない。
    const STALL_MS = 90000;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      fn(arg);
    };
    const bumpTimer = () => {
      if (settled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish(reject, new Error('TIMEOUT')), STALL_MS);
    };
    try {
      pyWorker = new Worker('../js/pyodide-worker.js?v=20260809d');
    } catch (e) {
      reject(new Error('実行環境（Worker）を起動できませんでした')); return;
    }
    bumpTimer();
    pyWorker.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === 'progress') {
        bumpTimer();               // 進捗があるうちは待ち続ける
        setProgress(msg.pct, msg.msg);
      } else if (msg.type === 'ready') {
        if (settled) return;       // タイムアウト後に遅れて来た ready は無視（失敗表示との不整合防止）
        pyodideReady = true;
        if (msg.indexURL) pyodideIndexURL = msg.indexURL;
        finish(resolve);
        precachePyodide();         // 初回ロード成功後、コアをSWキャッシュへ
      } else if (msg.type === 'fatal') {
        finish(reject, new Error(msg.msg || '初期化に失敗しました'));
      } else if (msg.type === 'pkg') {
        if (currentRun && currentRun.runId === msg.runId && currentRun.onPkg) currentRun.onPkg(msg.msg);
      } else if (msg.type === 'pip') {
        if (currentRun && currentRun.runId === msg.runId && currentRun.onPip) currentRun.onPip(msg.pkg);
      } else if (msg.type === 'result') {
        if (currentRun && currentRun.runId === msg.runId) {
          const r = currentRun; currentRun = null; r.resolve(msg.result);
        }
      } else if (msg.type === 'ask') {
        handleWorkerAsk(msg);
      } else if (msg.type === 'hui-html' || msg.type === 'hui-error') {
        // ui.form() の結果。セルの実行とは独立して届く（ボタンが押されたとき）
        showHuiResult(msg);
      }
    };
    pyWorker.onerror = () => {
      if (!settled) { finish(reject, new Error('WORKER_LOAD_FAILED')); return; }
      handleWorkerCrash();   // 準備完了後（実行中など）のクラッシュ → フリーズさせず復帰
    };
    pyWorker.onmessageerror = () => {
      if (settled) handleWorkerCrash();
    };
  });
}

/**
 * 実行中などにワーカーが異常終了した場合の復帰処理。
 * 実行中のセルがあれば「環境が停止した」旨のエラー結果で解決してスピナーを解除し、
 * 環境を再起動する（60秒待たずに復帰＝フリーズ防止）。
 */
function handleWorkerCrash() {
  pyodideReady = false;
  const running = currentRun;
  currentRun = null;
  if (pyWorker) { try { pyWorker.terminate(); } catch (e) { /* 既に停止 */ } pyWorker = null; }
  if (running && typeof running.resolve === 'function') {
    running.resolve({
      status: 'done', stdout: '', stderr: '',
      errType: 'SystemError',
      errMsg: '実行環境が予期せず停止しました（メモリ不足などの可能性があります）。環境を再起動します。',
      errTb: null, figs: [], displayHtml: '', lastDisplay: '', pip: [], unsupported: [],
    });
  }
  reinitWorker();
}

/** 実行を停止してワーカーを再起動する（無限ループ等を止める） */
function stopExecution() {
  if (!isRunning) return;
  stopRequested = true;
  const running = currentRun;
  currentRun = null;
  // AI が文章を作っている最中なら、そちらも止める。
  // Python のワーカーを終わらせても AI は別のワーカーで動き続けるため、
  // ここで止めないと「停止したのに端末が重いまま」になる。
  stopAiIfRunning();
  // ワーカーを終了（実行中のPythonを強制停止）
  if (pyWorker) { pyWorker.terminate(); pyWorker = null; }
  pyodideReady = false;
  if (running) running.resolve({ status: 'done', stopped: true });
  // 環境を再起動（変数はリセットされる）
  reinitWorker();
}

/** 停止後などにワーカーを再起動する */
async function reinitWorker() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.remove('hidden');
  setProgress(10, '実行を停止しました。環境を再起動しています...');
  try {
    await startWorker();
    setProgress(100, '準備完了！');
    await sleep(300);
    if (overlay) overlay.classList.add('hidden');
  } catch (e) {
    setProgress(0, '再起動に失敗しました: ' + e.message);
  }
}

// ============================================================
// オフライン対応（Service Worker）・環境エラーの案内
// ============================================================

/** Service Worker を登録し、初回ロード後のオフライン利用・帯域節約を有効にする */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // 初期ロードと競合しないよう load 後に登録。アプリは /nb/ 配下なので '../sw.js'（＝ルートの sw.js）
  // を登録し、スコープは '/'（サイト全体）になる。ルートの CSS/JS もキャッシュ対象にできる。
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('../sw.js').catch(() => { /* 失敗しても通常動作に影響なし */ });
  });
}

/** Pyodide のコアファイルを Service Worker のキャッシュへ保存するよう依頼する */
function precachePyodide() {
  try {
    const ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!ctrl) return;                 // SW未制御（初回の有効化前など）はスキップ
    const base = pyodideIndexURL;
    ctrl.postMessage({
      type: 'cache-urls',
      urls: [
        base + 'pyodide.js',
        base + 'pyodide.asm.js',
        base + 'pyodide.asm.wasm',
        base + 'python_stdlib.zip',
        base + 'pyodide-lock.json',
      ],
    });
  } catch (e) { /* 失敗しても実害なし */ }
}

/** 対応していないブラウザ向けの案内を表示する */
function showUnsupportedBrowser() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.remove('hidden');
  const normal = document.getElementById('loading-box-normal');
  const errBox = document.getElementById('loading-error');
  if (normal) normal.classList.add('hidden');
  if (!errBox) return;
  const t = document.getElementById('loading-error-title');
  const msg = document.getElementById('loading-error-msg');
  const domains = document.getElementById('loading-error-domains');
  const retry = errBox.querySelector('.loading-retry');
  if (t) t.textContent = 'お使いのブラウザではご利用いただけません';
  if (msg) msg.textContent = 'PyHiroba は、最新の Chrome / Edge / Safari / Firefox でご利用ください（WebAssembly と Web Worker に対応したブラウザが必要です）。';
  if (domains) domains.classList.add('hidden');
  if (retry) retry.classList.add('hidden');
  errBox.classList.remove('hidden');
}

/** 実行環境の読み込み失敗時に、原因の見当と対処（許可ドメイン・再試行）を表示する */
function showLoadFailure(err) {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.remove('hidden');
  const normal = document.getElementById('loading-box-normal');
  const errBox = document.getElementById('loading-error');
  if (normal) normal.classList.add('hidden');
  if (!errBox) {
    // 失敗UIが無い場合の最低限のフォールバック
    setProgress(0, `⚠ 読み込みエラー: ${(err && err.message) || '不明なエラー'}`);
    return;
  }
  const m = (err && err.message) || '';
  const networky = !m || m === 'TIMEOUT' || m === 'WORKER_LOAD_FAILED' || /Worker|読み込み|network|fetch/i.test(m);
  const msg = document.getElementById('loading-error-msg');
  const domains = document.getElementById('loading-error-domains');
  if (msg) {
    msg.textContent = networky
      ? '学校・組織のネットワークが、動作に必要な配信元を遮断している可能性があります。少し待っても変わらない場合は、下記のご確認をお願いします。'
      : ('エラー: ' + (m || '不明なエラー'));
  }
  if (domains) domains.classList.toggle('hidden', !networky);
  errBox.classList.remove('hidden');
}

/** ヘッダーの停止ボタンの表示切り替え */
function showStopButton(show) {
  const btn = document.getElementById('btn-stop-run');
  if (btn) btn.classList.toggle('hidden', !show);
}

function setProgress(pct, msg) {
  const bar = document.getElementById('loading-bar');
  const status = document.getElementById('loading-status');
  if (bar)    bar.style.width = pct + '%';
  if (status) status.textContent = msg;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

