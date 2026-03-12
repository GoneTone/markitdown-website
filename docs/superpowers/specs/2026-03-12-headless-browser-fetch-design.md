# Headless Browser URL 抓取設計規格

## 目標

將 `server/fetch-url.js` 的網頁抓取方式從 Node.js `fetch()` 改為 `puppeteer-core` + `chrome-headless-shell`，使所有 URL 轉換都能取得 JavaScript 渲染後的完整 HTML。

## 背景

目前 URL 抓取使用 Node.js 內建 `fetch()`，只能取得伺服器回傳的原始 HTML。現代網頁大量使用 SPA 框架（React、Vue、Angular 等），實際內容由 JavaScript 動態渲染，`fetch()` 無法取得這些內容。

## 設計

### 技術選型

- **puppeteer-core**：不自帶 Chromium，搭配獨立安裝的 chrome-headless-shell 使用。
- **chrome-headless-shell**：Google 提供的精簡版 headless Chrome，比完整 Chromium 體積小。
- **安裝方式**：透過 `@puppeteer/browsers` CLI 在 Docker 建置時下載，使用 `--install-dir` 指定固定路徑。

### Browser 生命週期

伺服器啟動時 launch 一個共用的 browser instance，每次請求開新 page（tab），請求結束後關閉 page。

```
Server 啟動 → launch browser instance（持續運行）
              ↓
Request 1 → browser.newPage() → 導航 → 取得 HTML → page.close()
Request 2 → browser.newPage() → 導航 → 取得 HTML → page.close()
              ↓
Server 關閉 → browser.close()
```

**並行限制**：使用 semaphore 限制最多 5 個同時開啟的 page，超過時回傳 503。防止高負載下記憶體耗盡。

### 抓取流程（fetchUrlHandler 改動）

1. 驗證 URL 格式與協定（不變）
2. DNS 解析 + SSRF 私有 IP 檢查（不變，在 Puppeteer 導航前執行）
3. 取得 semaphore permit，無可用則回傳 503
4. 開新 page：`browser.newPage()`
5. 設定 `page.setDefaultNavigationTimeout(15000)`
6. 啟用請求攔截以防止重導向至私有 IP（見安全防護章節）
7. 導航至目標 URL：`page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 })`
8. 檢查 response：若 `page.goto()` 回傳 `null`，回傳 502；若 `response.status()` 非 2xx，回傳 502
9. **Content-Type 分流**：檢查 `response.headers()['content-type']`
   - 若為 HTML（`text/html`）→ 走 headless 渲染路徑（步驟 10）
   - 若為非 HTML（PDF、圖片等）→ 走直接下載路徑（步驟 11）
10. **HTML 路徑**：`page.content()` 取得渲染後 HTML → 檢查大小 → 回傳 `Content-Type: text/html` + HTML bytes
11. **非 HTML 路徑**：關閉 page，改用 `fetch()` 直接下載原始二進位內容（複用現有的串流回傳 + 大小檢查邏輯）→ 回傳原始 `Content-Type` + 二進位 bytes
12. `finally` 區塊：確保 `page.close()`（若尚未關閉）+ 釋放 semaphore permit

### 回傳格式

根據目標資源的 Content-Type 分流：

- **HTML 資源**：`Content-Type: text/html; charset=utf-8` + `X-Original-Url` header + 渲染後 HTML 字串
- **非 HTML 資源**（PDF、圖片等）：保留原始 `Content-Type` + `X-Original-Url` header + 原始二進位內容（與現行行為一致）

分流判斷點在 `page.goto()` 取得 response 之後，檢查 response 的 `content-type` header。非 HTML 資源會關閉 page 後改用 `fetch()` 直接下載，複用現有的串流回傳與大小檢查邏輯。

前端不需要任何修改。

### 安全防護

| 項目 | 做法 |
|------|------|
| SSRF 防護（初始請求） | 維持現有 `resolveAndCheck()` DNS 預檢，在 Puppeteer 導航前阻擋私有 IP |
| SSRF 防護（重導向） | 使用 `page.setRequestInterception(true)` + `page.on('request')` 攔截所有導航請求，對重導向目標進行 DNS 解析並檢查私有 IP，阻擋則 `request.abort()`，通過則 `request.continue()` |
| 大小限制 | `page.content()` 取得 HTML 後檢查 `Buffer.byteLength(html)` 是否超過 10MB |
| 逾時 | `page.goto()` 設定 `timeout: 15000` + `page.setDefaultNavigationTimeout(15000)` |
| 頁面隔離 | 每次請求使用獨立 page，`finally` 區塊確保 `page.close()` |
| 並行限制 | Semaphore 限制最多 5 個同時頁面，防止記憶體耗盡 |
| Chrome 沙箱 | `--no-sandbox`、`--disable-setuid-sandbox`（Docker 容器內以 root 執行，需要兩者）、`--disable-gpu`、`--disable-dev-shm-usage` |

