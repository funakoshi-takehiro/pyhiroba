'use strict';

// ============================================================
// 入力補助（かっこ・引用符の自動補完）
// ============================================================
// CodeMirror 公式アドオン closebrackets による入力支援。
// 「(」を打つと「)」が自動で入る、閉じかっこを重ねて打つと重複せず通り抜ける、
// ペアの間で Backspace すると両方消える、など。
// 初期状態はオフ（従来どおりの挙動）。フッターの「入力補助」ボタンで切り替え、
// 選択は localStorage に記憶する（theme.js と同じ方式）。
const INPUT_ASSIST_KEY = 'pyhiroba-input-assist';

/** 入力補助が有効か（明示的に 'on' が保存されているときだけ有効＝既定はオフ） */
function isInputAssistOn() {
  try { return localStorage.getItem(INPUT_ASSIST_KEY) === 'on'; } catch (_) { return false; }
}

/** フッターの「入力補助」ボタンの押下状態を、現在の設定に同期する */
function syncInputAssistButtons() {
  const on = isInputAssistOn();
  document.querySelectorAll('.assist-toggle').forEach((btn) => {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

/**
 * 表示の設定（文字サイズ・行間）が変わったとき theme.js から呼ばれる。
 * CodeMirror は文字幅をピクセルで記憶しているため、明示的に再計測させないと
 * 行番号やカーソルの位置がずれる。
 */
window.onDisplaySettingsChange = function () {
  Object.keys(editors).forEach((id) => {
    try { editors[id].refresh(); } catch (_) { /* 破棄済みは無視 */ }
  });
};

/** フッターのボタンから呼ばれる：入力補助のオン/オフを切り替えて記憶する */
function toggleInputAssist() {
  const next = isInputAssistOn() ? 'off' : 'on';
  try { localStorage.setItem(INPUT_ASSIST_KEY, next); } catch (_) { /* 記憶できなくても切替は行う */ }
  // 開いている全セルのエディタへ即座に反映（再描画は不要）
  Object.keys(editors).forEach((id) => {
    try { editors[id].setOption('autoCloseBrackets', next === 'on'); } catch (_) { /* 破棄済みは無視 */ }
  });
  syncInputAssistButtons();
}

// ============================================================
// セル管理
// ============================================================

/**
 * セルを追加する
 * @param {Object} opts - { type, content, afterId }
 * afterId が指定されたセルの下に挿入。なければ末尾に追加。
 */
function addCell(opts = {}) {
  const cell = {
    id:      nextId++,
    type:    opts.type    || 'code',
    content: opts.content || '',
    slides:  opts.slides  || [],
    alt:     opts.alt     || ''   // 画像セルの代替テキスト（スクリーンリーダー用）
  };

  if (opts.afterId != null) {
    const idx = cells.findIndex(c => c.id === opts.afterId);
    cells.splice(idx + 1, 0, cell);
  } else {
    cells.push(cell);
  }

  markDirty();
  renderAll();
  // 一括生成（デフォルトノート構築など）では focus:false でスクロールを動かさない
  if (opts.focus !== false) focusCell(cell.id);
  return cell.id;
}

/** 画面下の「追加」ボタン用 */
function appendCell(type) {
  addCell({ type });
}

// ============================================================
// 共通モーダル（PyHiroba統一デザインの確認/通知ダイアログ）
// ============================================================
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

/**
 * 外部ドメインへのリンククリックを横取りして確認モーダルを出す（フィッシング対策）。
 * 教材（信頼できない可能性のあるMarkdown）内のリンクや、外部サイトへのリンクが対象。
 * 同一オリジン・アンカー・mailto: 等は対象外。
 */
function initExternalLinkGuard() {
  document.addEventListener('click', async (e) => {
    // 修飾キー付き・中クリック等はブラウザ既定に任せる
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download')) return; // ダウンロード用アンカーは対象外
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#')) return;    // ページ内アンカー

    let url;
    try { url = new URL(href, location.href); } catch (_) { return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return; // mailto:/javascript:/blob:/data: 等

    // 外部（別オリジン）リンク → 移動前に確認（フィッシング対策）
    if (url.origin !== location.origin) {
      // PyHiroba公式が設置した信頼できるリンク（data-trusted）は確認なしで開く。
      // ただしノートブック内（教材）のリンクは data-trusted があっても信用しない。
      // （教材Markdownが data-trusted を偽装して確認を回避するのを防ぐ）
      if (a.hasAttribute('data-trusted') && !a.closest('#notebook-container')) return;
      e.preventDefault();
      const ok = await showModal({
        title: '外部のページへ移動します',
        message: '次のURLへ移動します。信頼できるものか確認してください。\n\n' + url.href,
        okText: '移動する',
        cancelText: 'キャンセル',
      });
      if (ok) {
        const w = window.open(url.href, '_blank', 'noopener,noreferrer');
        // 外部リンクは新しいタブで開くだけなので、未保存の確認は不要。
        // ポップアップがブロックされた場合のみ同一タブで遷移し、その際も警告は出さない。
        if (!w) { bypassUnloadOnce = true; location.href = url.href; }
      }
      return;
    }

    // 同一サイト内でも「別ページへ離脱」かつ未保存なら、保存確認を出す
    if (url.pathname !== location.pathname && isDirty) {
      e.preventDefault();
      const choice = await showModal({
        title: '保存されていない変更があります',
        message: 'このノートブックの変更は、\nまだ保存（ダウンロード）されていません。',
        buttons: [
          { label: 'ダウンロード', value: 'download', variant: 'primary' },
          { label: '終了する',     value: 'quit',     variant: 'default' },
          { label: 'もどる',       value: 'back',     variant: 'cancel'  },
        ],
      });
      if (choice === 'back' || choice == null) return; // 移動をやめる
      if (choice === 'download') downloadIpynb();
      isDirty = false; // beforeunload の二重確認を防ぐ
      // ダウンロードを開始させてから遷移する
      setTimeout(() => { location.href = url.href; }, choice === 'download' ? 400 : 0);
    }
  }, true); // capture段階で先取りして他のハンドラより先に判定する
}

/** セルを削除する */
async function deleteCell(id) {
  if (cells.length <= 1) {
    await showModal({
      title: '削除できません',
      message: 'ノートブックには最低1つのセルが必要です。\n最後のセルは削除できません。',
      okText: '閉じる',
      cancelText: null,
    });
    return;
  }
  // ×ボタンからの削除は必ず確認ダイアログを表示する
  const ok = await showModal({
    title: 'このセルを削除しますか？',
    message: '削除したセルは元に戻せません。',
    okText: '削除する',
    cancelText: 'キャンセル',
    danger: true,
  });
  if (!ok) return;
  cells = cells.filter(c => c.id !== id);
  delete editors[id];
  delete outputs[id];
  markDirty();
  renderAll();
}

/** セルを上に移動 */
function moveCellUp(id) {
  const idx = cells.findIndex(c => c.id === id);
  if (idx > 0) {
    [cells[idx - 1], cells[idx]] = [cells[idx], cells[idx - 1]];
    markDirty();
    renderAll();
  }
}

/** セルを下に移動 */
function moveCellDown(id) {
  const idx = cells.findIndex(c => c.id === id);
  if (idx < cells.length - 1) {
    [cells[idx], cells[idx + 1]] = [cells[idx + 1], cells[idx]];
    markDirty();
    renderAll();
  }
}

/** セルのタイプを変更（画像を失わないよう、必要に応じて中身も変換する） */
async function changeCellType(id, newType) {
  saveEditorContent(id);
  const cell = cells.find(c => c.id === id);
  if (!cell || cell.type === newType) return;

  if (cell.type === 'image' || cell.type === 'slide') {
    // 画像/スライド → 他タイプ
    const srcs = cell.type === 'image'
      ? (cell.content ? [cell.content] : [])
      : (cell.slides || []);
    if (newType === 'text') {
      // 画像を Markdown として埋め込む（表示はそのまま・失われない）。
      // 画像セルは代替テキスト(cell.alt)を alt として引き継ぐ。
      const isImg = cell.type === 'image';
      cell.content = srcs.map((src, i) =>
        `![${isImg ? escapeMdAlt(cell.alt) : 'スライド' + (i + 1)}](${src})`).join('\n\n');
      cell.slides = [];
    } else if (newType === 'code') {
      // コードセルでは画像を表示できないため、確認してから破棄する
      if (srcs.length) {
        const ok = await showModal({
          title: 'コードセルに変更しますか？',
          message: 'このセルの画像は削除されます。\n画像を残したい場合は「テキスト」に変更してください。',
          okText: '変更する',
          cancelText: 'キャンセル',
          danger: true,
        });
        if (!ok) return;
      }
      cell.content = '';
      cell.slides = [];
    } else {
      // 画像 ⇔ スライドの相互変換（UIには無いが、呼ばれても壊れないように）
      if (newType === 'slide') { cell.slides = srcs; cell.content = ''; }
      else { cell.content = srcs[0] || ''; cell.slides = []; }
    }
  } else if (newType === 'slide') {
    // テキスト → スライド：Markdown 内の画像を取り出してスライド化する。
    // 文章が消えてしまわないよう「画像だけのセル」に限定（ボタンも画像だけのセルにしか出さない）
    if (!isMediaOnlyMarkdown(cell.content)) return;
    const srcs = extractImageSrcs(cell.content || '');
    if (!srcs.length) return;
    cell.slides = srcs;
    cell.content = '';
  }

  cell.type = newType;
  if (!cell.slides) cell.slides = [];
  markDirty();
  renderAll();
}

/** 現在のエディタ内容をcells配列に保存 */
function saveEditorContent(id) {
  if (editors[id]) {
    const cell = cells.find(c => c.id === id);
    if (cell) cell.content = editors[id].getValue();
    return;
  }
  // 編集中のテキストセル（textarea）があれば、その内容も保存する
  const editArea = document.getElementById(`text-edit-${id}`);
  if (editArea && !editArea.classList.contains('hidden')) {
    const ta = editArea.querySelector('textarea');
    const cell = cells.find(c => c.id === id);
    if (ta && cell) cell.content = ta.value;
  }
}

/** 全エディタ内容を保存 */
function saveAllEditors() {
  cells.forEach(c => saveEditorContent(c.id));
}

/** 指定セルにフォーカスを当てる */
function focusCell(id) {
  setTimeout(() => {
    const ed = editors[id];
    if (!ed) return;
    // フォーカスするとブラウザが自動でそのセルまでスクロールし、
    // 視点が動いてしまう。スクロール位置を保存して元に戻す。
    const y = window.scrollY;
    ed.focus();
    window.scrollTo(0, y);
  }, 80);
}

// ============================================================
// シンタックスハイライト（括弧の入れ子を色分けするモード）
// ============================================================
/** 括弧の深さを何色で循環させるか（CSSの .cm-bracket-d0〜d5 と対応） */
const BRACKET_DEPTH_COLORS = 6;
let codeModeName = 'python';
let codeModeReady = false;

/**
 * python モードを包んで、括弧 ( ) [ ] { } に深さごとのクラスを足したモードを登録する。
 * 例: 一番外side の ( は cm-punctuation cm-bracket-d0、その中の [ は d1 …と循環する。
 * 対応する開き括弧と閉じ括弧が同じ色になるので、入れ子が目で追えるようになる。
 * 登録に失敗した場合は素の python モードのままにする（ハイライトが消えるより安全）。
 */
function ensureCodeMode() {
  if (codeModeReady) return codeModeName;
  codeModeReady = true;
  if (typeof CodeMirror === 'undefined' || !CodeMirror.defineMode || !CodeMirror.getMode) return codeModeName;
  try {
    CodeMirror.defineMode('python-hiroba', (config, parserConfig) => {
      const inner = CodeMirror.getMode(config, Object.assign({}, parserConfig, { name: 'python' }));
      if (!inner || inner.name === 'null') return inner;
      // python モードは括弧に style を付けない（null を返す）ので、深さのクラスだけを足す
      const withDepth = (style, d) => {
        const n = ((d % BRACKET_DEPTH_COLORS) + BRACKET_DEPTH_COLORS) % BRACKET_DEPTH_COLORS;
        return (style ? style + ' ' : '') + 'bracket-d' + n;
      };
      return {
        startState: () => ({ inner: CodeMirror.startState(inner), depth: 0 }),
        copyState: s => ({ inner: CodeMirror.copyState(inner, s.inner), depth: s.depth }),
        token: (stream, state) => {
          const style = inner.token(stream, state.inner);
          const text = stream.current();
          // 文字列・コメントの中の括弧は inner が string/comment を返すので色分けしない
          const plain = style == null || (style.indexOf('string') < 0 && style.indexOf('comment') < 0);
          if (text.length === 1 && plain) {
            if (text === '(' || text === '[' || text === '{') return withDepth(style, state.depth++);
            if (text === ')' || text === ']' || text === '}') {
              state.depth = Math.max(0, state.depth - 1);
              return withDepth(style, state.depth);
            }
          }
          return style;
        },
        indent: (state, textAfter, line) =>
          inner.indent ? inner.indent(state.inner, textAfter, line) : CodeMirror.Pass,
        innerMode: state => ({ state: state.inner, mode: inner }),
        electricInput: inner.electricInput,
        lineComment: inner.lineComment || '#',
        fold: inner.fold
      };
    });
    codeModeName = 'python-hiroba';
  } catch (_) { /* 失敗時は素の python モードを使う */ }
  return codeModeName;
}

// ============================================================
// レンダリング
// ============================================================
function renderAll() {
  // エディタ内容を先に保存
  saveAllEditors();

  // 古いエディタインスタンスをクリア
  Object.keys(editors).forEach(id => { delete editors[id]; });

  // 折りたたみで隠すセルを計算
  const hiddenIds = computeCollapsedHidden();

  const container = document.getElementById('notebook-container');
  container.innerHTML = '';

  cells.forEach((cell, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'cell-wrapper';
    wrapper.innerHTML = buildCellHTML(cell, idx);
    if (hiddenIds.has(cell.id)) wrapper.style.display = 'none';
    container.appendChild(wrapper);

    // 折りたたみで隠れているセルは、エディタ初期化・出力復元をスキップ
    if (hiddenIds.has(cell.id)) return;

    // コードセルのエディタ初期化
    if (cell.type === 'code') {
      const textarea = wrapper.querySelector(`.cell-code-ta[data-id="${cell.id}"]`);
      if (textarea) {
        const editor = CodeMirror.fromTextArea(textarea, {
          mode: ensureCodeMode(),
          lineNumbers: true,
          indentUnit: 4,
          tabSize: 4,
          lineWrapping: true,
          autofocus: false,
          // 入力補助（かっこ・引用符の自動補完）。既定はオフで、フッターの
          // 「入力補助」ボタンから切り替える。候補一覧を出すコード補完は無効のまま。
          autoCloseBrackets: isInputAssistOn(),
          extraKeys: {
            'Shift-Enter': () => runCell(cell.id),
            // Esc でエディタからフォーカスを外す（Tabが字下げに使われ抜けられない
            // ＝キーボードトラップになるのを防ぐ。Esc→Tabで次の要素へ移動できる）
            'Esc': cm => cm.getInputField().blur(),
            'Tab': cm => {
              if (cm.somethingSelected()) {
                cm.indentSelection('add');
              } else {
                cm.replaceSelection('    ');
              }
            }
          }
        });
        editors[cell.id] = editor;

        // スクリーンリーダー用に「何番目のセルのコードか」を伝える（CodeMirror内部の入力欄に付与）
        try { editor.getInputField().setAttribute('aria-label', `セル${idx + 1}のコード`); } catch (_) { /* 取得できない環境では無視 */ }

        // ユーザーによる編集を「未保存」として記録（初期化時の setValue は除外）
        editor.on('change', (cm, chg) => {
          if (chg && chg.origin && chg.origin !== 'setValue') markDirty();
        });

        // フォーカス時にセルをハイライト
        editor.on('focus', () => {
          wrapper.querySelector('.cell').classList.add('cell-focused');
        });
        editor.on('blur', () => {
          wrapper.querySelector('.cell').classList.remove('cell-focused');
        });
      }
    }

    // 保存済み出力を復元
    if (outputs[cell.id]) {
      renderOutput(cell.id, outputs[cell.id]);
    }
  });

  // テキストセル内の LaTeX 数式を組版する
  typesetMath();
}

/** セルのHTMLを構築する */
// ============================================================
// セクション折りたたみ（Colab風）
// ============================================================

/** テキストセルの見出しレベルを返す（見出しでなければ 0） */
function headingLevel(cell) {
  if (!cell || cell.type !== 'text' || !cell.content) return 0;
  const firstLine = (cell.content.split('\n').find(l => l.trim() !== '') || '').trim();
  const m = firstLine.match(/^(#{1,6})(?!#)/);
  return m ? m[1].length : 0;
}

/** 見出しセル（index headerIdx）のセクションに含まれる子セル数を数える */
function sectionChildCount(headerIdx) {
  const L = headingLevel(cells[headerIdx]);
  if (L === 0) return 0;
  let count = 0;
  for (let j = headerIdx + 1; j < cells.length; j++) {
    const hl = headingLevel(cells[j]);
    if (hl > 0 && hl <= L) break;   // 同レベル以上の見出しでセクション終了
    count++;
  }
  return count;
}

/** 折りたたみで隠すべきセルID の集合を返す */
function computeCollapsedHidden() {
  const hidden = new Set();
  const stack = [];  // 現在有効な「折りたたみ中セクション」の見出しレベル
  for (const cell of cells) {
    const hl = headingLevel(cell);
    if (hl > 0) {
      while (stack.length && stack[stack.length - 1] >= hl) stack.pop();
    }
    if (stack.length > 0) hidden.add(cell.id);
    if (hl > 0 && cell.collapsed) stack.push(hl);
  }
  return hidden;
}

/** 見出しセルの折りたたみ/展開を切り替える */
function toggleCollapse(id) {
  const cell = cells.find(c => c.id === id);
  if (!cell) return;

  // 折りたたみ前の「見出しセルが画面のどの高さにあるか」を覚えておく。
  // renderAll() は全セルを作り直すため、そのままだと上のセルの高さが変わって
  // 表示位置が飛んでしまう。描画後に同じ高さへ戻すことでズレを防ぐ。
  const before = getCellViewportTop(id);

  cell.collapsed = !cell.collapsed;
  markDirty();
  renderAll();

  if (before !== null) {
    // 直前に自分で合わせたスクロール位置。ここから動いていたら
    // 「利用者が自分でスクロールした」と判断して、それ以上は補正しない。
    let expected = null;
    const restore = () => {
      if (expected !== null && Math.abs(window.scrollY - expected) > 2) return;
      const after = getCellViewportTop(id);
      if (after === null) return;
      const diff = after - before;
      if (Math.abs(diff) > 1) scrollByInstant(diff);
      expected = window.scrollY;
    };
    restore();
    // 数式（MathJax）や出力の画像は描画が遅れて高さが変わるため、少しあとにも補正する
    requestAnimationFrame(restore);
    setTimeout(restore, 250);
  }
}

/** セルの上端が画面上端から何pxの位置にあるかを返す（見つからなければ null） */
function getCellViewportTop(id) {
  const el = document.querySelector(`#notebook-container .cell[data-cell-id="${id}"]`);
  return el ? el.getBoundingClientRect().top : null;
}

/**
 * 画面を dy px だけ即座にスクロールする。
 * このサイトは scroll-behavior: smooth を使っているため、位置の補正で
 * アニメーションが走らないよう instant を明示する。
 */
function scrollByInstant(dy) {
  try {
    window.scrollBy({ top: dy, left: 0, behavior: 'instant' });
  } catch (_) {
    window.scrollBy(0, dy);   // instant 未対応のブラウザ向け
  }
}

function buildCellHTML(cell, idx) {
  const isFirst = idx === 0;
  const isLast  = idx === cells.length - 1;

  // セクション折りたたみ用の情報
  const hLevel      = headingLevel(cell);
  const childCount  = hLevel > 0 ? sectionChildCount(idx) : 0;
  const collapsible = hLevel > 0 && childCount > 0;
  const isCollapsed = collapsible && !!cell.collapsed;

  let typeLabel, toolbarClass, contentHTML;

  if (cell.type === 'code') {
    typeLabel    = '🐍 コード';
    toolbarClass = 'cell-code';
    contentHTML  = buildCodeContent(cell);
  } else if (cell.type === 'text') {
    typeLabel    = '📝 テキスト';
    toolbarClass = 'cell-text';
    contentHTML  = buildTextContent(cell);
  } else if (cell.type === 'image') {
    typeLabel    = '🖼 画像';
    toolbarClass = 'cell-image';
    contentHTML  = buildImageContent(cell);
  } else if (cell.type === 'slide') {
    typeLabel    = '🎞 スライド';
    toolbarClass = 'cell-slide';
    contentHTML  = buildSlideContent(cell);
  }

  return `
    <div class="cell ${toolbarClass}${collapsible ? ' is-collapse-header' : ''}" data-cell-id="${cell.id}">
      ${collapsible ? `
      <button class="cell-collapse-btn${isCollapsed ? ' is-collapsed' : ''}" onclick="event.stopPropagation(); toggleCollapse(${cell.id})" title="${isCollapsed ? '展開する' : '折りたたむ（保存すると、次に開いたときも閉じた状態になります）'}" aria-label="${isCollapsed ? 'このセクションを展開' : 'このセクションを折りたたむ'}" aria-expanded="${isCollapsed ? 'false' : 'true'}">
        <svg class="chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </button>` : ''}
      <div class="cell-toolbar" onmousedown="event.preventDefault()">
        <div class="cell-toolbar-left">
          <span class="cell-number">[${idx + 1}]</span>
          ${cell.type === 'code' ? `
            <button class="btn-run${outputs[cell.id] ? ' is-done' : ''}" onclick="runCell(${cell.id})" title="コードを実行 (Shift+Enter)" id="run-btn-${cell.id}">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              実行
            </button>` : cell.type === 'slide' ? `
            <button class="btn-edit-text" onclick="document.getElementById('slide-input-${cell.id}').click()" title="画像を追加">
              ＋ 画像を追加
            </button>
            <input type="file" id="slide-input-${cell.id}" accept="image/*" multiple style="display:none"
              onchange="onSlideSelect(event,${cell.id})">` : ''}
        </div>
        <div class="cell-toolbar-right">
          <div class="cell-type-toggle">
            <button class="cell-type-btn ${cell.type === 'code' ? 'is-active' : ''}" data-type="code"
              onclick="changeCellType(${cell.id},'code')" title="コードセル">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              コード
            </button>
            <button class="cell-type-btn ${cell.type === 'text' ? 'is-active' : ''}" data-type="text"
              onclick="changeCellType(${cell.id},'text')" title="テキストセル">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>
              テキスト
            </button>
            ${(cell.type === 'image' || cell.type === 'slide') ? `
            <button class="cell-type-btn is-active" data-type="${cell.type}" title="${cell.type === 'image' ? '画像セル' : 'スライドセル'}">
              ${cell.type === 'image' ? '🖼 画像' : '🎞 スライド'}
            </button>` : ''}
          </div>
          <button class="btn-icon" onclick="moveCellUp(${cell.id})"   ${isFirst ? 'disabled' : ''} title="上に移動" aria-label="セルを上に移動">↑</button>
          <button class="btn-icon" onclick="moveCellDown(${cell.id})" ${isLast  ? 'disabled' : ''} title="下に移動" aria-label="セルを下に移動">↓</button>
          <button class="btn-icon btn-delete" onclick="deleteCell(${cell.id})" title="このセルを削除" aria-label="このセルを削除">✕</button>
        </div>
      </div>
      ${contentHTML}
      ${isCollapsed ? `
      <div class="cell-collapsed-note" onclick="toggleCollapse(${cell.id})">${childCount}個のセルを折りたたんでいます</div>` : ''}
    </div>
    <div class="cell-add-between">
      <button class="btn-add-between" onclick="addCell({afterId:${cell.id},type:'code'})" title="ここにセルを追加" aria-label="ここにセルを追加">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    </div>`;
}

function buildCodeContent(cell) {
  return `
    <div class="cell-editor">
      <textarea class="cell-code-ta" data-id="${cell.id}">${escHtml(cell.content)}</textarea>
    </div>
    <div class="cell-output" id="output-${cell.id}" aria-live="polite" aria-atomic="false"></div>`;
}

/**
 * 標準仕様で崩れやすい Markdown を補正してから marked で描画する。
 * Colab 等でよくある「# の直後に半角スペースが無い見出し」（例: ###算術演算子）
 * を見出しとして描画できるようにする。
 */
function renderMarkdown(src) {
  const { text, math } = protectMath(String(src == null ? '' : src));
  const html = marked.parse(preprocessMarkdown(text));
  // 数式を戻したあと、教材用の厳しめ DOMPurify（<style>等を禁止）で無害化してから表示する
  return sanitizeMarkdownHtml(restoreMath(html, math));
}

/**
 * HTML文字列を DOMPurify で無害化する（<script>・onerror等・javascript:URI を除去）。
 * 数式（$...$ / \begin{...}）はテキストとして保持され、data:画像・表・スタイルは残す。
 * DOMPurify 未ロード時は、安全側に倒してタグを全てエスケープする。
 */
/** DOMPurify に一度だけフックを登録：全リンクに rel=noopener を付与（タブナビ・中クリック対策の多層防御） */
let _dompurifyHooked = false;
function ensureDompurifyHooks() {
  if (_dompurifyHooked || !window.DOMPurify || typeof window.DOMPurify.addHook !== 'function') return;
  _dompurifyHooked = true;
  window.DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

/** 出力（DataFrame等の _repr_html_）用の無害化。pandas Styler の <style> は表整形に必要なため許容する。 */
function sanitizeHtml(html) {
  ensureDompurifyHooks();
  if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
    return window.DOMPurify.sanitize(html, {
      // data:URI の画像（スライド等）を確実に許可する
      ADD_DATA_URI_TAGS: ['img'],
      // 対象は表示用HTMLのみ。iframe等の埋め込みは許可しない
      FORBID_TAGS: ['iframe', 'object', 'embed', 'form'],
      // 教材が data-trusted を偽装して外部リンク確認を回避するのを防ぐ
      FORBID_ATTR: ['data-trusted'],
    });
  }
  // フォールバック：ライブラリが無ければタグを一切通さない
  return escHtml(html);
}

/**
 * 教材（信頼できない可能性のある Markdown）用の無害化。sanitizeHtml に加え、
 * <style> と style属性・svg/math/foreignObject を禁止する。
 * これらは「全画面を覆う偽ログイン等のフィッシングUI」や「CSSビーコンによる追跡」に
 * 悪用され得る（スクリプト無しでも成立）。DataFrame等の出力は sanitizeHtml 側を使う。
 */
function sanitizeMarkdownHtml(html) {
  ensureDompurifyHooks();
  if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
    return window.DOMPurify.sanitize(html, {
      ADD_DATA_URI_TAGS: ['img'],
      FORBID_TAGS: ['iframe', 'object', 'embed', 'form', 'style', 'svg', 'math', 'foreignObject'],
      FORBID_ATTR: ['data-trusted', 'style'],
    });
  }
  return escHtml(html);
}

/**
 * marked に渡す前に LaTeX 数式を退避（プレースホルダ化）する。
 * marked が `$a_1$` の `_` を装飾扱いにしたり `\\` を壊したりするのを防ぐ。
 * コード（```〜``` や `〜`）の中の $ は数式扱いしないよう、先にコードを退避する。
 * @returns {{text:string, math:string[]}}
 */
function protectMath(src) {
  let s = String(src);

  // 1) コード領域を一時退避（この中の $ は数式にしない）
  const code = [];
  const codeTok = (m) => { const i = code.length; code.push(m); return 'C' + i + ''; };
  s = s.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, codeTok); // フェンスコード
  s = s.replace(/`[^`\n]*`/g, codeTok);                     // インラインコード

  // 2) 数式を退避（順番が重要：環境・$$ → \[ \( → $）
  const math = [];
  const mathTok = (m) => { const i = math.length; math.push(m); return '@@MATH' + i + '@@'; };
  s = s.replace(/\\begin\{([a-zA-Z*]+)\}[\s\S]*?\\end\{\1\}/g, mathTok); // \begin{eqnarray}...\end{eqnarray}
  s = s.replace(/\$\$[\s\S]+?\$\$/g, mathTok);                           // $$...$$
  s = s.replace(/\\\[[\s\S]+?\\\]/g, mathTok);                           // \[...\]
  s = s.replace(/\\\([\s\S]+?\\\)/g, mathTok);                           // \(...\)
  // $...$（前後に空白がない場合のみ＝金額の誤検出を避ける）。
  // 後読み(?<!\s)は旧Safari等で構文エラーになるため、末尾を非空白クラス[^\s$]で表現する。
  s = s.replace(/\$(?!\s)(?:\\.|[^$\\])*?[^\s$]\$/g, mathTok);

  // 3) コード領域を元に戻す（marked に通常どおり処理させる）
  s = s.replace(/C(\d+)/g, (m, i) => code[+i]);

  return { text: s, math };
}

/** protectMath で退避した数式を、marked 処理後の HTML に戻す（HTMLエスケープしてMathJaxに渡す） */
function restoreMath(html, math) {
  return String(html).replace(/@@MATH(\d+)@@/g, (m, i) => {
    const tex = math[+i];
    return tex == null ? m : escHtml(tex);
  });
}

/** テキストセル内の LaTeX 数式を MathJax で組版する（読み込み前は何もしない） */
function typesetMath() {
  const mj = window.MathJax;
  if (!mj || !mj.typesetPromise) return;
  const nodes = document.querySelectorAll('#notebook-container .cell-text-display');
  if (!nodes.length) return;
  try { mj.typesetClear(nodes); } catch (e) { /* 初回は未組版なので無視 */ }
  mj.typesetPromise(Array.from(nodes)).catch(() => {});
}

/** marked に渡す前の Markdown 補正 */
function preprocessMarkdown(src) {
  if (!src) return src;
  // フェンスドコードブロック（``` / ~~~）の中は触らないように分割して処理する
  const parts = String(src).split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) continue; // コードブロックはそのまま
    // 行頭の # 1〜6個の直後に空白が無い場合に半角スペースを補う
    //   ###算術演算子 → ### 算術演算子
    parts[i] = parts[i].replace(/^(\s{0,3})(#{1,6})([^\s#])/gm, '$1$2 $3');
  }
  return parts.join('');
}

function buildTextContent(cell) {
  const hasContent = cell.content && cell.content.trim();
  const media = hasContent && isMediaOnlyMarkdown(cell.content);
  const rendered = hasContent
    ? renderMarkdown(cell.content)
    : '<p class="placeholder">「編集」ボタンかダブルクリック、または Enter キーで編集できます（Markdown対応）</p>';
  // 画像だけのセルはクリックで拡大表示、それ以外はダブルクリックで編集。
  // 誤って一度クリックしただけで編集モードに入るのを防ぐため、単クリックでは編集しない。
  const dispClass = media ? 'cell-text-display is-media' : 'cell-text-display';
  const kbHint    = media ? 'Enterキーで画像を拡大' : 'ダブルクリックまたはEnterキーで編集';
  const onEnter   = media ? `openTextImage(${cell.id})` : `startTextEdit(${cell.id})`;
  // 表示部に重ねるチップ（ホバー/フォーカスで出現）。
  // テキストセルのツールバーは非編集時は隠れているため、編集の入り口はこのチップに置く。
  // 画像だけのセルは中身が巨大なデータURIになりがちで、テキスト編集には向かないため付けない
  const editChip = media ? '' : `
      <button class="cell-edit-chip" title="このセルを編集" aria-label="このテキストセルを編集"
        onclick="event.stopPropagation();startTextEdit(${cell.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>編集</button>`;
  // 画像だけのセルは編集モードに入れないため、スライド変換の入り口もチップに置く。
  const toSlideChip = media ? `
      <button class="media-to-slide-chip" title="画像をスライドセルに変換"
        onclick="event.stopPropagation();changeCellType(${cell.id},'slide')">🎞 スライドに変換</button>` : '';
  const chips = `<div class="cell-chip-row">${editChip}${toSlideChip}</div>`;
  // tabindex/onkeydown でキーボードからも編集開始できるようにする。
  // 中のリンク等にフォーカスがある場合は誤発火しないよう currentTarget を確認。
  return `
    <div class="${dispClass}" id="text-disp-${cell.id}" tabindex="0" title="${kbHint}"
      ${media ? `onclick="openTextImage(${cell.id})"` : `ondblclick="startTextEdit(${cell.id})"`}
      onkeydown="if(event.key==='Enter'&&event.target===event.currentTarget){event.preventDefault();${onEnter};}">
      ${rendered}${chips}
    </div>
    <div class="cell-text-editor hidden" id="text-edit-${cell.id}">
      <textarea
        onblur="finishTextEdit(${cell.id})"
        onkeydown="onTextKeydown(event, ${cell.id})"
        oninput="autoGrowTextarea(this)"
      >${escHtml(cell.content)}</textarea>
      <div class="text-editor-hint">Shift+Enter または Esc で確定</div>
    </div>`;
}

/**
 * テキストセルの中身が「画像だけ」かどうかを判定する。
 * .ipynb に埋め込まれたスライド画像（![](data:...) や <img src="data:...">）を
 * いい感じに表示するために使う。
 */
function isMediaOnlyMarkdown(content) {
  if (!content) return false;
  const hasImage = /!\[(?:\\.|[^\]])*\]\([^)]+\)|<img[\s>]/i.test(content);
  if (!hasImage) return false;
  // 画像・装飾タグ・空白を取り除いて、文章が残らなければ「画像だけ」
  const stripped = content
    .replace(/!\[(?:\\.|[^\]])*\]\([^)]*\)/g, '')      // Markdown画像
    .replace(/<img[^>]*>/gi, '')               // <img>
    .replace(/<\/?(div|p|center|figure|br)[^>]*>/gi, '') // 装飾タグ
    .replace(/\s+/g, '');
  return stripped.length === 0;
}

/**
 * Markdown 内の画像ソース（URL / データURI）を出現順にすべて取り出す。
 * ![alt](src) と <img src="..."> の両方に対応。
 * .ipynb ⇔ 画像/スライドセルの相互変換（app.io.js・changeCellType）で使う。
 */
/** 画像の代替テキストを Markdown の alt スロット用にエスケープ（\ [ ] を退避）。Colab でも表示・往復できる。 */
function escapeMdAlt(alt) {
  return String(alt == null ? '' : alt).replace(/[\\\[\]]/g, '\\$&');
}
/** escapeMdAlt の逆（読み込み時に元へ戻す） */
function unescapeMdAlt(s) {
  return String(s == null ? '' : s).replace(/\\([\\\[\]])/g, '$1');
}

function extractImageSrcs(content) {
  const srcs = [];
  if (!content) return srcs;
  const re = /!\[(?:\\.|[^\]])*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)|<img[^>]*\ssrc=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    const src = m[1] || m[2];
    if (src) srcs.push(src);
  }
  return srcs;
}

