'use strict';

// ============================================================
// .ipynb 読み込み / 書き出し
// ============================================================

/** ウェルカム画面の「ファイルを開く」ハンドラ */
function onIpynbUpload(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  _readAndLoadIpynb(file, true);
}

/** ヘッダーの「インポート」ボタンハンドラ */
async function onIpynbHeaderUpload(event) {
  const file = event.target.files[0];
  event.target.value = ''; // 同じファイルを再選択できるよう先にリセット
  if (!file) return;

  // 確認ダイアログを必ず表示
  const ok = await showModal({
    title: 'ノートブックを読み込みますか？',
    message: '「' + file.name + '」を読み込みます。\n' +
             '現在のノートブックの内容はすべて置き換わります。',
    okText: '読み込む',
    cancelText: 'キャンセル',
    danger: true,
  });
  if (!ok) return;

  _readAndLoadIpynb(file, false);
}

/**
 * .ipynb ファイルを FileReader で読み込み loadIpynb() に渡す
 * @param {File}    file          - 読み込む File オブジェクト
 * @param {boolean} fromWelcome   - true のときウェルカム画面を閉じる
 */
function _readAndLoadIpynb(file, fromWelcome) {
  // ファイルサイズが大きすぎる場合は読み込まない（ブラウザのフリーズ防止）
  if (file.size > MAX_IPYNB_BYTES) {
    showSizeLimitError('size');
    return;
  }
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const json = JSON.parse(e.target.result);
      // セル数が多すぎる場合も読み込まない
      const problem = ipynbSizeProblem(json, null);
      if (problem) { showSizeLimitError(problem); return; }
      if (fromWelcome) dismissWelcomeScreen();
      loadIpynb(json);
      // ファイル名をタイトルに反映
      const name = file.name.replace(/\.ipynb$/i, '');
      document.title = name + ' - PyHiroba';
      const h1 = document.querySelector('#app-header h1');
      if (h1) h1.textContent = name;
    } catch (err) {
      showModal({
        title: '読み込めませんでした',
        message: '.ipynb ファイルの読み込みに失敗しました。\nファイルが壊れているか、形式が正しくない可能性があります。',
        okText: '閉じる', cancelText: null,
      });
    }
  };
  reader.onerror = function () {
    showModal({
      title: '読み込めませんでした',
      message: 'ファイルの読み込み中にエラーが発生しました。',
      okText: '閉じる', cancelText: null,
    });
  };
  reader.readAsText(file, 'UTF-8');
}

/** .ipynb JSON をセルにロード（既存セルは全て置き換え） */
function loadIpynb(json) {
  // 状態をリセット
  cells   = [];
  editors = {};
  outputs = {};
  nextId  = 0;

  const ipynbCells = json.cells || [];
  ipynbCells.forEach(c => {
    const src = Array.isArray(c.source) ? c.source.join('') : (c.source || '');
    // PyHiroba独自メタデータ（折りたたみ状態・セル種別）を読み込む
    const pyMeta = (c.metadata && c.metadata.pyhiroba) || {};
    const collapsed = !!pyMeta.collapsed;
    if (c.cell_type === 'code') {
      cells.push({ id: nextId++, type: 'code', content: src, slides: [], collapsed });
    } else if (c.cell_type === 'markdown') {
      cells.push(markdownToCell(src, pyMeta.cellType, collapsed));
    }
    // raw セルはスキップ
  });

  // セルが0個の場合は空セルを追加
  if (cells.length === 0) {
    cells.push({ id: nextId++, type: 'code', content: '', slides: [] });
  }

  renderAll();
  // 読み込み直後は未保存ではない
  isDirty = false;
  // 読み込んだノートブックは一番上から表示する
  window.scrollTo(0, 0);
}

/**
 * .ipynb の markdown セルを PyHiroba のセルに変換する。
 * PyHiroba が書き出した画像/スライドセルは metadata.pyhiroba.cellType を手がかりに
 * 元の種別へ復元する。ただし Colab 等で本文が書き足されていた場合は、
 * 内容を失わないようテキストセルのまま読み込む（安全側）。
 */
function markdownToCell(src, cellType, collapsed) {
  if (cellType === 'image' || cellType === 'slide') {
    const mediaOnly = !src.trim() || isMediaOnlyMarkdown(src);
    if (mediaOnly) {
      const srcs = extractImageSrcs(src);
      if (cellType === 'image') {
        return { id: nextId++, type: 'image', content: srcs[0] || '', slides: [], collapsed };
      }
      return { id: nextId++, type: 'slide', content: '', slides: srcs, collapsed };
    }
  }
  return { id: nextId++, type: 'text', content: src, slides: [], collapsed };
}

// ============================================================
// Google Drive / Colab の公開ノートブック読み込み
// ============================================================
// Drive API 専用・PyHirobaドメイン限定に制限した公開用APIキー。
// 公開ファイル（リンクを知っている全員：閲覧者）の読み取りのみ可能で、
// 非公開ファイルやアカウント情報には一切アクセスできない。
const GDRIVE_API_KEY = 'AIzaSyBcOmDs7KqQzbp5MbK3wps6AgHHp6FDYMA';