### Chrome 啟動參數

```javascript
puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/local/bin/chrome-headless-shell',
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-software-rasterizer',
    '--disable-extensions',
  ],
});
```

`executablePath` 透過環境變數 `CHROME_PATH` 設定。Dockerfile 中使用 `@puppeteer/browsers install --install-dir` 安裝後，建立 symlink 至 `/usr/local/bin/chrome-headless-shell` 以簡化路徑管理。

### 錯誤處理

| 情境 | HTTP 回應 |
|------|-----------|
| 導航逾時 | 408 `請求超時（15 秒）` |
| 導航失敗（DNS、連線錯誤等） | 502 `無法連線至目標伺服器：<message>` |
| `page.goto()` 回傳 null | 502 `無法取得頁面回應` |
| HTTP 錯誤回應（4xx/5xx） | 502 `目標伺服器回應錯誤：<status>` |
| SSRF 重導向攔截 | 403 `不允許存取內部網路位址` |
| HTML 超過 10MB | 413 `回應過大，上限為 10MB` |
| Browser instance 不可用 | 503 `瀏覽器引擎暫時無法使用` |
| 並行頁面數已滿 | 503 `伺服器忙碌中，請稍後再試` |

### 異常恢復

若 browser instance 意外崩潰，下次請求進來時偵測到 `browser.isConnected() === false`，自動重新 launch。使用 mutex 確保只有一個請求執行 relaunch，其他並行請求等待 relaunch 完成或收到 503。

## Docker 變更

### Runner stage 改用 Debian slim

從 `node:lts-alpine` 改為 `node:20-slim`，因為 chrome-headless-shell 需要 glibc 和相關系統函式庫。

### 新增的系統依賴

chrome-headless-shell 所需的最小系統函式庫：

```dockerfile
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
```

### server-deps stage 變更

同樣改為 Debian-based image（`node:20-slim`），並在此階段用 `@puppeteer/browsers` 下載 chrome-headless-shell：

```dockerfile
FROM node:20-slim AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --production
# @puppeteer/browsers 會安裝至 <install-dir>/chrome-headless-shell/<platform>-<buildId>/ 巢狀目錄
# 安裝後建立 symlink 指向實際二進位檔，方便 CHROME_PATH 引用
RUN npx @puppeteer/browsers install chrome-headless-shell@stable --install-dir /app/chrome-hs \
    && ln -s /app/chrome-hs/chrome-headless-shell/*/chrome-headless-shell /usr/local/bin/chrome-headless-shell
```

### Nginx 設定

從 `apk add nginx` 改為 `apt-get install nginx`。

- 移除 Debian 預設設定：`rm -f /etc/nginx/sites-enabled/default`
- 複製設定檔至：`/etc/nginx/conf.d/markitdown.conf`

### server/package.json 變更

新增依賴：

```json
{
  "dependencies": {
    "express": "^4.21.0",
    "express-rate-limit": "^7.5.0",
    "puppeteer-core": "^24.0.0"
  }
}
```

### 多架構支援

`chrome-headless-shell@stable` 同時支援 `linux/amd64` 和 `linux/arm64`，CI/CD 的多平台建置（amd64/arm64）不受影響。`@puppeteer/browsers` 會自動下載對應平台的二進位檔。

### 環境變數

在 Dockerfile 中設定 `CHROME_PATH` 環境變數指向 chrome-headless-shell 的安裝路徑：

```dockerfile
ENV CHROME_PATH=/usr/local/bin/chrome-headless-shell
```

## 不變的部分

- 前端程式碼（`index.html`、`js/main.js`、`css/style.css`）：零修改
- Express 路由結構、Rate limiting、健康檢查端點
- API 路徑 `GET /api/fetch-url?url=<encoded_url>`（Nginx 反向代理至 Node.js 的 `/fetch-url`）
- `sw.js`、`manifest.json`

## 變更檔案清單

| 檔案 | 動作 | 說明 |
|------|------|------|
| `server/fetch-url.js` | 修改 | 抓取邏輯改用 puppeteer-core，新增 SSRF 重導向攔截、semaphore |
| `server/index.js` | 修改 | 啟動時 launch browser，關閉時 close browser，匯出 browser getter |
| `server/package.json` | 修改 | 新增 puppeteer-core 依賴 |
| `Dockerfile` | 修改 | Runner/server-deps 改用 Debian slim，安裝 chrome-headless-shell 及系統依賴 |
| `docker/start.sh` | 可能修改 | 視 nginx 路徑是否需要調整 |
| `server/__tests__/*.test.js` | 修改 | 更新測試 mock 方式 |
