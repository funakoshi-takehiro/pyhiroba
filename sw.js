/* ==================================================
   PyHiroba - Service Worker
   目的：初回ロード後、アプリ本体・CDNライブラリ・Pyodideをキャッシュし、
   2回目以降のオフライン起動／断続回線への耐性／通信量の節約を実現する。

   注意：これは「初回ロード時にCDNが遮断されている」問題は解決しない
   （初回だけは必ずネットワークが要る）。閉域網対策の“補完”策。

   安全設計：
   - HTMLはネットワーク優先（更新が必ず届く／オフライン時のみキャッシュを使う）
   - バージョン変更時に古いキャッシュを削除
   - 不具合時は sw.js を差し替え／削除すれば復旧できる（HTMLがネット優先のため）
   ================================================== */
'use strict';

const VERSION = 'pyhiroba-v3-20260819a';
const CACHE = VERSION;

// 同一オリジンで先読みしておく最小限のシェル。スコープは '/'（sw.js はルート）だが、
// オフライン対応が必要なのはアプリ本体（/nb/）なので、そのシェルを先読みする。
const PRECACHE_URLS = ['nb/', 'nb/index.html'];

// キャッシュ対象にする不変CDN（URLにバージョンを含み実質不変）
function isCacheableHost(host) {
  return /(^|\.)jsdelivr\.net$/.test(host)
      || /(^|\.)cdnjs\.cloudflare\.com$/.test(host)
      || host === 'fonts.googleapis.com'
      || host === 'fonts.gstatic.com';
}

// キャッシュしない（動的・認証・毎回最新が必要）ものはネットワーク直行
function isBypassHost(host) {
  return /(^|\.)googleapis\.com$/.test(host)
      || host === 'script.google.com'
      || host === 'drive.google.com'
      || /(^|\.)googleusercontent\.com$/.test(host)
      || host === 'forms.gle'
      || /(^|\.)github\.com$/.test(host)
      || /(^|\.)githubusercontent\.com$/.test(host);
}

// Pyodide コアの想定 SHA-256（16進）。SRI の無い worker/precache 経路で、初回ロード時の
// 中間者による差し替えを検知し、一致したものだけキャッシュする。Pyodideを更新する際は要更新。
const PYODIDE_HASHES = {
  'pyodide.js': '037907919d58ac79dbee2eee57e96507b79fad58260ab847dc6200443915c20f',
  'pyodide.asm.js': '704e56d209d8b867c8dd42e754a246db0175e448d59a46530803bdddfdfc78e0',
  'pyodide.asm.wasm': '8f631d8453672664131b2d4c9c41f3adf5d32e9efda2cb421d3fdf38cab57a21',
  'python_stdlib.zip': '0dd443755a0244ae3052f2e0834413d68c43f362c651edd47b785ea9d26e4853',
  'pyodide-lock.json': '0cb7ca8faf9c35af92b4d261996ddd51dd9a6c1074ee59279f1570d67af29644',
};
async function _sha256hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE_URLS);
    } catch (e) { /* 先読み失敗は致命ではない */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // 消すのは「自分が作った古い版のキャッシュ」だけに限る。
    // ライブラリが独自に持つキャッシュ（例: transformers-cache に入る AI のモデル。
    // 数百MBある）まで消すと、版数を上げるたびに再ダウンロードが発生してしまう。
    await Promise.all(
      keys.filter((k) => k.startsWith('pyhiroba-') && k !== CACHE).map((k) => caches.delete(k)),
    );
    await self.clients.claim();  // 既存ページも即制御下に置く（初回ロード後のキャッシュを可能に）
  })());
});

// メインスレッドの依頼で、Pyodideのコアファイル等を明示的にキャッシュする。
// 初回ロード成功直後に呼ばれる。既にHTTPキャッシュにあるため再取得は軽い。
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'cache-urls' && Array.isArray(data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      await Promise.allSettled(data.urls.map(async (u) => {
        // Pyodide 配信元のプレフィックスに限定（任意URLのキャッシュ注入を防ぐ）
        if (!/^https:\/\/cdn\.jsdelivr\.net\/pyodide\//.test(u)) return;
        try {
          const res = await fetch(u, { mode: 'cors', credentials: 'omit' });
          if (!res || res.status !== 200) return;
          const name = u.split('/').pop().split('?')[0];
          const expected = PYODIDE_HASHES[name];
          if (expected) {
            const got = await _sha256hex(await res.clone().arrayBuffer());
            if (got !== expected) return;   // 改ざん検知：キャッシュしない
          }
          await cache.put(u, res.clone());
        } catch (e) { /* 個別失敗は無視 */ }
      }));
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  if (isBypassHost(url.hostname)) return;  // 既定（ネットワーク）

  const sameOrigin = url.origin === self.location.origin;
  const isHTML = req.mode === 'navigate' || req.destination === 'document';

  if (isHTML) { event.respondWith(networkFirst(req)); return; }

  if (sameOrigin) {
    // 同一オリジンの JS/CSS/vendor は常に最新を優先（キャッシュ汚染でのXSS永続化や
    // ?v= 更新忘れによる古い資産の固着を防ぐ）。オフライン時はキャッシュにフォールバック。
    event.respondWith(networkFirst(req));
    return;
  }
  if (isCacheableHost(url.hostname)) {
    event.respondWith(cacheFirst(req));   // 不変CDN（Pyodide/フォント）は cache-first
  }
  // それ以外は既定（ネットワーク）
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    // 200 と 不透明(opaque) のみ保存（206 部分応答などは保存しない）
    if (res && (res.status === 200 || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return cached || Response.error();
  }
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    const shell = (await cache.match('nb/index.html')) || (await cache.match('nb/'));
    return shell || Response.error();
  }
}
