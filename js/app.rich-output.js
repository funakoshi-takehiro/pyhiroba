'use strict';

// ============================================================
// Rich Output 基盤
// ============================================================

const richOutputRenderers = Object.create(null);
const richOutputSessions = new Map();
const richOutputCellSessions = new Map();
const richOutputFrameSessions = new Map();
const richSnapshotRequests = new Map();
let richOutputSessionCounter = 0;
let richSnapshotRequestCounter = 0;

const RICH_FRAME_CHANNEL = 'pyhiroba-rich-output-v1';
const RICH_PATCH_MAX_BYTES = 512 * 1024;
const RICH_MESSAGE_MAX_BYTES = 768 * 1024;
const RICH_PENDING_PATCH_MAX_COUNT = 32;
const RICH_SNAPSHOT_TIMEOUT_MS = 15000;
const RICH_FRAME_MIN_HEIGHT = 40;
const RICH_FRAME_MAX_HEIGHT = 4000;

function registerRichOutputRenderer(mimeType, renderer) {
  richOutputRenderers[mimeType] = renderer;
}

function getRichOutputRenderer(mimeType) {
  return richOutputRenderers[mimeType] || null;
}

function escapeHtmlFallback(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeRichOutputData(data) {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch (_) {
      return data;
    }
  }
  return data;
}

function estimatePayloadBytes(value, seen) {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length * 2;
  if (typeof value === 'number' || typeof value === 'boolean') return 8;
  if (typeof value === 'bigint') return String(value).length;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof value !== 'object') return 0;

  const visited = seen || new WeakSet();
  if (visited.has(value)) return RICH_MESSAGE_MAX_BYTES + 1;
  visited.add(value);

  let total = 0;
  if (value instanceof Map) {
    for (const [key, val] of value.entries()) {
      total += estimatePayloadBytes(String(key), visited) + estimatePayloadBytes(val, visited);
      if (total > RICH_MESSAGE_MAX_BYTES) return total;
    }
    return total;
  }
  if (value instanceof Set) {
    for (const item of value.values()) {
      total += estimatePayloadBytes(item, visited);
      if (total > RICH_MESSAGE_MAX_BYTES) return total;
    }
    return total;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      total += estimatePayloadBytes(item, visited);
      if (total > RICH_MESSAGE_MAX_BYTES) return total;
    }
    return total;
  }
  for (const key of Object.keys(value)) {
    total += key.length * 2 + estimatePayloadBytes(value[key], visited);
    if (total > RICH_MESSAGE_MAX_BYTES) return total;
  }
  return total;
}

function isObjectPayload(value) {
  return value != null && typeof value === 'object';
}

function isValidRichPatchPayload(patch, buffers) {
  if (!isObjectPayload(patch)) return false;
  if (buffers != null && !isObjectPayload(buffers)) return false;
  return estimatePayloadBytes({ patch, buffers }) <= RICH_PATCH_MAX_BYTES;
}

function makeRichFrameToken() {
  const bytes = new Uint8Array(16);
  if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return String(Date.now()) + '-' + Math.random().toString(36).slice(2);
}

function rememberRichSession(cellId, session) {
  richOutputSessions.set(session.sessionId, session);
  if (!richOutputCellSessions.has(cellId)) {
    richOutputCellSessions.set(cellId, []);
  }
  const sessionIds = richOutputCellSessions.get(cellId);
  if (!sessionIds.includes(session.sessionId)) sessionIds.push(session.sessionId);
}

function forgetRichSession(session) {
  if (!session) return;
  const sessionIds = richOutputCellSessions.get(session.cellId);
  if (sessionIds) {
    const kept = sessionIds.filter((sessionId) => sessionId !== session.sessionId);
    if (kept.length) richOutputCellSessions.set(session.cellId, kept);
    else richOutputCellSessions.delete(session.cellId);
  }
  richOutputSessions.delete(session.sessionId);
}

function postToRichFrame(session, type, payload) {
  if (!session || session.disposed || !session.frameWindow) return false;
  if (type === 'patch' && !session.rendered) return false;
  if (type === 'render' && !session.frameReady) return false;
  session.frameWindow.postMessage({
    channel: RICH_FRAME_CHANNEL,
    type,
    token: session.token,
    ...(payload || {}),
  }, '*');
  return true;
}

