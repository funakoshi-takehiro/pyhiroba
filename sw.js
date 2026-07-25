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

const VERSION = 'pyhiroba-v1-20260725';
const CACHE = VERSION;

// 同一オリジンで先読みしておく最小限のシェル（相対パス＝スコープ基準）
const PRECACHE_URLS = ['./', './index.html'];

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
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
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
        try {
          const res = await fetch(u, { mode: 'cors', credentials: 'omit' });
          if (res && (res.status === 200 || res.type === 'opaque')) await cache.put(u, res.clone());
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

  if (sameOrigin || isCacheableHost(url.hostname)) {
    event.respondWith(cacheFirst(req));
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
    const shell = (await cache.match('./index.html')) || (await cache.match('./'));
    return shell || Response.error();
  }
}