/** テキストセル内の最初の画像をライトボックスで拡大表示する */
function openTextImage(id) {
  const cell = cells.find(c => c.id === id);
  if (!cell) return;
  let src = null;
  const md  = cell.content.match(/!\[(?:\\.|[^\]])*\]\(([^)]+)\)/);
  const tag = cell.content.match(/<img[^>]*\ssrc=["']([^"']+)["']/i);
  if (md)  src = md[1];
  else if (tag) src = tag[1];
  if (src) openImageLightbox(src);
}

function buildImageContent(cell) {
  if (cell.content) {
    return `
      <div class="cell-image-area">
        <div class="cell-image-display">
          <img src="${escHtml(cell.content)}" alt="${escHtml(cell.alt || '画像')}">
        </div>
        <input class="image-alt-input" type="text" value="${escHtml(cell.alt || '')}"
          placeholder="代替テキスト（画像の説明・スクリーンリーダー用／任意）"
          aria-label="画像の代替テキスト"
          oninput="setImageAlt(${cell.id}, this.value)">
        <button class="btn-icon btn-image-remove" onclick="clearImage(${cell.id})">
          ✕ 画像を削除
        </button>
      </div>`;
  }
  return `
    <div class="cell-image-area">
      <div class="image-drop-zone" id="drop-zone-${cell.id}"
        onclick="document.getElementById('img-input-${cell.id}').click()"
        ondragover="event.preventDefault(); this.classList.add('drag-over')"
        ondragleave="this.classList.remove('drag-over')"
        ondrop="onImageDrop(event, ${cell.id})">
        <div class="drop-icon">🖼</div>
        <p>クリックして画像を選択</p>
        <small>または ここにドラッグ&ドロップ（PNG, JPG, GIF, SVG）</small>
      </div>
      <input type="file" id="img-input-${cell.id}" accept="image/*" style="display:none"
        onchange="onImageSelect(event, ${cell.id})">
    </div>`;
}

