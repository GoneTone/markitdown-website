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

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const TIMEOUT = 15_000; // 15 seconds
const USER_AGENT = 'MarkItDown-Proxy/1.0 (+https://markitdown.reh.tw/)';

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
 * Express 路由 handler
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

  // 3. 抓取目標 URL
  let response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);

    response = await fetch(url.href, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });

    clearTimeout(timer);
  } catch (err) {
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

  // 4. 檢查 content-length（如果有的話）
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_SIZE) {
    return res.status(413).json({ error: `回應過大（${Math.round(contentLength / 1024 / 1024)}MB），上限為 10MB` });
  }

  // 5. 串流回傳並檢查大小
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  res.set('Content-Type', contentType);
  res.set('X-Original-Url', url.href);

  try {
    const reader = response.body.getReader();
    let totalSize = 0;

    // 使用手動讀取來檢查大小限制
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalSize += value.length;
      if (totalSize > MAX_SIZE) {
        reader.cancel();
        // 如果 headers 已送出就只能斷開連線
        if (res.headersSent) {
          res.destroy();
          return;
        }
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

module.exports = { fetchUrlHandler, validateUrl, isPrivateIP, resolveAndCheck };
