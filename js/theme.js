/* ==================================================
   PyHiroba - ダークモード切替（全ページ共通）
   <head> 内で同期読み込みし、描画前に保存済みテーマを
   適用してちらつき（FOUC）を防ぐ。
   初期状態は常にライト。切替はフッターのボタンから行い、
   選択は localStorage に記憶する。
   ================================================== */
'use strict';

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
