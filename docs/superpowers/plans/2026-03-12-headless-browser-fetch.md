# Headless Browser URL 抓取實作計劃

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 URL 抓取從 Node.js `fetch()` 改為 `puppeteer-core` + `chrome-headless-shell`，支援 JS 渲染頁面，同時保留 PDF/DOCX/XLSX/PPTX/CSV/EPUB 的直接下載。

**Architecture:** 新增 `server/browser.js`（browser 生命週期 + mutex 恢復）和 `server/semaphore.js`（並行限制），重構 `server/fetch-url.js` 使用 Puppeteer 抓取 HTML 頁面、`fetch()` 下載二進位檔案。Docker 從 Alpine 改為 Debian slim 以支援 chrome-headless-shell。

**Tech Stack:** puppeteer-core, chrome-headless-shell, Node.js, Express, Docker (Debian slim)

**Spec:** `docs/superpowers/specs/2026-03-12-headless-browser-fetch-design.md`

**注意事項：**
- `docker/start.sh` 不需修改 — `nginx -g 'daemon off;'` 在 Debian 上同樣適用，已驗證。
- `docker/nginx.conf` 內容不需修改 — 目前只包含 `server {}` 區塊，Debian nginx 的 `conf.d/` include 機制相容。

---

## Chunk 1: Node.js 核心模組

### Task 1: 安裝 puppeteer-core 依賴

**Files:**
- Modify: `server/package.json`
- Regenerate: `server/package-lock.json`

必須先安裝依賴，後續 Task 2-4 的程式碼都需要 `require('puppeteer-core')`。

- [ ] **Step 1: 安裝 puppeteer-core**

```bash
cd server && npm install puppeteer-core@latest
```

- [ ] **Step 2: 確認 package.json 已更新**

確認 `dependencies` 中包含 `puppeteer-core`。

- [ ] **Step 3: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "deps(server): 新增 puppeteer-core 依賴"
```

---

### Task 2: Semaphore 模組

**Files:**
- Create: `server/semaphore.js`
- Create: `server/__tests__/semaphore.test.js`

- [ ] **Step 1: 撰寫 semaphore 測試**

```javascript
// server/__tests__/semaphore.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Semaphore } = require('../semaphore');

