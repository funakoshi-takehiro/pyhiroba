'use strict';

// ============================================================
// 共通モーダル（PyHiroba統一デザインの確認/通知ダイアログ）
// ============================================================
// ブラウザ標準の confirm / alert は OS の見た目で出るためサイトから浮き、
// ダークモードや文字サイズの設定にも従わない。そこで全ページ共通のモーダルを用意する。
// スタイルは css/style.css の .pmodal-* にあり、ダークモード・レスポンシブ・
// 文字サイズ／行間の設定への追従まで、そちらで面倒を見ている。
//
// このファイルは /nb/（アプリ本体）から読み込む。
// もともと js/app.notebook.js にあったものを、両方から使えるよう切り出した。
/**
 * PyHiroba共通のモーダルを表示する。
 * 2ボタンモード: { okText, cancelText, danger } → Promise<boolean>（cancelText:null で通知モード）
 * 多ボタンモード: { buttons:[{label,value,variant}] } → Promise<選択されたvalue>
 * variant: 'primary'|'confirm'|'cancel'|'danger'|'default'
 * @param {Object} opts { title, message, okText, cancelText, danger, buttons }
 */
function showModal(opts = {}) {
  const {
    title = '確認',
    message = '',
    okText = 'OK',
    cancelText = 'キャンセル',
    danger = false,
    buttons = null,
  } = opts;

  const DANGER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  const INFO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  const VARIANT_CLASS = {
    primary: 'pmodal-confirm', confirm: 'pmodal-confirm',
    cancel: 'pmodal-cancel', danger: 'pmodal-confirm is-danger', default: 'pmodal-default',
  };

  return new Promise(resolve => {
    const old = document.getElementById('pyhiroba-modal');
    if (old) old.remove();
    const prevFocus = document.activeElement; // 閉じたらフォーカスを戻す

    // ボタン定義を組み立てる
    let btnDefs, escapeValue;
    if (Array.isArray(buttons)) {
      btnDefs = buttons.map(b => ({ label: b.label, value: b.value, variant: b.variant || 'default' }));
      const c = buttons.find(b => b.variant === 'cancel');
      escapeValue = c ? c.value : null;
    } else {
      btnDefs = [];
      if (cancelText !== null) btnDefs.push({ label: cancelText, value: false, variant: 'cancel' });
      btnDefs.push({ label: okText, value: true, variant: danger ? 'danger' : 'confirm' });
      escapeValue = (cancelText === null) ? true : false;
    }

    const overlay = document.createElement('div');
    overlay.id = 'pyhiroba-modal';
    overlay.className = 'pmodal-overlay';
    overlay.innerHTML =
      '<div class="pmodal" role="dialog" aria-modal="true">' +
        '<div class="pmodal-icon"></div>' +
        '<div class="pmodal-title"></div>' +
        '<div class="pmodal-msg"></div>' +
        '<div class="pmodal-actions"></div>' +
      '</div>';

    const iconEl  = overlay.querySelector('.pmodal-icon');
    const actions = overlay.querySelector('.pmodal-actions');
    iconEl.innerHTML = danger ? DANGER_SVG : INFO_SVG;
    if (danger) iconEl.classList.add('is-danger');
    overlay.querySelector('.pmodal-title').textContent = title;
    overlay.querySelector('.pmodal-msg').textContent   = message;

    const close = (val) => {
      overlay.classList.remove('is-open');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => overlay.remove(), 180);
      if (prevFocus && typeof prevFocus.focus === 'function') {
        try { prevFocus.focus(); } catch (_) { /* 元要素が消えていても無視 */ }
      }
      resolve(val);
    };

    const btnEls = btnDefs.map(def => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pmodal-btn ' + (VARIANT_CLASS[def.variant] || 'pmodal-default');
      b.textContent = def.label;
      b.onclick = () => close(def.value);
      actions.appendChild(b);
      return b;
    });

    // フォーカストラップ＋Escape
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(escapeValue); return; }
      if (e.key === 'Tab' && btnEls.length) {
        const first = btnEls[0], last = btnEls[btnEls.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || !overlay.contains(active)) { e.preventDefault(); last.focus(); }
        } else {
          if (active === last || !overlay.contains(active)) { e.preventDefault(); first.focus(); }
        }
      }
    };

    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(escapeValue); });
    document.addEventListener('keydown', onKey, true);

    // 強制リフローで初期状態を確定させてから is-open を付与し、確実にトランジション再生
    void overlay.offsetWidth;
    overlay.classList.add('is-open');
    // 既定フォーカス：cancel系があればそこ、無ければ主ボタン（末尾）
    const cancelIdx = btnDefs.findIndex(d => d.variant === 'cancel');
    (btnEls[cancelIdx] || btnEls[btnEls.length - 1] || overlay).focus();
  });
}