/** Colab / Drive のリンクから Drive ファイルID を取り出す（なければ null） */
function extractDriveId(url) {
  if (!url) return null;
  const s = String(url).trim();
  const patterns = [
    /colab\.research\.google\.com\/drive\/([a-zA-Z0-9_-]{20,})/,
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{20,})/,
    /docs\.google\.com\/[^/]+\/d\/([a-zA-Z0-9_-]{20,})/,
    /(?:drive|colab)\.google\.com\/[^]*?[?&]id=([a-zA-Z0-9_-]{20,})/,
    /[?&]id=([a-zA-Z0-9_-]{20,})/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  // URL ではなく、ファイルID だけが貼られた場合
  if (/^[a-zA-Z0-9_-]{25,}$/.test(s)) return s;
  return null;
}

/** Drive のファイルID から公開ノートブックの JSON とファイル名を取得する */
async function fetchDriveIpynb(fileId) {
  const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
  const res = await fetch(`${base}?alt=media&key=${GDRIVE_API_KEY}`);
  if (res.status === 404) throw new Error('GD_404');
  if (res.status === 401 || res.status === 403) throw new Error('GD_403');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_IPYNB_BYTES) throw new Error('NB_TOO_BIG');
  const json = JSON.parse(text);
  if (ipynbSizeProblem(json, text.length)) throw new Error('NB_TOO_BIG');

  // ファイル名も取得（失敗しても致命的ではない）
  let name = '';
  try {
    const meta = await fetch(`${base}?fields=name&key=${GDRIVE_API_KEY}`);
    if (meta.ok) {
      const m = await meta.json();
      name = (m.name || '').replace(/\.ipynb$/i, '');
    }
  } catch (_) { /* 名前が取れなくても続行 */ }

  return { json, name };
}

/** URL 入力欄からロード */
async function loadFromUrlInput() {
  const input = document.getElementById('nb-url-input');
  const url = (input && input.value.trim()) || '';
  if (!url) return;
  await loadFromUrl(url);
}

/**
 * 直前のページが PyHiroba の「公開教材ページ」かどうか。
 * ここからの ?gdrive= / ?nb= 読み込みだけを信頼扱いにする。
 * ※ 単なる同一オリジン判定にすると、悪意ある教材内リンク（同一オリジンreferrerになる）から
 *   警告なしで連鎖的に外部教材を読み込めてしまうため、公開教材ページに限定する。
 */
function referrerIsMaterialsPage() {
  try {
    if (!document.referrer) return false;
    const r = new URL(document.referrer);
    return r.origin === location.origin && /\/lp\/materials\.html$/.test(r.pathname);
  } catch (_) {
    return false;
  }
}

/**
 * URL（または Drive ファイルID）から .ipynb をフェッチしてロードする。
 * ?nb= / ?gdrive= パラメータ経由でも使用。
 * Colab / Google Drive の公開リンク、GitHub の URL に対応。
 * @param {Object} opts { trusted } trusted:true のとき「外部から読み込んだ」注意を出さない
 */