function failRichSessionView(session, message) {
  if (!session || session.disposed) return;
  const container = session.container;
  detachRichSessionView(session);
  if (container) {
    container.innerHTML = `<div class="output-rich-error">${escapeHtmlFallback(message)}</div>`;
  }
}

function disposeRichSession(session, message) {
  if (!session || session.disposed) return;
  const container = session.container;
  detachRichSessionView(session);
  session.disposed = true;
  session.pendingPatches = [];
  session.pendingPatchOverflow = false;
  session.snapshotRequesting = false;
  if (pyWorker) pyWorker.postMessage({ type: 'rich-dispose', sessionId: session.sessionId });
  if (container) {
    container.innerHTML = message
      ? `<div class="output-rich-disconnected">${escapeHtmlFallback(message)}</div>`
      : '';
  }
  forgetRichSession(session);
}

function detachRichSessionView(session) {
  if (!session || session.disposed) return;
  postToRichFrame(session, 'dispose');
  if (session.loadTimer) {
    clearTimeout(session.loadTimer);
    session.loadTimer = null;
  }
  if (session.frameWindow) richOutputFrameSessions.delete(session.frameWindow);
  session.iframe = null;
  session.frameWindow = null;
  session.container = null;
  session.frameReady = false;
  session.renderSent = false;
  session.rendered = false;
}

function detachRichOutputCellViews(cellId) {
  const sessionIds = Array.from(new Set(richOutputCellSessions.get(cellId) || []));
  sessionIds.forEach((sessionId) => {
    detachRichSessionView(richOutputSessions.get(sessionId));
  });
}

function detachAllRichOutputViews() {
  for (const session of Array.from(richOutputSessions.values())) {
    detachRichSessionView(session);
  }
}

function cleanupRichOutputCell(cellId, message) {
  const sessionIds = Array.from(new Set(richOutputCellSessions.get(cellId) || []));
  sessionIds.forEach((sessionId) => {
    disposeRichSession(richOutputSessions.get(sessionId), message);
  });
  richOutputCellSessions.delete(cellId);
}

function cleanupAllRichOutputs(message) {
  for (const cellId of Array.from(richOutputCellSessions.keys())) {
    cleanupRichOutputCell(cellId, message);
  }
}

function sendRichPatchToWorker(session, patch, buffers) {
  if (!pyWorker || !session || session.disposed || !session.rendered) return;
  if (!isValidRichPatchPayload(patch, buffers)) return;
  pyWorker.postMessage({
    type: 'rich-patch',
    sessionId: session.sessionId,
    patch,
    buffers: buffers || null,
  });
}

function applyRichPatchFromWorker(msg) {
  const session = richOutputSessions.get(msg && msg.sessionId);
  if (!session || session.disposed) return;
  if (!isValidRichPatchPayload(msg.patch, msg.buffers)) return;
  if (!session.rendered) {
    if (session.snapshotRequesting) return;
    if (!Array.isArray(session.pendingPatches)) session.pendingPatches = [];
    if (session.pendingPatches.length >= RICH_PENDING_PATCH_MAX_COUNT) {
      session.pendingPatches = [];
      session.pendingPatchOverflow = true;
      return;
    }
    session.pendingPatches.push({ patch: msg.patch, buffers: msg.buffers || null });
    return;
  }
  postToRichFrame(session, 'patch', {
    patch: msg.patch,
    buffers: msg.buffers || null,
  });
}

function requestRichSessionSnapshot(session) {
  if (!pyWorker || !session || session.disposed) {
    return Promise.reject(new Error('リッチ出力の現在状態を取得できませんでした。'));
  }
  const requestId = 'rich-snapshot-' + (++richSnapshotRequestCounter);
  session.snapshotRequesting = true;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      richSnapshotRequests.delete(requestId);
      if (session.snapshotRequesting) session.snapshotRequesting = false;
      reject(new Error('リッチ出力の現在状態の取得がタイムアウトしました。'));
    }, RICH_SNAPSHOT_TIMEOUT_MS);
    richSnapshotRequests.set(requestId, {
      sessionId: session.sessionId,
      resolve,
      reject,
      timer,
    });
    pyWorker.postMessage({
      type: 'rich-snapshot-request',
      requestId,
      sessionId: session.sessionId,
    });
  });
}