describe('Semaphore', () => {
  it('允許取得 permit 直到上限', () => {
    const sem = new Semaphore(2);
    assert.equal(sem.tryAcquire(), true);
    assert.equal(sem.tryAcquire(), true);
    assert.equal(sem.tryAcquire(), false);
  });

  it('釋放後可再次取得', () => {
    const sem = new Semaphore(1);
    assert.equal(sem.tryAcquire(), true);
    assert.equal(sem.tryAcquire(), false);
    sem.release();
    assert.equal(sem.tryAcquire(), true);
  });

  it('release 不會超過初始上限', () => {
    const sem = new Semaphore(1);
    sem.release(); // 多餘的 release
    assert.equal(sem.tryAcquire(), true);
    assert.equal(sem.tryAcquire(), false); // 不應該有額外 permit
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && node --test __tests__/semaphore.test.js`
Expected: FAIL — `Cannot find module '../semaphore'`

- [ ] **Step 3: 實作 semaphore**

```javascript
// server/semaphore.js
class Semaphore {
  constructor(max) {
    this._max = max;
    this._count = 0;
  }

  tryAcquire() {
    if (this._count >= this._max) return false;
    this._count++;
    return true;
  }

  release() {
    if (this._count > 0) this._count--;
  }
}

module.exports = { Semaphore };
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && node --test __tests__/semaphore.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add server/semaphore.js server/__tests__/semaphore.test.js
git commit -m "feat(server): 新增 Semaphore 並行控制模組"
```

---

### Task 3: Browser 生命週期模組

**Files:**
- Create: `server/browser.js`
- Create: `server/__tests__/browser.test.js`

- [ ] **Step 1: 撰寫 browser 模組測試**

```javascript
// server/__tests__/browser.test.js
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

describe('isDirectDownloadType', () => {
  it('辨識 PDF', () => {
    const { isDirectDownloadType } = require('../browser');
    assert.equal(isDirectDownloadType('application/pdf'), true);
  });

  it('辨識 DOCX', () => {
    const { isDirectDownloadType } = require('../browser');
    assert.equal(isDirectDownloadType('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), true);
  });

  it('辨識 XLSX', () => {
    const { isDirectDownloadType } = require('../browser');
    assert.equal(isDirectDownloadType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), true);
  });

  it('辨識 PPTX', () => {
    const { isDirectDownloadType } = require('../browser');
    assert.equal(isDirectDownloadType('application/vnd.openxmlformats-officedocument.presentationml.presentation'), true);
  });

  it('辨識 CSV', () => {
    const { isDirectDownloadType } = require('../browser');
    assert.equal(isDirectDownloadType('text/csv'), true);
  });

  it('辨識 EPUB', () => {
    const { isDirectDownloadType } = require('../browser');
    assert.equal(isDirectDownloadType('application/epub+zip'), true);
  });

  it('忽略 charset 參數', () => {
    const { isDirectDownloadType } = require('../browser');
    assert.equal(isDirectDownloadType('application/pdf; charset=binary'), true);
  });

  it('HTML 不是直接下載類型', () => {
    const { isDirectDownloadType } = require('../browser');
    assert.equal(isDirectDownloadType('text/html'), false);
    assert.equal(isDirectDownloadType('text/html; charset=utf-8'), false);
  });

  it('未知類型不是直接下載類型', () => {
    const { isDirectDownloadType } = require('../browser');
    assert.equal(isDirectDownloadType('application/json'), false);
  });

  it('null/undefined 不是直接下載類型', () => {
    const { isDirectDownloadType } = require('../browser');
    assert.equal(isDirectDownloadType(null), false);
    assert.equal(isDirectDownloadType(undefined), false);
    assert.equal(isDirectDownloadType(''), false);
  });
});

describe('getBrowser / setBrowser', () => {
  it('初始狀態為 null', () => {
    const { getBrowser, setBrowser } = require('../browser');
    setBrowser(null); // 確保清理
    assert.equal(getBrowser(), null);
  });

  it('setBrowser 後可透過 getBrowser 取得', () => {
    const { getBrowser, setBrowser } = require('../browser');
    const fakeBrowser = { isConnected: () => true, close: async () => {} };
    setBrowser(fakeBrowser);
    assert.equal(getBrowser(), fakeBrowser);
    setBrowser(null); // 清理
  });
});

describe('ensureBrowser', () => {
  afterEach(() => {
    const { setBrowser } = require('../browser');
    setBrowser(null);
  });

  it('已連線的 browser 直接回傳', async () => {
    const { ensureBrowser, setBrowser } = require('../browser');
    const fakeBrowser = { isConnected: () => true };
    setBrowser(fakeBrowser);
    const result = await ensureBrowser();
    assert.equal(result, fakeBrowser);
  });

  it('斷線時嘗試 relaunch（無 chrome 則回傳 null）', async () => {
    const { ensureBrowser, setBrowser } = require('../browser');
    const deadBrowser = { isConnected: () => false };
    setBrowser(deadBrowser);
    // 測試環境沒有 chrome-headless-shell，預期 launch 失敗回傳 null
    const result = await ensureBrowser();
    assert.equal(result, null);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && node --test __tests__/browser.test.js`
Expected: FAIL — `Cannot find module '../browser'`

- [ ] **Step 3: 實作 browser 模組**

```javascript
// server/browser.js
const puppeteer = require('puppeteer-core');

let _browser = null;
let _launching = null; // mutex: 正在啟動中的 Promise

const CHROME_PATH = process.env.CHROME_PATH || '/usr/local/bin/chrome-headless-shell';

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--disable-software-rasterizer',
  '--disable-extensions',
];

// 直接下載的 MIME type 清單
const DIRECT_DOWNLOAD_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'application/epub+zip',
]);

function isDirectDownloadType(contentType) {
  if (!contentType) return false;
  const mime = contentType.split(';')[0].trim().toLowerCase();
  return DIRECT_DOWNLOAD_TYPES.has(mime);
}

async function launchBrowser() {
  _browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: LAUNCH_ARGS,
  });
  console.log('Browser launched');
  return _browser;
}

function getBrowser() {
  return _browser;
}

function setBrowser(b) {
  _browser = b;
}

/**
 * 取得可用的 browser instance。
 * 若已斷線，使用 mutex 確保只有一個請求執行 relaunch。
 * @returns {Promise<import('puppeteer-core').Browser | null>}
 */
async function ensureBrowser() {
  if (_browser && _browser.isConnected()) return _browser;

  // mutex：若有其他請求正在 launch，等待它完成
  if (_launching) {
    await _launching;
    return _browser && _browser.isConnected() ? _browser : null;
  }

  try {
    _launching = launchBrowser();
    await _launching;
    return _browser;
  } catch (err) {
    console.error('Failed to launch browser:', err.message);
    _browser = null;
    return null;
  } finally {
    _launching = null;
  }
}

async function closeBrowser() {
  if (_browser) {
    try {
      await _browser.close();
    } catch { /* ignore */ }
    _browser = null;
  }
}

module.exports = {
  launchBrowser,
  getBrowser,
  setBrowser,
  ensureBrowser,
  closeBrowser,
  isDirectDownloadType,
  DIRECT_DOWNLOAD_TYPES,
};
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && node --test __tests__/browser.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add server/browser.js server/__tests__/browser.test.js
git commit -m "feat(server): 新增 browser 生命週期管理模組"
```

---

### Task 4: 重構 fetch-url.js — 使用 Puppeteer 抓取

**Files:**
- Modify: `server/fetch-url.js`
- Create: `server/semaphore-instance.js`
- Modify: `server/__tests__/fetch-url.test.js`

- [ ] **Step 1: 建立 semaphore 共用 instance 檔案**

```javascript
// server/semaphore-instance.js
const { Semaphore } = require('./semaphore');

const MAX_CONCURRENT_PAGES = parseInt(process.env.MAX_CONCURRENT_PAGES || '5', 10);
const pageSemaphore = new Semaphore(MAX_CONCURRENT_PAGES);

module.exports = { pageSemaphore };
```

- [ ] **Step 2: 新增 Content-Type 分流測試**

在 `server/__tests__/fetch-url.test.js` 結尾新增：

```javascript
const { isDirectDownloadType } = require('../browser');

describe('isDirectDownloadType (整合)', () => {
  it('PDF 走直接下載', () => {
    assert.equal(isDirectDownloadType('application/pdf'), true);
  });

  it('HTML 走渲染', () => {
    assert.equal(isDirectDownloadType('text/html'), false);
    assert.equal(isDirectDownloadType('text/html; charset=utf-8'), false);
  });

  it('未知類型走渲染', () => {
    assert.equal(isDirectDownloadType('application/json'), false);
  });
});
```

- [ ] **Step 3: 重構 fetch-url.js 主要抓取邏輯**

保留 `validateUrl`、`isPrivateIP`、`resolveAndCheck` 不變，替換 handler 主體並新增 `streamDownload`。

**重要**：`module.exports` 必須保留所有原有匯出，確保 `resolveAndCheck` 仍然匯出（`streamDownload` 內部和測試都需要）：
```javascript
module.exports = { fetchUrlHandler, validateUrl, isPrivateIP, resolveAndCheck };
```

頂部新增引入：
```javascript
const { ensureBrowser, isDirectDownloadType } = require('./browser');
const { pageSemaphore } = require('./semaphore-instance');
```

新增 `streamDownload` 函式（直接下載二進位內容，使用 `redirect: 'manual'` 防止 SSRF 繞過）：
```javascript
/**
 * 使用 fetch() 直接下載二進位內容（PDF、DOCX 等）
 * 使用 redirect: 'manual' 搭配手動跟隨，每次重導向前檢查 SSRF。
 */
async function streamDownload(url, res) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  let currentUrl = url.href;
  let response;
  const MAX_REDIRECTS = 5;

  try {
    // 初始 URL 也重新做 DNS 檢查（防止 DNS rebinding：
    // 從 fetchUrlHandler 的 resolveAndCheck 到此處有時間差）
    const initialCheck = await resolveAndCheck(url.hostname);
    if (initialCheck.error) {
      clearTimeout(timer);
      return res.status(403).json({ error: '不允許存取內部網路位址' });
    }

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      response = await fetch(currentUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'manual',
      });

      // 處理重導向
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) break;
        const redirectUrl = new URL(location, currentUrl);
        // SSRF 檢查重導向目標
        const check = await resolveAndCheck(redirectUrl.hostname);
        if (check.error) {
          clearTimeout(timer);
          return res.status(403).json({ error: '不允許存取內部網路位址' });
        }
        currentUrl = redirectUrl.href;
        continue;
      }
      break;
    }
    clearTimeout(timer);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      return res.status(408).json({ error: '請求超時（15 秒）' });
    }
    return res.status(502).json({ error: `無法連線至目標伺服器：${err.message}` });
  }

  if (!response.ok) {
    return res.status(502).json({
      error: `目標伺服器回應錯誤：${response.status} ${response.statusText}`,
    });
  }

  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_SIZE) {
    return res.status(413).json({ error: `回應過大（${Math.round(contentLength / 1024 / 1024)}MB），上限為 10MB` });
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  res.set('Content-Type', contentType);
  res.set('X-Original-Url', url.href);

  try {
    const reader = response.body.getReader();
    let totalSize = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.length;
      if (totalSize > MAX_SIZE) {
        reader.cancel();
        if (res.headersSent) { res.destroy(); return; }
        return res.status(413).json({ error: '回應過大，上限為 10MB' });
      }
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      return res.status(502).json({ error: `讀取回應時發生錯誤：${err.message}` });
    }
    res.destroy();
  }
}
```

替換 `fetchUrlHandler`（使用 `_initialNavigationDone` flag 追蹤初始請求，避免 URL 正規化差異導致誤判）：
```javascript
/**
 * Express 路由 handler（Puppeteer 版）
 */