function buildSlideContent(cell) {
  if (!cell.slides) cell.slides = [];
  if (cell.slides.length === 0) {
    return `
      <div class="slide-drop-zone" id="slide-drop-${cell.id}"
        onclick="document.getElementById('slide-input2-${cell.id}').click()"
        ondragover="event.preventDefault();this.classList.add('drag-over')"
        ondragleave="this.classList.remove('drag-over')"
        ondrop="onSlideDrop(event,${cell.id})">
        <div class="drop-icon">🎞</div>
        <p>クリックして画像を選択（複数可）</p>
        <small>または ここにドラッグ&ドロップ</small>
      </div>
      <input type="file" id="slide-input2-${cell.id}" accept="image/*" multiple style="display:none"
        onchange="onSlideSelect(event,${cell.id})">`;
  }

  const thumbs = cell.slides.map((src, i) => `
    <div class="slide-thumb-wrap" onclick="openSlide(${cell.id},${i})">
      <img src="${escHtml(src)}" alt="スライド${i+1}">
      <span class="slide-num">${i+1}</span>
      <button class="slide-thumb-del" onclick="event.stopPropagation();deleteSlide(${cell.id},${i})" title="削除">✕</button>
    </div>`).join('');

  return `
    <div class="slide-area">
      <div class="slide-strip">
        ${thumbs}
        <button class="slide-add-chip" onclick="document.getElementById('slide-input2-${cell.id}').click()">
          ＋<span>画像を追加</span>
        </button>
      </div>
    </div>
    <input type="file" id="slide-input2-${cell.id}" accept="image/*" multiple style="display:none"
      onchange="onSlideSelect(event,${cell.id})">`;
}