function applyRichSnapshotFromWorker(msg) {
  const pending = richSnapshotRequests.get(msg && msg.requestId);
  if (!pending || pending.sessionId !== msg.sessionId) return;
  richSnapshotRequests.delete(msg.requestId);
  if (pending.timer) clearTimeout(pending.timer);
  const session = richOutputSessions.get(pending.sessionId);
  if (session) session.snapshotRequesting = false;
  if (!msg.ok) {
    pending.reject(new Error(String(msg.error || 'リッチ出力の現在状態を取得できませんでした。')));
    return;
  }
  pending.resolve(normalizeRichOutputData(msg.data));
}

function flushPendingRichPatches(session) {
  if (!session || !session.rendered || !Array.isArray(session.pendingPatches) || !session.pendingPatches.length) return;
  const patches = session.pendingPatches.splice(0);
  patches.forEach((item) => {
    postToRichFrame(session, 'patch', {
      patch: item.patch,
      buffers: item.buffers || null,
    });
  });
}

async function resyncRichSessionView(session) {
  if (!session || session.disposed || !session.container) return;
  const container = session.container;
  try {
    container.innerHTML = '<div class="output-rich-loading">リッチ出力を同期しています...</div>';
    const snapshot = await requestRichSessionSnapshot(session);
    if (session.disposed || session.container !== container) return;
    session.pendingPatches = [];
    session.pendingPatchOverflow = false;
    session.renderData = normalizeRichOutputData(snapshot);
    attachRichFrame(session, container, false);
  } catch (err) {
    if (!session.disposed && session.container === container) {
      failRichSessionView(session, (err && err.message) || err || 'リッチ出力の再同期に失敗しました。');
    }
  }
}

function handleRichFrameMessage(event) {
  const sessionId = richOutputFrameSessions.get(event.source);
  if (!sessionId) return;
  const session = richOutputSessions.get(sessionId);
  if (!session || session.disposed || event.source !== session.frameWindow) return;

  const msg = event.data || {};
  if (!msg || msg.channel !== RICH_FRAME_CHANNEL || typeof msg.type !== 'string') return;
  if (!['ready', 'rich-patch', 'resize', 'error'].includes(msg.type)) return;
  if (estimatePayloadBytes(msg) > RICH_MESSAGE_MAX_BYTES) return;

  if (msg.type === 'ready' && msg.state === 'frame') {
    if (session.frameReady || session.renderSent) return;
    session.frameReady = true;
    if (session.loadTimer) {
      clearTimeout(session.loadTimer);
      session.loadTimer = null;
    }
    session.renderSent = postToRichFrame(session, 'render', { data: session.renderData });
    return;
  }

  if (msg.token !== session.token) return;

  if (msg.type === 'ready' && msg.state === 'rendered') {
    if (!session.renderSent || session.rendered) return;
    session.rendered = true;
    if (session.pendingPatchOverflow) {
      session.pendingPatchOverflow = false;
      session.pendingPatches = [];
      void resyncRichSessionView(session);
      return;
    }
    flushPendingRichPatches(session);
    if (pyWorker) pyWorker.postMessage({ type: 'rich-rendered', sessionId: session.sessionId });
    return;
  }

  if (msg.type === 'rich-patch') {
    sendRichPatchToWorker(session, msg.patch, msg.buffers || null);
    return;
  }

  if (msg.type === 'resize') {
    const nextHeight = Number(msg.height);
    if (!Number.isFinite(nextHeight)) return;
    const clamped = Math.max(RICH_FRAME_MIN_HEIGHT, Math.min(RICH_FRAME_MAX_HEIGHT, Math.ceil(nextHeight)));
    if (session.iframe) session.iframe.style.height = clamped + 'px';
    return;
  }

  if (msg.type === 'error') {
    const text = String(msg.message || 'リッチ出力の表示に失敗しました。').slice(0, 500);
    console.warn('Rich output iframe error:', text);
    if (session.loadTimer) {
      clearTimeout(session.loadTimer);
      session.loadTimer = null;
    }
    if (!session.rendered && session.container) {
      if (session.viewFailureFullDispose) disposeRichSession(session, text);
      else failRichSessionView(session, text);
    }
  }
}

window.addEventListener('message', handleRichFrameMessage);

