# 離線支援（Service Worker）實作計畫

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新增 Service Worker（`sw.js`），讓網站在首次 Pyodide 初始化後可完全離線使用。

**Architecture:** Service Worker 攔截所有 fetch 請求，UI 靜態資源（HTML/CSS/JS/圖片）採 stale-while-revalidate（先回傳快取再背景更新），`/pyodide/` 與 `/wheels/` 採 cache-first（版本固定，永不重複下載）。新版 SW 部署後自動 skipWaiting，`main.js` 監聽 `controllerchange` 觸發頁面重載。

**Tech Stack:** Service Worker API, Cache Storage API, 原生 JavaScript

---

## Task 1：建立 sw.js

**Files:**
- Create: `sw.js`

**Step 1: 建立 sw.js**

```javascript
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
    caches.open(CACHE_NAMES.ui).then((cache) => cache.addAll(UI_PRECACHE))
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
    cache.put(request, response.clone());
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
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => {/* 離線時忽略網路錯誤 */});

  // 有快取就立即回傳，否則等網路
  return cached ?? networkFetch;
}
```

**Step 2: 確認檔案在根目錄**

```bash
ls sw.js
```
預期：找到 `sw.js` 檔案

**Step 3: Commit**

```bash
git add sw.js
git commit -m "feat: add Service Worker with offline caching support"
```

---

## Task 2：在 index.html 註冊 Service Worker

**Files:**
- Modify: `index.html`（在 `</body>` 前，`<script src="/js/main.js">` 之前）

**Step 1: 確認 index.html 末尾結構**

讀取 `index.html` 末尾，確認 script 標籤位置，預期看到：
```html
  <script src="/js/lib/jszip.min.js"></script>
  <script src="/js/main.js"></script>
</body>
</html>
```

**Step 2: 在 jszip.min.js script 前插入 SW 註冊程式碼**

插入位置：`<script src="/js/lib/jszip.min.js">` 之前

```html
  <!-- Service Worker：離線支援 -->
  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // SW 註冊失敗不影響網站基本功能，靜默忽略
      });

      // 當新版 SW 接管後自動重新載入頁面（取得最新版本）
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });
    }
  </script>
```

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: register Service Worker in index.html for offline support"
```

---

## Task 3：本地驗證

**前置條件：** Docker 開發環境已啟動（`docker compose -f docker-compose-dev.yml up`）

**Step 1: 確認 SW 已註冊**

開啟 `http://localhost:3000`，前往：
- DevTools → Application → Service Workers
- 確認 `sw.js` 狀態為 **activated and running**

**Step 2: 確認快取已建立**

DevTools → Application → Cache Storage，確認存在：
- `ui-v1`：含 `/`、`/css/style.css`、`/js/main.js` 等
- `pyodide-v1`：Pyodide 初始化後自動填入
- `wheels-v1`：Pyodide 初始化後自動填入

**Step 3: 等待引擎初始化完成**

等待頁面右上角顯示「就緒 ✓」，確認 Pyodide 初始化完成並快取所有相關檔案。

**Step 4: 驗證離線功能**

DevTools → Network → 勾選 **Offline**，重新整理頁面：
- 確認頁面正常載入（不顯示瀏覽器錯誤頁面）
- 確認右上角引擎狀態仍顯示「就緒 ✓」（或重新初始化後顯示就緒）
- 上傳一個文件，確認轉換成功

**Step 5: 取消 Offline 模式**

DevTools → Network → 取消勾選 Offline，恢復正常網路。

---

## Task 4：更新 README

**Files:**
- Modify: `README.md`

**Step 1: 在「功能特色」清單中新增離線功能項目**

在 `- **拖放上傳**` 行之前新增：

```markdown
- **離線可用**：首次初始化後，無需網路即可使用（Service Worker 快取）
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add offline support feature to README"
```