async function fetchUrlHandler(req, res) {
  // 1. 驗證 URL
  const validation = validateUrl(req.query.url);
  if (validation.error) {
    return res.status(validation.status).json({ error: validation.error });
  }
  const { url } = validation;

  // 2. DNS 解析 + SSRF 檢查
  const dnsResult = await resolveAndCheck(url.hostname);
  if (dnsResult.error) {
    return res.status(dnsResult.status).json({ error: dnsResult.error });
  }

  // 3. 取得 semaphore permit
  if (!pageSemaphore.tryAcquire()) {
    return res.status(503).json({ error: '伺服器忙碌中，請稍後再試' });
  }

  // 4. 取得 browser instance
  const browser = await ensureBrowser();
  if (!browser) {
    pageSemaphore.release();
    return res.status(503).json({ error: '瀏覽器引擎暫時無法使用' });
  }

  let page = null;
  try {
    page = await browser.newPage();
    page.setDefaultNavigationTimeout(TIMEOUT);

    // 5. SSRF 重導向攔截（使用 flag 追蹤初始請求）
    let initialNavigationDone = false;
    await page.setRequestInterception(true);
    page.on('request', async (interceptedRequest) => {
      if (interceptedRequest.isInterceptResolutionHandled()) return;

      if (interceptedRequest.isNavigationRequest() && initialNavigationDone) {
        // 這是重導向，檢查目標是否為私有 IP
        try {
          const reqUrl = new URL(interceptedRequest.url());
          const check = await resolveAndCheck(reqUrl.hostname);
          if (check.error) {
            interceptedRequest.abort('accessdenied');
            return;
          }
        } catch {
          interceptedRequest.abort('failed');
          return;
        }
      }

      if (interceptedRequest.isNavigationRequest() && !initialNavigationDone) {
        initialNavigationDone = true;
      }

      interceptedRequest.continue();
    });

    // 6. 導航
    let response;
    try {
      response = await page.goto(url.href, {
        waitUntil: 'networkidle2',
        timeout: TIMEOUT,
      });
    } catch (err) {
      if (err.message.includes('net::ERR_ACCESS_DENIED') || err.message.includes('accessdenied')) {
        return res.status(403).json({ error: '不允許存取內部網路位址' });
      }
      if (err.name === 'TimeoutError' || err.message.includes('timeout')) {
        return res.status(408).json({ error: '請求超時（15 秒）' });
      }
      return res.status(502).json({ error: `無法連線至目標伺服器：${err.message}` });
    }

    // 7. 檢查 response
    if (!response) {
      return res.status(502).json({ error: '無法取得頁面回應' });
    }
    const status = response.status();
    if (status < 200 || status >= 300) {
      return res.status(502).json({ error: `目標伺服器回應錯誤：${status}` });
    }

    // 8. Content-Type 分流
    const responseContentType = response.headers()['content-type'] || '';
    if (isDirectDownloadType(responseContentType)) {
      await page.close();
      page = null;
      return streamDownload(url, res);
    }

    // 9. HTML 路徑：取得渲染後內容
    const html = await page.content();
    const htmlSize = Buffer.byteLength(html, 'utf8');
    if (htmlSize > MAX_SIZE) {
      return res.status(413).json({ error: '回應過大，上限為 10MB' });
    }

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('X-Original-Url', url.href);
    res.send(html);
  } catch (err) {
    if (!res.headersSent) {
      return res.status(502).json({ error: `抓取頁面時發生錯誤：${err.message}` });
    }
    res.destroy();
  } finally {
    if (page) {
      try { await page.close(); } catch { /* ignore */ }
    }
    pageSemaphore.release();
  }
}
```

- [ ] **Step 4: 執行所有測試確認通過**

Run: `cd server && node --test __tests__/*.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add server/fetch-url.js server/semaphore-instance.js server/__tests__/fetch-url.test.js
git commit -m "feat(server): 重構 fetch-url 使用 Puppeteer 抓取 + Content-Type 分流"
```

---

### Task 5: 更新 server/index.js — Browser 啟動與關閉

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: 修改 server/index.js**

```javascript
// server/index.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const { fetchUrlHandler } = require('./fetch-url');
const { launchBrowser, closeBrowser } = require('./browser');

const app = express();
const PORT = process.env.PORT || 3002;

app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '請求過於頻繁，請稍後再試' },
});

app.use('/fetch-url', limiter);
app.get('/fetch-url', fetchUrlHandler);
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

async function start() {
  try {
    await launchBrowser();
    console.log('Browser ready');
  } catch (err) {
    console.error('Warning: Browser launch failed:', err.message);
    console.error('Will retry on first request');
  }

  app.listen(PORT, () => {
    console.log(`Proxy server listening on port ${PORT}`);
  });
}

// 優雅關閉
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing browser...');
  await closeBrowser();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing browser...');
  await closeBrowser();
  process.exit(0);
});

start();

module.exports = app;
```

注意：`start()` 會在 module 載入時觸發 browser launch 和 `app.listen()`。現有測試只 `require('./fetch-url')`，不 `require('./index')`，所以不受影響。

- [ ] **Step 2: 執行所有測試確認通過**

Run: `cd server && node --test __tests__/*.test.js`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(server): 啟動時 launch browser，關閉時優雅清理"
```

---

## Chunk 2: Docker 與開發環境

### Task 6: 更新 Dockerfile — 改用 Debian slim

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: 重寫 Dockerfile**

將階段二和階段三從 Alpine 改為 Debian slim：

```dockerfile
# ─────────────────────────────────────────────────────────────────────────────
# 階段一：builder（不變）
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build
COPY scripts/download_wheels.py scripts/download_wheels.py
RUN python scripts/download_wheels.py

# ─────────────────────────────────────────────────────────────────────────────
# 階段二：server-deps
#   安裝 Node.js proxy 依賴 + chrome-headless-shell。
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS server-deps

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --production

# 下載 chrome-headless-shell 並建立 symlink
# @puppeteer/browsers 是 puppeteer-core 的依賴，npm ci 後即可使用
RUN npx @puppeteer/browsers install chrome-headless-shell@stable --install-dir /app/chrome-hs \
    && CHROME_BIN=$(find /app/chrome-hs -name chrome-headless-shell -type f | head -1) \
    && ln -s "$CHROME_BIN" /usr/local/bin/chrome-headless-shell

# ─────────────────────────────────────────────────────────────────────────────
# 階段三：runner
#   使用 node:20-slim + nginx 提供靜態檔案與 API proxy。
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS runner

# 安裝 nginx + chrome-headless-shell 所需系統函式庫
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    fonts-noto-cjk \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# 移除 Debian 預設 nginx 設定
RUN rm -f /etc/nginx/sites-enabled/default

# 複製 Docker 專用的 nginx 設定（內容不變，只改路徑）
COPY docker/nginx.conf /etc/nginx/conf.d/markitdown.conf

# 複製靜態網站檔案
COPY index.html     /usr/share/nginx/html/index.html
COPY manifest.json  /usr/share/nginx/html/manifest.json
COPY sw.js          /usr/share/nginx/html/sw.js
COPY images/        /usr/share/nginx/html/images/
COPY css/           /usr/share/nginx/html/css/
COPY js/            /usr/share/nginx/html/js/

# 從 builder 階段複製下載好的 Pyodide runtime 和 wheels
COPY --from=builder /build/pyodide/ /usr/share/nginx/html/pyodide/
COPY --from=builder /build/wheels/  /usr/share/nginx/html/wheels/

# 從 server-deps 階段複製 Node.js proxy + chrome-headless-shell
COPY server/index.js            /app/server/index.js
COPY server/fetch-url.js        /app/server/fetch-url.js
COPY server/browser.js          /app/server/browser.js
COPY server/semaphore.js        /app/server/semaphore.js
COPY server/semaphore-instance.js /app/server/semaphore-instance.js
COPY --from=server-deps /app/server/node_modules/ /app/server/node_modules/
COPY --from=server-deps /app/chrome-hs/ /app/chrome-hs/

# 建立 chrome-headless-shell symlink（runner stage 自建，避免複製 symlink 問題）
RUN CHROME_BIN=$(find /app/chrome-hs -name chrome-headless-shell -type f | head -1) \
    && ln -s "$CHROME_BIN" /usr/local/bin/chrome-headless-shell

# 複製啟動腳本（內容不變）
COPY docker/start.sh /app/start.sh
RUN chmod +x /app/start.sh

ENV PORT=3002
ENV CHROME_PATH=/usr/local/bin/chrome-headless-shell

EXPOSE 80

CMD ["/app/start.sh"]
```

- [ ] **Step 2: Commit**

```bash
git add Dockerfile
git commit -m "build: Dockerfile 改用 Debian slim，安裝 chrome-headless-shell"
```

---

### Task 7: 更新 docker-compose-dev.yml — 開發環境支援 Puppeteer

**Files:**
- Modify: `docker-compose-dev.yml`
- Create: `docker/Dockerfile.dev-proxy`

- [ ] **Step 1: 建立開發用 proxy Dockerfile**

```dockerfile
# docker/Dockerfile.dev-proxy
FROM node:20-slim

# 安裝 chrome-headless-shell 所需系統函式庫
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server

# 安裝依賴 + chrome-headless-shell
COPY server/package.json server/package-lock.json ./
RUN npm ci --production \
    && npx @puppeteer/browsers install chrome-headless-shell@stable --install-dir /app/chrome-hs \
    && CHROME_BIN=$(find /app/chrome-hs -name chrome-headless-shell -type f | head -1) \
    && ln -s "$CHROME_BIN" /usr/local/bin/chrome-headless-shell

ENV CHROME_PATH=/usr/local/bin/chrome-headless-shell
```

- [ ] **Step 2: 更新 docker-compose-dev.yml 的 proxy service**

將 `proxy` service 改為：

```yaml
  proxy:
    build:
      context: .
      dockerfile: docker/Dockerfile.dev-proxy
    working_dir: /app/server
    command: node index.js
    volumes:
      - ./server:/app/server:ro
      - /app/server/node_modules  # anonymous volume 保留容器內的 node_modules
    expose:
      - "3002"
    environment:
      - PORT=3002
      - CHROME_PATH=/usr/local/bin/chrome-headless-shell
    networks:
      - dev-network
```

注意：使用 anonymous volume `/app/server/node_modules` 防止 host 的 Windows node_modules 覆蓋容器內的 Linux 版本。

- [ ] **Step 3: Commit**

```bash
git add docker-compose-dev.yml docker/Dockerfile.dev-proxy
git commit -m "build: 開發環境 proxy 支援 chrome-headless-shell"
```

---

### Task 8: Docker 建置驗證

- [ ] **Step 1: 建置正式 Docker image**

```bash
docker compose build
```

Expected: 建置成功，無錯誤。

- [ ] **Step 2: 啟動並測試 HTML 抓取**

```bash
docker compose up -d
```

等待啟動後：

```bash
curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/api/fetch-url?url=https://example.com"
```

Expected: `200`

- [ ] **Step 3: 測試 PDF 直接下載**

```bash
curl -s -I "http://localhost:8080/api/fetch-url?url=https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf" | grep -i content-type
```

Expected: `Content-Type: application/pdf`

- [ ] **Step 4: 停止並清理**

```bash
docker compose down
```

- [ ] **Step 5: Commit（如有修正）**

若測試過程中有修正，提交修正。

---

### Task 9: 開發環境驗證

- [ ] **Step 1: 建置開發環境**

```bash
docker compose -f docker-compose-dev.yml build
docker compose -f docker-compose-dev.yml up
```

- [ ] **Step 2: 測試 URL 抓取功能**

開啟 http://localhost:3000，輸入任意 URL 測試轉換。

- [ ] **Step 3: 確認正常後停止**

```bash
docker compose -f docker-compose-dev.yml down
```

---

### Task 10: 最終提交與版本遞增

**Files:**
- Modify: `index.html` — 遞增 `APP_VERSION`
- Modify: `sw.js` — 同步 `APP_VERSION`，遞增 `CACHE_VERSION`

- [ ] **Step 1: 版本遞增**

按 CLAUDE.md 慣例，遞增 `APP_VERSION`（semver minor bump），同步 `index.html` 和 `sw.js`，更新 `?v=` 查詢參數。

- [ ] **Step 2: 執行所有測試**

```bash
cd server && node --test __tests__/*.test.js
```

Expected: 全部 PASS

- [ ] **Step 3: 最終 Commit**

```bash
git add index.html sw.js
git commit -m "chore: 遞增版本號至 v1.x.0（headless browser URL 抓取）"
```
