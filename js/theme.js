/* ==================================================
   PyHiroba - ダークモード切替（全ページ共通）
   <head> 内で同期読み込みし、描画前に保存済みテーマを
   適用してちらつき（FOUC）を防ぐ。
   初期状態は常にライト。切替はフッターのボタンから行い、
   選択は localStorage に記憶する。
   ================================================== */
'use strict';

/* --------------------------------------------------------------
   クリックジャッキング対策（全ページ共通・最優先で実行）
   悪意あるサイトが PyHiroba を透明な <iframe> で自分のページに重ね、
   利用者に「見えないボタン」を押させる攻撃を防ぐ。
   ・他サイトの枠内で開かれた場合は、まず画面を隠す
   ・可能なら本来のURL（枠なし）へ抜け出す
   ・抜け出せない設定（サンドボックス）のときは、隠したまま操作させない
   ※ frame-ancestors（本来のHTTPヘッダー対策）は GitHub Pages では
     付与できないため、この JavaScript による対策で補う。
   -------------------------------------------------------------- */
(function () {
  try {
    if (window.self !== window.top) {
      // 埋め込まれている → まず全体を隠す（重ねられたワナのクリックを無効化）
      document.documentElement.style.setProperty('display', 'none', 'important');
      // 本来のURLへ抜け出す（枠を破る）。別オリジンでも遷移の指定は許可される
      window.top.location = window.self.location;
    }
  } catch (_) {
    // サンドボックス等で枠から抜け出せない場合はここに来る。隠したままにする。
    try { document.documentElement.style.setProperty('display', 'none', 'important'); } catch (__) {}
  }
})();

(function () {
  const KEY = 'pyhiroba-theme';

  /** 保存済みテーマを読む（プライベートモード等で使えない場合は null） */
  function savedTheme() {
    try { return localStorage.getItem(KEY); } catch (_) { return null; }
  }

  /** テーマを適用し、フッターの切替ボタンの押下状態も同期する */
  function applyTheme(theme) {
    const dark = theme === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.querySelectorAll('.theme-toggle').forEach((btn) => {
      btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    });
  }

  /** フッターのボタンから呼ばれる：ライト ⇔ ダークを切り替えて記憶する */
  window.toggleTheme = function () {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (_) { /* 記憶できなくても切替は行う */ }
    applyTheme(next);
  };

  // 描画前に適用（このスクリプトは <head> 内で同期実行される前提）
  applyTheme(savedTheme() === 'dark' ? 'dark' : 'light');

  // この時点ではボタンがまだ DOM に無いため、読み込み後にもう一度状態を同期する
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(document.documentElement.getAttribute('data-theme'));
  });
})();
