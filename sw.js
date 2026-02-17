/**
 * sw.js — Service Worker
 *
 * 快取策略：
 *   UI 資源（HTML/CSS/JS/圖片）→ stale-while-revalidate
 *   /pyodide/**                 → cache-first（版本固定）
 *   /wheels/**                  → cache-first（版本固定）
 *
 * 更新方式：修改 CACHE_VERSION 即可強制所有客戶端清除舊快取。
 */

const CACHE_VERSION = 'v1';

const CACHE_NAMES = {
  ui:      `ui-${CACHE_VERSION}`,
  pyodide: `pyodide-${CACHE_VERSION}`,
  wheels:  `wheels-${CACHE_VERSION}`,
};

// 安裝時預快取的 UI 靜態資源
const UI_PRECACHE = [
  '/',
  '/css/style.css',
  '/js/main.js',
  '/js/converter.worker.js',
  '/js/lib/jszip.min.js',
  '/images/favicon.svg',
];

// ── Install ────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAMES.ui)
      .then((cache) => cache.addAll(UI_PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ───────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 立即接管所有分頁，不等待重新整理
      await self.clients.claim();

      // 清除不屬於當前版本的舊快取
      const currentCacheNames = Object.values(CACHE_NAMES);
      const allCacheNames = await caches.keys();
      await Promise.all(
        allCacheNames
          .filter((name) => !currentCacheNames.includes(name))
          .map((name) => caches.delete(name))
      );
    })()
  );
});

// ── Fetch ──────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只處理同源請求（忽略 browser-sync 的 WebSocket 等）
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  if (path.startsWith('/pyodide/')) {
    event.respondWith(cacheFirst(request, CACHE_NAMES.pyodide));
  } else if (path.startsWith('/wheels/')) {
    event.respondWith(cacheFirst(request, CACHE_NAMES.wheels));
  } else {
    event.respondWith(staleWhileRevalidate(request, CACHE_NAMES.ui));
  }
});

// ── 快取策略函式 ────────────────────────────────────────────────────────────

/**
 * Cache-first：快取命中直接回傳，未命中才請求網路並寫入快取。
 * 適用於版本固定、不會變動的大型資源（pyodide、wheels）。
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

/**
 * Stale-while-revalidate：立即回傳快取（若有），同時背景更新快取。
 * 適用於 UI 資源（需要即時可用，但也要接收更新）。
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // 背景更新（不 await，不阻塞回傳）
  const networkFetch = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => null);

  // 有快取就立即回傳，否則等網路；兩者皆無則回傳 503
  return cached ?? await networkFetch ?? new Response('Offline', { status: 503 });
}