async function renderRichOutputs(cellId, richOutputs) {
  if (!Array.isArray(richOutputs) || !richOutputs.length) return;
  const cellOutput = document.getElementById(`output-${cellId}`);
  if (!cellOutput) return;

  detachRichOutputCellViews(cellId);
  const existing = cellOutput.querySelectorAll('[data-rich-output-session-id]');
  existing.forEach((node) => node.remove());

  for (let index = 0; index < richOutputs.length; index += 1) {
    const richOutput = richOutputs[index];
    const renderer = getRichOutputRenderer(richOutput.mimeType);
    if (!renderer) continue;

    const slot = document.createElement('div');
    slot.className = 'output-rich';
    slot.innerHTML = '<div class="output-rich-loading">リッチ出力を準備しています...</div>';
    cellOutput.appendChild(slot);
    try {
      await renderer({
        cellId,
        index,
        output: richOutput,
        container: slot,
      });
    } catch (err) {
      console.error(err);
      slot.innerHTML = `<div class="output-rich-error">リッチ出力の表示に失敗しました。<br><small>${escapeHtmlFallback((err && err.message) || err)}</small></div>`;
    }
  }
}

function createRichFrameSrcdoc() {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
    "style-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.holoviz.org",
    "img-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "worker-src 'none'",
  ].join('; ');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <style>
    html, body { margin: 0; padding: 0; background: transparent; color: inherit; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    #root { box-sizing: border-box; min-height: 1px; overflow: visible; }
    .bk-root, .output-rich-bokeh-root { max-width: 100%; }
    .rich-error { color: #b42318; font: 13px/1.5 system-ui, sans-serif; padding: 8px 0; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/@bokeh/bokehjs@3.6.3/build/js/bokeh.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@bokeh/bokehjs@3.6.3/build/js/bokeh-widgets.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@bokeh/bokehjs@3.6.3/build/js/bokeh-tables.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@holoviz/panel@1.5.5/dist/panel.min.js"></script>
</head>
<body>
  <div id="root"></div>
  <script>
(function () {
  'use strict';

  const CHANNEL = 'pyhiroba-rich-output-v1';
  const MAX_PATCH_BYTES = 512 * 1024;
  const root = document.getElementById('root');
  let token = null;
  let jsdoc = null;
  let disposed = false;
  let rendered = false;
  let patching = 0;
  let resizeQueued = false;

  function estimatePayloadBytes(value, seen) {
    if (value == null) return 0;
    if (typeof value === 'string') return value.length * 2;
    if (typeof value === 'number' || typeof value === 'boolean') return 8;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    if (typeof value !== 'object') return 0;
    const visited = seen || new WeakSet();
    if (visited.has(value)) return MAX_PATCH_BYTES + 1;
    visited.add(value);
    let total = 0;
    if (Array.isArray(value)) {
      for (const item of value) {
        total += estimatePayloadBytes(item, visited);
        if (total > MAX_PATCH_BYTES) return total;
      }
      return total;
    }
    for (const key of Object.keys(value)) {
      total += key.length * 2 + estimatePayloadBytes(value[key], visited);
      if (total > MAX_PATCH_BYTES) return total;
    }
    return total;
  }

  function post(type, payload, includeToken) {
    const msg = Object.assign({ channel: CHANNEL, type }, payload || {});
    if (includeToken && token) msg.token = token;
    window.parent.postMessage(msg, '*');
  }

  function postError(err) {
    const message = String((err && err.message) || err || 'リッチ出力の表示に失敗しました。');
    if (root) root.innerHTML = '<div class="rich-error"></div>';
    const box = root && root.querySelector('.rich-error');
    if (box) box.textContent = message;
    post('error', { message: message.slice(0, 500) }, !!token);
    queueResize();
  }

  function normalizeData(data) {
    if (typeof data === 'string') {
      try { return JSON.parse(data); } catch (_) { return data; }
    }
    return data;
  }

  function normalizeRenderItems(renderItems) {
    const items = normalizeData(renderItems);
    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  }

  function makeBokehTarget(id) {
    const div = document.createElement('div');
    if (id) div.id = String(id);
    div.className = 'bk-root output-rich-bokeh-root';
    root.appendChild(div);
    return div;
  }

  function prepareBokehRenderItems(renderItems, rootIds) {
    return normalizeRenderItems(renderItems).map((item, itemIndex) => {
      const next = Object.assign({}, item);
      const roots = next.roots && typeof next.roots === 'object' ? Object.assign({}, next.roots) : null;

      if (roots) {
        Object.keys(roots).forEach((rootId, rootIndex) => {
          const target = roots[rootId];
          if (typeof target === 'string') {
            makeBokehTarget(target);
          } else if (!target) {
            roots[rootId] = makeBokehTarget('rich-root-' + itemIndex + '-' + rootIndex);
          }
        });
        next.roots = roots;
        return next;
      }

      if (next.elementid) {
        makeBokehTarget(next.elementid);
        return next;
      }

      const ids = Array.isArray(next.root_ids) && next.root_ids.length ? next.root_ids : rootIds;
      next.roots = {};
      ids.forEach((rootId, rootIndex) => {
        next.roots[rootId] = makeBokehTarget('rich-root-' + itemIndex + '-' + rootIndex);
      });
      return next;
    });
  }

  function findBokehDocument(embedResult, rootIds) {
    const first = Array.isArray(embedResult) ? embedResult[0] : embedResult;
    const roots = first && first.roots ? Array.from(first.roots.values()) : [];
    const rootView = roots.find((view) => view && view.model && view.model.document);
    if (rootView) return rootView.model.document;
    if (window.Bokeh && window.Bokeh.index && Array.isArray(rootIds)) {
      for (const rootId of rootIds) {
        const view = window.Bokeh.index[rootId];
        if (view && view.model && view.model.document) return view.model.document;
      }
    }
    return null;
  }

  function queueResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      const rect = document.documentElement.getBoundingClientRect();
      const height = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        rect.height,
        root ? root.scrollHeight : 0
      );
      post('resize', { height }, !!token);
    });
  }

  async function render(data) {
    if (rendered || disposed) return;
    if (!window.Bokeh || !window.Bokeh.embed || typeof window.Bokeh.embed.embed_items !== 'function') {
      throw new Error('BokehJSを読み込めませんでした。');
    }

    const payload = normalizeData(data || {});
    const docsJson = normalizeData(payload.docs_json || payload.docsJson || payload.docs);
    const renderItems = normalizeRenderItems(payload.render_items || payload.renderItems);
    const rootIds = normalizeData(payload.root_ids || payload.rootIds || []);

    root.innerHTML = '';
    const preparedRenderItems = prepareBokehRenderItems(renderItems, rootIds);
    const embedResult = await window.Bokeh.embed.embed_items(docsJson, preparedRenderItems);
    if (disposed) return;

    jsdoc = findBokehDocument(embedResult, rootIds);
    if (!jsdoc) throw new Error('Bokeh document syncを開始できませんでした。');

    jsdoc.on_change((event) => {
      if (disposed || patching > 0 || !event) return;
      if (event.setter_id != null && event.setter_id === 'py') return;
      if (typeof jsdoc.create_json_patch !== 'function') return;
      const patch = jsdoc.create_json_patch([event]);
      if (estimatePayloadBytes(patch) > MAX_PATCH_BYTES) return;
      post('rich-patch', { patch, buffers: null }, true);
    }, false);

    rendered = true;
    post('ready', { state: 'rendered' }, true);
    queueResize();
  }

  function applyPatch(patch, buffers) {
    if (disposed || !rendered || !jsdoc || !patch || typeof patch !== 'object') return;
    if (estimatePayloadBytes({ patch, buffers }) > MAX_PATCH_BYTES) return;
    try {
      patching += 1;
      const bufferMap = buffers && typeof buffers === 'object' ? new Map(Object.entries(buffers)) : null;
      if (bufferMap) jsdoc.apply_json_patch(patch, bufferMap);
      else jsdoc.apply_json_patch(patch);
    } finally {
      patching = Math.max(0, patching - 1);
      queueResize();
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const msg = event.data || {};
    if (!msg || msg.channel !== CHANNEL || typeof msg.type !== 'string') return;

    if (msg.type === 'render') {
      token = String(msg.token || '');
      render(msg.data).catch(postError);
      return;
    }

    if (!token || msg.token !== token) return;

    if (msg.type === 'patch') {
      applyPatch(msg.patch, msg.buffers || null);
    } else if (msg.type === 'dispose') {
      disposed = true;
      if (root) root.innerHTML = '';
    }
  });

  if (window.ResizeObserver && root) {
    new ResizeObserver(queueResize).observe(root);
  }
  window.addEventListener('load', queueResize);
  post('ready', { state: 'frame' }, false);
})();
  </script>
