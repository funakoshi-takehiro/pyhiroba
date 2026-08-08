/* ==================================================
   PyHiroba - 表示の設定（全ページ共通）
   ダークモード・文字サイズ・行間を扱う。
   <head> 内で同期読み込みし、描画前に保存済みの設定を
   適用してちらつき（FOUC）を防ぐ。
   初期状態はライト・文字「中」・行間「標準」。
   切替はフッターのボタンから行い、選択は localStorage に記憶する。
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

/* --------------------------------------------------------------
   文字サイズ・行間の設定（全ページ共通）
   CSS 側は font-size をすべて rem 指定にしてあり、html の font-size
   （= 16px * --text-scale）に追従する。行間は本文系のみ
   calc(値 * --line-scale) にしてある。ここでは <html> の
   data-text / data-line 属性を切り替えるだけで、実際の倍率は CSS が持つ。
   操作UIはフッター（.v3-footer-bottom）へ実行時に差し込む。全ページの
   フッターに同じHTMLを12箇所書き足すのを避け、変更点を1箇所にまとめるため。
   -------------------------------------------------------------- */
(function () {
  const SETTINGS = [
    {
      key: 'pyhiroba-text-scale', attr: 'data-text', label: '文字',
      title: '本文の文字サイズを変える',
      options: [['s', '小'], ['m', '中'], ['l', '大']],
    },
    {
      key: 'pyhiroba-line-scale', attr: 'data-line', label: '行間',
      title: '行と行の間隔を変える',
      options: [['s', '狭'], ['m', '標準'], ['l', '広']],
    },
  ];

  /** 保存値を読む（未設定・不正値・localStorage 不可のときは既定の 'm'） */
  function saved(setting) {
    let v = null;
    try { v = localStorage.getItem(setting.key); } catch (_) { /* 使えない環境 */ }
    return setting.options.some((o) => o[0] === v) ? v : 'm';
  }

  /** <html> の属性を更新する。既定（中・標準）のときは属性を付けない */
  function applyOne(setting, value) {
    const el = document.documentElement;
    if (value === 'm') el.removeAttribute(setting.attr);
    else el.setAttribute(setting.attr, value);
  }

  /** 差し込んだボタンの選択状態を、現在の設定に合わせる */
  function syncButtons(setting, value) {
    document.querySelectorAll('[data-setting="' + setting.key + '"]').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-value') === value ? 'true' : 'false');
    });
  }

  /** ボタンから呼ばれる：値を保存して全ページ要素へ反映する */
  function choose(setting, value) {
    try { localStorage.setItem(setting.key, value); } catch (_) { /* 記憶できなくても切替は行う */ }
    applyOne(setting, value);
    syncButtons(setting, value);
    // 文字サイズが変わるとエディタの文字幅が変わるため、アプリ側に再計測を促す
    // （/nb/ の app.notebook.js が定義。他ページでは未定義なので何もしない）
    if (typeof window.onDisplaySettingsChange === 'function') {
      try { window.onDisplaySettingsChange(); } catch (_) { /* 失敗しても表示は切り替わっている */ }
    }
  }

  /**
   * 「文字 小中大 / 行間 狭標準広」の操作を差し込む。
   * 差し込み先はフッター（.v3-footer-bottom）と、明示指定された要素
   * （[data-display-controls]。アクセシビリティ方針ページの説明の中など）。
   */
  function buildControls(footer) {
    if (footer.querySelector('.disp-group')) return;   // 二重挿入の防止
    const frag = document.createDocumentFragment();
    SETTINGS.forEach((setting) => {
      const current = saved(setting);
      const group = document.createElement('div');
      group.className = 'disp-group';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', setting.label + 'の大きさ');
      const lbl = document.createElement('span');
      lbl.className = 'disp-label';
      lbl.textContent = setting.label;
      group.appendChild(lbl);
      setting.options.forEach(([value, text]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'disp-btn';
        b.textContent = text;
        b.title = setting.title + '（' + text + '）';
        b.setAttribute('data-setting', setting.key);
        b.setAttribute('data-value', value);
        b.setAttribute('aria-pressed', value === current ? 'true' : 'false');
        b.addEventListener('click', () => choose(setting, value));
        group.appendChild(b);
      });
      frag.appendChild(group);
    });
    // ダークモード切替の手前に置く（無ければ末尾）
    const themeBtn = footer.querySelector('.theme-toggle');
    const anchor = (themeBtn && themeBtn.closest('.footer-toggles')) || themeBtn;
    if (anchor && anchor.parentNode === footer) footer.insertBefore(frag, anchor);
    else footer.appendChild(frag);
  }

  // 描画前に保存済みの設定を適用（このスクリプトは <head> 内で同期実行される前提）
  SETTINGS.forEach((s) => applyOne(s, saved(s)));

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.v3-footer-bottom, [data-display-controls]').forEach(buildControls);
    SETTINGS.forEach((s) => syncButtons(s, saved(s)));
  });
})();
