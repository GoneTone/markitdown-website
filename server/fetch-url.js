/**
 * fetch-url.js — URL 抓取路由
 *
 * GET /fetch-url?url=<encoded_url>
 *
 * 成功：回傳原始內容（binary），附帶 Content-Type 和 X-Original-Url headers
 * 失敗：回傳 JSON { error: '...' } 搭配對應 HTTP status code
 */

const { URL } = require('node:url');
const dns = require('node:dns/promises');
const { ensureBrowser, isDirectDownloadType, DIRECT_DOWNLOAD_TYPES } = require('./browser');
const { pageSemaphore } = require('./semaphore-instance');

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const TIMEOUT = 15_000; // 15 seconds
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 MarkItDown-Proxy/1.0';

// 支援轉換的 MIME type 白名單（從 DIRECT_DOWNLOAD_TYPES 衍生，加上瀏覽器可渲染的類型）
const SUPPORTED_CONTENT_TYPES = new Set([
  ...DIRECT_DOWNLOAD_TYPES,
  'text/html',
  'application/xhtml+xml',
]);

/**
 * 檢查 Content-Type 是否為支援轉換的類型
 * @param {string} contentType - 原始 Content-Type header（可能含 charset 等參數）
 * @returns {boolean}
 */
function isSupportedContentType(contentType) {
  if (!contentType) return false;
  const mime = contentType.split(';')[0].trim().toLowerCase();
  return SUPPORTED_CONTENT_TYPES.has(mime);
}

// 私有 IP 範圍（SSRF 防護）
const PRIVATE_RANGES = [
  // IPv4
  { prefix: '127.', exact: false },
  { prefix: '10.', exact: false },
  { prefix: '0.', exact: false },
  // 172.16.0.0 - 172.31.255.255
  { check: (ip) => {
    const m = ip.match(/^172\.(\d+)\./);
    return m && +m[1] >= 16 && +m[1] <= 31;
  }},
  { prefix: '192.168.', exact: false },
  { prefix: '169.254.', exact: false },
  // IPv6
  { exact: '::1' },
  { exact: '::' },
  { prefix: 'fe80:', exact: false },
  { prefix: 'fc00:', exact: false },
  { prefix: 'fd', exact: false },
];

function isPrivateIP(ip) {
  for (const range of PRIVATE_RANGES) {
    if (range.check && range.check(ip)) return true;
    if (range.exact === true) continue; // skip, handled by prefix
    if (range.exact && ip === range.exact) return true;
    if (range.prefix && !range.exact && ip.startsWith(range.prefix)) return true;
  }
  return false;
}

/**
 * 驗證 URL 格式與協定
 * @param {string} urlString
 * @returns {{ url: URL } | { error: string, status: number }}
 */
function validateUrl(urlString) {
  if (!urlString) {
    return { error: '缺少 url 參數', status: 400 };
  }

  let url;
  try {
    url = new URL(urlString);
  } catch {
    return { error: '無效的 URL 格式', status: 400 };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: '只允許 http 和 https 協定', status: 400 };
  }

  return { url };
}

/**
 * DNS 解析並檢查是否為私有 IP
 * @param {string} hostname
 * @returns {Promise<{ addresses: string[] } | { error: string, status: number }>}
 */
async function resolveAndCheck(hostname) {
  try {
    const { address } = await dns.lookup(hostname);
    if (isPrivateIP(address)) {
      return { error: '不允許存取內部網路位址', status: 403 };
    }
    return { addresses: [address] };
  } catch {
    return { error: '無法解析主機名稱', status: 502 };
  }
}

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
  // 白名單檢查（ERR_ABORTED fallback 進入時尚未經過 fetchUrlHandler 的檢查）
  if (!isSupportedContentType(contentType)) {
    const mime = contentType.split(';')[0].trim().toLowerCase();
    return res.status(415).json({ error: `不支援的內容類型：${mime || '未知'}` });
  }
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

  // 2.5 Content-Type 預檢：偵測二進位檔案，直接走 streamDownload 跳過 Puppeteer
  //     使用 GET + 立即中斷，避免 HEAD 被伺服器忽略或阻擋
  try {
    const probeController = new AbortController();
    const probeTimer = setTimeout(() => probeController.abort(), 3000);
    const probeRes = await fetch(url.href, {
      signal: probeController.signal,
      headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-0' },
      redirect: 'follow',
    });
    probeController.abort(); // 收到 headers 即中斷，不下載 body
    clearTimeout(probeTimer);
    const probeContentType = probeRes.headers.get('content-type') || '';
    if (isDirectDownloadType(probeContentType)) {
      return streamDownload(url, res);
    }
  } catch {
    // 預檢失敗（超時、不支援等）不影響流程，繼續走 Puppeteer 路徑
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
      // chrome-headless-shell 無法處理 PDF 等二進位內容，會觸發 ERR_ABORTED
      // 降級為 streamDownload 直接下載
      if (err.message.includes('net::ERR_ABORTED') || err.message.includes('net::ERR_HTTP2_PROTOCOL_ERROR')) {
        await page.close();
        page = null;
        return streamDownload(url, res);
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
    if (!isSupportedContentType(responseContentType)) {
      const mime = responseContentType.split(';')[0].trim().toLowerCase();
      return res.status(415).json({ error: `不支援的內容類型：${mime || '未知'}` });
    }
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

    // 取得頁面標題供前端作為檔名
    const pageTitle = await page.title();

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('X-Original-Url', url.href);
    if (pageTitle) {
      res.set('X-Page-Title', encodeURIComponent(pageTitle));
    }
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

module.exports = { fetchUrlHandler, validateUrl, isPrivateIP, resolveAndCheck, isSupportedContentType };
