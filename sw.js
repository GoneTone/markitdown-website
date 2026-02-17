/**
 * sw.js - Service Worker
 *
 * Cache strategies:
 *   UI assets (HTML/CSS/JS/images) -> stale-while-revalidate
 *   /pyodide/**                     -> cache-first (version pinned)
 *   /wheels/**                      -> cache-first (version pinned)
 *
 * To force all clients to clear old cache, bump CACHE_VERSION.
 */

const CACHE_VERSION = 'v2';

const CACHE_NAMES = {
  ui:      `ui-${CACHE_VERSION}`,
  pyodide: `pyodide-${CACHE_VERSION}`,
  wheels:  `wheels-${CACHE_VERSION}`,
};

// UI static assets to pre-cache on install
const UI_PRECACHE = [
  '/',
  '/css/style.css',
  '/js/main.js',
  '/js/converter.worker.js',
  '/js/lib/jszip.min.js',
  '/images/favicon.svg',
  '/images/icon-192.png',
  '/images/icon-512.png',
  '/images/icon-180.png',
  '/manifest.json',
];

// -- Install ------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAMES.ui)
      .then((cache) => cache.addAll(UI_PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// -- Activate -----------------------------------------------------------------

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Take control of all clients immediately, no reload required
      await self.clients.claim();

      // Delete caches that don't belong to the current version
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

// -- Fetch --------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests (ignore browser-sync WebSocket etc.)
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

// -- Cache strategy functions -------------------------------------------------

/**
 * Cache-first: return cached response immediately; fetch from network only on
 * cache miss, then store the response. Suitable for version-pinned large assets
 * (pyodide, wheels).
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
 * Stale-while-revalidate: return cached response immediately (if available),
 * while fetching a fresh copy in the background. Suitable for UI assets that
 * need to be available instantly but should also receive updates.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Background update - does not block the response
  const networkFetch = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => null);

  // Return cached immediately if available; otherwise wait for network.
  // Fall back to 503 if both are unavailable (offline, not yet cached).
  return cached ?? await networkFetch ?? new Response('Offline', { status: 503 });
}
