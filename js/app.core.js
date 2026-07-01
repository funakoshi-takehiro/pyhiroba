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
  setProgress(5, 'Pyodideを読み込んでいます...');

  // 外部リンククリック時の確認ガードを有効化
  initExternalLinkGuard();

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
    if (params.get('lesson')) {
      buildDefaultNotebook();              // ?lesson=xxx → レッスン直接ロード
    } else if (params.get('gdrive')) {
      await loadFromUrl(params.get('gdrive')); // ?gdrive=ID/URL → Drive直接ロード
    } else if (params.get('nb')) {
      await loadFromUrl(params.get('nb'));   // ?nb=URL → .ipynb 直接ロード（Colab/Drive可）
    } else {
      showWelcomeScreen();                 // パラメータなし → ウェルカム画面
    }

  } catch (err) {
    setProgress(0, `⚠ 読み込みエラー: ${err.message}`);
    console.error(err);
  }
}

/** Pyodide ワーカーを起動し、準備完了まで待つ */
function startWorker() {
  return new Promise((resolve, reject) => {
    pyodideReady = false;
    try {
      pyWorker = new Worker('js/pyodide-worker.js?v=20260625i');
    } catch (e) {
      reject(new Error('実行環境（Worker）を起動できませんでした')); return;
    }
    pyWorker.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === 'progress') {
        setProgress(msg.pct, msg.msg);
      } else if (msg.type === 'ready') {
        pyodideReady = true;
        resolve();
      } else if (msg.type === 'fatal') {
        reject(new Error(msg.msg || '初期化に失敗しました'));
      } else if (msg.type === 'pkg') {
        if (currentRun && currentRun.runId === msg.runId && currentRun.onPkg) currentRun.onPkg(msg.msg);
      } else if (msg.type === 'result') {
        if (currentRun && currentRun.runId === msg.runId) {
          const r = currentRun; currentRun = null; r.resolve(msg.result);
        }
      }
    };
    pyWorker.onerror = () => reject(new Error('実行環境（Worker）の読み込みに失敗しました'));
  });
}

/** 実行を停止してワーカーを再起動する（無限ループ等を止める） */
function stopExecution() {
  if (!isRunning) return;
  stopRequested = true;
  const running = currentRun;
  currentRun = null;
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

