'use strict';

// ============================================================
// Rich Output 基盤
// ============================================================

const richOutputRenderers = Object.create(null);
const richOutputSessions = new Map();
const richOutputCellSessions = new Map();
let richFrontendResourcesPromise = null;
let richOutputSessionCounter = 0;

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

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = Array.from(document.querySelectorAll('script')).find((script) => script.src === src);
    if (existing && existing.dataset.loaded === '1') {
      resolve();
      return;
    }

    if (existing && existing.dataset.loading === '1') {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load ' + src)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.loading = '1';
    script.onload = () => {
      script.dataset.loaded = '1';
      delete script.dataset.loading;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(script);
  });
}

async function ensureRichFrontendResources() {
  if (!richFrontendResourcesPromise) {
    richFrontendResourcesPromise = (async () => {
      if (!window.Bokeh) {
        await loadScriptOnce('https://cdn.jsdelivr.net/npm/@bokeh/bokehjs@3.6.3/build/js/bokeh.min.js');
        await loadScriptOnce('https://cdn.jsdelivr.net/npm/@bokeh/bokehjs@3.6.3/build/js/bokeh-widgets.min.js');
        await loadScriptOnce('https://cdn.jsdelivr.net/npm/@bokeh/bokehjs@3.6.3/build/js/bokeh-tables.min.js');
      }
      if (!window.panel && !window.Panel) {
        await loadScriptOnce('https://cdn.jsdelivr.net/npm/@holoviz/panel@1.5.5/dist/panel.min.js');
      }
    })();
  }
  return richFrontendResourcesPromise;
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

function rememberRichSession(cellId, session) {
  richOutputSessions.set(session.sessionId, session);
  if (!richOutputCellSessions.has(cellId)) {
    richOutputCellSessions.set(cellId, []);
  }
  richOutputCellSessions.get(cellId).push(session.sessionId);
}

function cleanupRichOutputCell(cellId, message) {
  const sessionIds = richOutputCellSessions.get(cellId) || [];
  sessionIds.forEach((sessionId) => {
    const session = richOutputSessions.get(sessionId);
    if (!session) return;
    session.disposed = true;
    if (pyWorker) {
      pyWorker.postMessage({ type: 'rich-dispose', sessionId });
    }
    if (session.container) {
      session.container.innerHTML = message
        ? `<div class="output-rich-disconnected">${escapeHtmlFallback(message)}</div>`
        : '';
    }
    richOutputSessions.delete(sessionId);
  });
  richOutputCellSessions.delete(cellId);
}

function cleanupAllRichOutputs(message) {
  for (const cellId of Array.from(richOutputCellSessions.keys())) {
    cleanupRichOutputCell(cellId, message);
  }
}

function sendRichPatchToWorker(sessionId, patch, buffers) {
  if (!pyWorker) return;
  pyWorker.postMessage({
    type: 'rich-patch',
    sessionId,
    patch,
    buffers: buffers || null,
  });
}

function applyRichPatchFromWorker(msg) {
  const session = richOutputSessions.get(msg.sessionId);
  if (!session || session.disposed || !session.jsdoc) return;
  try {
    session.patching += 1;
    const buffers = msg.buffers ? new Map(Object.entries(msg.buffers)) : null;
    if (buffers) {
      session.jsdoc.apply_json_patch(msg.patch, buffers);
    } else {
      session.jsdoc.apply_json_patch(msg.patch);
    }
  } finally {
    session.patching = Math.max(0, session.patching - 1);
  }
}

async function renderRichOutputs(cellId, richOutputs) {
  if (!Array.isArray(richOutputs) || !richOutputs.length) return;
  const cellOutput = document.getElementById(`output-${cellId}`);
  if (!cellOutput) return;

  const existing = cellOutput.querySelectorAll('[data-rich-output-session-id]');
  existing.forEach((node) => node.remove());

  for (let index = 0; index < richOutputs.length; index += 1) {
    const richOutput = richOutputs[index];
    const renderer = getRichOutputRenderer(richOutput.mimeType);
    if (!renderer) continue;

    const slot = document.createElement('div');
    slot.className = 'output-rich';
    slot.innerHTML = '<div class="output-rich-loading">リッチ出力を準備しています…</div>';
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

function normalizeRenderItems(renderItems) {
  const items = normalizeRichOutputData(renderItems);
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

function makeBokehTarget(container, id) {
  const div = document.createElement('div');
  if (id) div.id = String(id);
  div.className = 'bk-root output-rich-bokeh-root';
  container.appendChild(div);
  return div;
}

function prepareBokehRenderItems(renderItems, rootIds, container, sessionId) {
  return normalizeRenderItems(renderItems).map((item, itemIndex) => {
    const next = { ...item };
    const roots = next.roots && typeof next.roots === 'object' ? { ...next.roots } : null;

    if (roots) {
      Object.keys(roots).forEach((rootId, rootIndex) => {
        const target = roots[rootId];
        if (typeof target === 'string') {
          makeBokehTarget(container, target);
        } else if (!target) {
          roots[rootId] = makeBokehTarget(container, `${sessionId}-${itemIndex}-${rootIndex}`);
        }
      });
      next.roots = roots;
      return next;
    }

    if (next.elementid) {
      makeBokehTarget(container, next.elementid);
      return next;
    }

    const ids = Array.isArray(next.root_ids) && next.root_ids.length ? next.root_ids : rootIds;
    next.roots = {};
    ids.forEach((rootId, rootIndex) => {
      next.roots[rootId] = makeBokehTarget(container, `${sessionId}-${itemIndex}-${rootIndex}`);
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

async function renderBokehRichOutput({ cellId, output, container }) {
  await ensureRichFrontendResources();

  const data = normalizeRichOutputData(output.data);
  const docsJson = normalizeRichOutputData(data.docs_json || data.docsJson || data.docs);
  const renderItems = normalizeRenderItems(data.render_items || data.renderItems);
  const rootIds = normalizeRichOutputData(data.root_ids || data.rootIds || []);
  const sessionId = String(data.sessionId || output.sessionId || `rich-${Date.now()}-${++richOutputSessionCounter}`);

  container.dataset.richOutputSessionId = sessionId;
  container.innerHTML = '';
  const preparedRenderItems = prepareBokehRenderItems(renderItems, rootIds, container, sessionId);

  const session = {
    sessionId,
    cellId,
    container,
    jsdoc: null,
    patching: 0,
    disposed: false,
  };
  rememberRichSession(cellId, session);

  const embedResult = await window.Bokeh.embed.embed_items(docsJson, preparedRenderItems);
  if (session.disposed) return;

  const jsdoc = findBokehDocument(embedResult, rootIds);
  if (!jsdoc) {
    console.warn('Bokeh document was rendered, but document sync could not be attached.', { sessionId, rootIds });
    return;
  }

  session.jsdoc = jsdoc;
  session.rootIds = rootIds;

  const onChange = (event) => {
    if (session.disposed || session.patching > 0) return;
    if (!event) return;
    if (event.setter_id != null && event.setter_id === 'py') return;
    if (typeof jsdoc.create_json_patch !== 'function') return;
    const patch = jsdoc.create_json_patch([event]);
    sendRichPatchToWorker(sessionId, patch, null);
  };

  jsdoc.on_change(onChange, false);

  if (pyWorker) {
    pyWorker.postMessage({ type: 'rich-rendered', sessionId });
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