// ============================================================
// スライドセル管理
// ============================================================
function onSlideSelect(event, id) {
  const files = Array.from(event.target.files);
  if (!files.length) return;
  event.target.value = '';
  loadSlideFiles(id, files);
}

function onSlideDrop(event, id) {
  event.preventDefault();
  document.getElementById(`slide-drop-${id}`)?.classList.remove('drag-over');
  const files = Array.from(event.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  loadSlideFiles(id, files);
}

function loadSlideFiles(id, files) {
  const cell = cells.find(c => c.id === id);
  if (!cell) return;
  if (!cell.slides) cell.slides = [];
  // 選択した順序を保つため、読み込み結果はインデックス位置に格納してから push する
  const results = new Array(files.length);
  let remaining = files.length;
  const done = () => {
    if (--remaining !== 0) return;
    results.forEach((src) => { if (src) cell.slides.push(src); });
    markDirty();
    renderAll();
  };
  files.forEach((file, i) => {
    const reader = new FileReader();
    reader.onload = e => { results[i] = e.target.result; done(); };
    reader.onerror = () => { results[i] = null; done(); };  // 失敗してもカウンタを進める
    reader.readAsDataURL(file);
  });
}

function deleteSlide(cellId, idx) {
  const cell = cells.find(c => c.id === cellId);
  if (!cell) return;
  cell.slides.splice(idx, 1);
  markDirty();
  renderAll();
}

// ============================================================
// ライトボックス
// ============================================================
function openSlide(cellId, idx) {
  const cell = cells.find(c => c.id === cellId);
  if (!cell || !cell.slides.length) return;
  lbCellId = cellId;
  lbIdx    = idx;
  // スライドセル用：前後ボタンを表示
  const prev = document.querySelector('.lightbox-prev');
  const next = document.querySelector('.lightbox-next');
  if (prev) prev.style.display = '';
  if (next) next.style.display = '';
  updateLightbox();
  document.getElementById('slide-lightbox').classList.remove('hidden');
  document.addEventListener('keydown', onLightboxKey);
}

/** 単体画像（テキストセル内の画像など）をライトボックスで表示する */
function openImageLightbox(src) {
  lbCellId = null;
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox-counter').textContent = '';
  // 単体画像なので前後ボタンは隠す
  const prev = document.querySelector('.lightbox-prev');
  const next = document.querySelector('.lightbox-next');
  if (prev) prev.style.display = 'none';
  if (next) next.style.display = 'none';
  document.getElementById('slide-lightbox').classList.remove('hidden');
  document.addEventListener('keydown', onLightboxKey);
}

function updateLightbox() {
  const cell = cells.find(c => c.id === lbCellId);
  if (!cell) return;
  const total = cell.slides.length;
  document.getElementById('lightbox-img').src = cell.slides[lbIdx];
  document.getElementById('lightbox-counter').textContent = `${lbIdx + 1} / ${total}`;
  document.querySelector('.lightbox-prev').disabled = lbIdx === 0;
  document.querySelector('.lightbox-next').disabled = lbIdx === total - 1;
}

function lightboxNav(dir) {
  const cell = cells.find(c => c.id === lbCellId);
  if (!cell) return;
  lbIdx = Math.max(0, Math.min(cell.slides.length - 1, lbIdx + dir));
  updateLightbox();
}

function closeLightbox(event) {
  if (event && event.target !== document.getElementById('slide-lightbox')) return;
  document.getElementById('slide-lightbox').classList.add('hidden');
  document.getElementById('lightbox-img').src = '';
  document.removeEventListener('keydown', onLightboxKey);
  lbCellId = null;
}

function onLightboxKey(e) {
  if (e.key === 'Escape')      closeLightbox();
  if (e.key === 'ArrowLeft')   lightboxNav(-1);
  if (e.key === 'ArrowRight')  lightboxNav(1);
}

// ============================================================
// テキストセル編集
// ============================================================
function startTextEdit(id) {
  const disp = document.getElementById(`text-disp-${id}`);
  const edit = document.getElementById(`text-edit-${id}`);
  if (!disp || !edit) return;
  // 連続テキストセルで隠れているツールバーを編集中は表示する
  const cellEl = document.querySelector(`.cell[data-cell-id="${id}"]`);
  if (cellEl) cellEl.classList.add('editing');
  disp.classList.add('hidden');
  edit.classList.remove('hidden');
  const ta = edit.querySelector('textarea');
  if (ta) {
    autoGrowTextarea(ta);   // 内容の高さに合わせて広げる（縮み防止）
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
}

/** テキスト編集エリアを内容の高さに合わせて自動で広げる */
function autoGrowTextarea(ta) {
  if (!ta) return;
  // height を一旦 auto にすると、要素が縮んでページのスクロール位置が飛ぶことがある。
  // 前後でスクロール位置を保存・復元して、編集中に画面が勝手に下へ動くのを防ぐ。
  const scroller = document.scrollingElement || document.documentElement;
  const prev = scroller.scrollTop;
  ta.style.height = 'auto';
  ta.style.height = (ta.scrollHeight + 2) + 'px';
  scroller.scrollTop = prev;
}

function finishTextEdit(id) {
  const edit = document.getElementById(`text-edit-${id}`);
  const cell = cells.find(c => c.id === id);
  const ta = edit ? edit.querySelector('textarea') : null;
  if (cell && ta && cell.content !== ta.value) { cell.content = ta.value; markDirty(); }
  const cellEl = document.querySelector(`.cell[data-cell-id="${id}"]`);
  if (cellEl) cellEl.classList.remove('editing');
  // 見出しの追加・変更でセクション構成が変わりうるため、全体を再描画する
  renderAll();
}

function onTextKeydown(e, id) {
  if (e.key === 'Escape' || (e.key === 'Enter' && e.shiftKey)) {
    e.preventDefault();
    finishTextEdit(id);
  }
}

// ============================================================
// 画像セル
// ============================================================
function onImageSelect(event, id) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const cell = cells.find(c => c.id === id);
    if (cell) { cell.content = e.target.result; }
    markDirty();
    renderAll();
  };
  reader.readAsDataURL(file);
}

function onImageDrop(event, id) {
  event.preventDefault();
  document.getElementById(`drop-zone-${id}`)?.classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = e => {
    const cell = cells.find(c => c.id === id);
    if (cell) { cell.content = e.target.result; }
    markDirty();
    renderAll();
  };
  reader.readAsDataURL(file);
}

function clearImage(id) {
  const cell = cells.find(c => c.id === id);
  if (cell) { cell.content = ''; cell.alt = ''; }
  markDirty();
  renderAll();
}

/** 画像セルの代替テキスト（alt）を更新する。入力中は再描画せず、img の alt だけ即時反映する。 */
function setImageAlt(id, value) {
  const cell = cells.find(c => c.id === id);
  if (!cell) return;
  cell.alt = value;
  const img = document.querySelector(`.cell[data-cell-id="${id}"] .cell-image-display img`);
  if (img) img.alt = value || '画像';
  markDirty();
}