async function loadFromUrl(rawUrl, opts = {}) {
  const btn = document.querySelector('.picker-url-row button');
  if (btn) { btn.textContent = '読込中...'; btn.disabled = true; }

  try {
    let json, nameHint = '';

    const driveId = extractDriveId(rawUrl);
    if (driveId) {
      // Google Drive / Colab の公開ノートブック
      const r = await fetchDriveIpynb(driveId);
      json = r.json;
      nameHint = r.name;
    } else {
      // GitHub のブラウザ URL を raw URL に変換してから取得
      let url = rawUrl;
      const ghMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
      if (ghMatch) {
        url = `https://raw.githubusercontent.com/${ghMatch[1]}/${ghMatch[2]}/${ghMatch[3]}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_IPYNB_BYTES) throw new Error('NB_TOO_BIG');
      json = JSON.parse(text);
      if (ipynbSizeProblem(json, text.length)) throw new Error('NB_TOO_BIG');
      nameHint = url.split('/').pop().replace(/\.ipynb$/i, '');
    }

    dismissWelcomeScreen();
    loadIpynb(json);

    // ファイル名をタイトルに反映
    const name = (nameHint || '').replace(/\.ipynb$/i, '');
    if (name) {
      document.title = name + ' - PyHiroba';
      const h1 = document.querySelector('#app-header h1');
      if (h1) h1.textContent = name;
    }

    // 外部から読み込んだ教材であることの注意喚起。
    // 公開教材ページなど PyHiroba 自身から開いた場合（trusted）は出さない。
    if (!opts.trusted) {
      await showModal({
        title: '外部から読み込んだ教材です',
        message: 'これは外部から読み込んだ教材です。\n' +
                 'PyHiroba公式の教材、先生や学校からの共有など、\n' +
                 '信頼できる教材であることを確認してください。',
        okText: '確認',
        cancelText: null,
      });
    }
  } catch (err) {
    let msg;
    if (err.message === 'NB_TOO_BIG') {
      const mb = Math.round(MAX_IPYNB_BYTES / (1024 * 1024));
      msg = 'ノートブックが大きすぎるため読み込めませんでした。\n\n' +
            `・ファイルサイズは ${mb}MB 以下、セル数は ${MAX_IPYNB_CELLS} 個以下にしてください\n` +
            '・埋め込み画像を減らすか、ノートブックを分割してお試しください';
    } else if (err.message === 'GD_404') {
      msg = 'ファイルが見つからないか、公開されていません。\n\n' +
            '・リンクが正しいか確認してください\n' +
            '・Google Drive / Colab で「共有」→「リンクを知っている全員（閲覧者）」に\n' +
            '　設定されているか確認してください';
    } else if (err.message === 'GD_403') {
      msg = 'このファイルにアクセスできませんでした。\n\n' +
            '・ファイルが「リンクを知っている全員（閲覧者）」で共有されているか\n' +
            '　確認してください\n' +
            '・しばらく待ってから再度お試しください';
    } else {
      msg = 'ノートブックの読み込みに失敗しました。\n' +
            'URLが正しいか確認してください。\n' +
            '（GitHubは raw URL、Google Drive / Colab は公開リンクをご利用ください）\n\n' +
            'エラー: ' + err.message;
    }
    await showModal({ title: '読み込めませんでした', message: msg, okText: '閉じる', cancelText: null });
  } finally {
    if (btn) { btn.textContent = '開く'; btn.disabled = false; }
  }
}

/**
 * 画像/スライドセルの中身を Markdown（データURI画像）として文字列化する。
 * Colab / Jupyter で開いても画像がそのまま表示される形式にする。
 * テキスト・コードセルは content をそのまま返す。
 */
function mediaCellToMarkdown(cell) {
  if (cell.type === 'image') {
    return cell.content ? `![画像](${cell.content})` : '';
  }
  if (cell.type === 'slide') {
    return (cell.slides || []).map((src, i) => `![スライド${i + 1}](${src})`).join('\n\n');
  }
  return cell.content || '';
}

/** 現在のノートブックを .ipynb 形式の JSON オブジェクトに変換する */
function buildIpynbJson() {
  saveAllEditors();

  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3'
      },
      language_info: {
        name: 'python',
        version: '3.11.0'
      }
    },
    cells: cells.map((cell, idx) => {
      // 折りたたみ状態・セル種別（画像/スライド）を独自メタデータに保存
      const pyMeta = {};
      if (cell.collapsed) pyMeta.collapsed = true;
      if (cell.type === 'image' || cell.type === 'slide') pyMeta.cellType = cell.type;
      const metadata = Object.keys(pyMeta).length ? { pyhiroba: pyMeta } : {};
      if (cell.type === 'code') {
        return {
          cell_type: 'code',
          execution_count: null,
          id: `cell-${idx}`,
          metadata,
          outputs: [],
          source: toIpynbSource(cell.content || '')
        };
      } else {
        // text / image / slide → markdown として出力（画像はデータURIのMarkdown画像に変換）
        return {
          cell_type: 'markdown',
          id: `cell-${idx}`,
          metadata,
          source: toIpynbSource(mediaCellToMarkdown(cell))
        };
      }
    })
  };
}

/** 現在のノートブックを .ipynb としてダウンロード */
function downloadIpynb() {
  const nb = buildIpynbJson();

  const blob = new Blob([JSON.stringify(nb, null, 2)], { type: 'application/json' });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  // タイトルからファイル名を生成
  const titleMatch = document.title.match(/^(.+?) - /);
  const filename = titleMatch
    ? titleMatch[1].replace(/[^\w\-_ ]/g, '_') + '.ipynb'
    : 'notebook.ipynb';
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);

  // ダウンロードしたので「未保存」状態を解除する
  isDirty = false;

  // 読み込み上限（8MB）を超えるファイルは PyHiroba で開き直せないため注意を出す
  // （画像・スライドをたくさん埋め込むと超えることがある）
  if (blob.size > MAX_IPYNB_BYTES) {
    const mb = Math.round(MAX_IPYNB_BYTES / (1024 * 1024));
    showModal({
      title: '保存しました（サイズに注意）',
      message: `保存した .ipynb が ${mb}MB を超えています。\n` +
               'このままでは PyHiroba で開き直すことができません。\n' +
               '画像・スライドの枚数を減らすか、ノートブックを分割してください。',
      okText: '閉じる',
      cancelText: null,
    });
  }
}

/** content 文字列を .ipynb の source 配列形式に変換 */
function toIpynbSource(content) {
  if (!content) return [];
  const lines = content.split('\n');
  // 各行末に \n を付与（最後の行を除く）
  return lines.map((line, i) => i < lines.length - 1 ? line + '\n' : line);
}