</body>
</html>`;
}

function attachRichFrame(session, container, fullDisposeOnFailure) {
  detachRichSessionView(session);
  session.container = container;
  session.token = makeRichFrameToken();
  session.frameReady = false;
  session.renderSent = false;
  session.rendered = false;
  session.viewFailureFullDispose = !!fullDisposeOnFailure;

  container.dataset.richOutputSessionId = session.sessionId;
  container.innerHTML = '';

  const iframe = document.createElement('iframe');
  iframe.className = 'output-rich-frame';
  iframe.title = 'Panel/Bokeh output';
  iframe.sandbox = 'allow-scripts';
  iframe.referrerPolicy = 'no-referrer';
  iframe.style.display = 'block';
  iframe.style.width = '100%';
  iframe.style.height = RICH_FRAME_MIN_HEIGHT + 'px';
  iframe.style.border = '0';
  iframe.style.overflow = 'hidden';
  iframe.setAttribute('scrolling', 'no');

  session.iframe = iframe;
  rememberRichSession(session.cellId, session);
  container.appendChild(iframe);
  session.frameWindow = iframe.contentWindow;
  if (session.frameWindow) richOutputFrameSessions.set(session.frameWindow, session.sessionId);
  iframe.srcdoc = createRichFrameSrcdoc();
  session.loadTimer = setTimeout(() => {
    if (session.disposed || session.frameReady) return;
    const message = 'BokehJS/PanelJSを読み込めませんでした。';
    if (session.viewFailureFullDispose) disposeRichSession(session, message);
    else failRichSessionView(session, message);
  }, 45000);
}

async function renderBokehRichOutput({ cellId, output, container }) {
  const data = normalizeRichOutputData(output.data);
  if (!data || typeof data !== 'object') throw new Error('Bokeh出力データが不正です。');

  const sessionId = String(data.sessionId || output.sessionId || `rich-${Date.now()}-${++richOutputSessionCounter}`);
  const existingSession = richOutputSessions.get(sessionId);
  const isReattach = !!(existingSession && !existingSession.disposed);
  const session = existingSession && !existingSession.disposed
    ? existingSession
    : {
      sessionId,
      cellId,
      container: null,
      iframe: null,
      frameWindow: null,
      token: null,
      frameReady: false,
      renderSent: false,
      rendered: false,
      disposed: false,
      loadTimer: null,
      pendingPatches: [],
      renderData: null,
    };

  session.cellId = cellId;
  session.container = container;
  container.dataset.richOutputSessionId = sessionId;
  container.innerHTML = '<div class="output-rich-loading">リッチ出力を準備しています...</div>';

  const initialRenderData = {
    sessionId,
    docs_json: data.docs_json || data.docsJson || data.docs,
    render_items: data.render_items || data.renderItems,
    root_ids: data.root_ids || data.rootIds || [],
    features: data.features || [],
  };
  if (!Array.isArray(session.pendingPatches)) session.pendingPatches = [];

  try {
    if (isReattach) {
      const snapshot = await requestRichSessionSnapshot(session);
      if (session.disposed || session.container !== container) return;
      session.pendingPatches = [];
      session.pendingPatchOverflow = false;
      session.renderData = normalizeRichOutputData(snapshot);
      attachRichFrame(session, container, false);
      return;
    }
    session.renderData = initialRenderData;
    attachRichFrame(session, container, true);
  } catch (err) {
    if (!session.disposed && session.container === container) {
      failRichSessionView(session, (err && err.message) || err || 'リッチ出力の再接続に失敗しました。');
    }
  }
}

registerRichOutputRenderer('application/bokeh', renderBokehRichOutput);
registerRichOutputRenderer('text/html', async ({ output, container }) => {
  const html = String(output.data || '');
  container.innerHTML = typeof sanitizeHtml === 'function' ? sanitizeHtml(html) : escapeHtmlFallback(html);
});
registerRichOutputRenderer('text/plain', async ({ output, container }) => {
  const text = String(output.data || '');
  container.innerHTML = `<pre class="output-text">${escapeHtmlFallback(text)}</pre>`;
});
