# ─────────────────────────────────────────────────────────────────────────────
# 階段一：builder
#   在 Python 環境中執行 download_wheels.py，
#   下載 Pyodide runtime 及 markitdown 相關 wheel 檔案。
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

# 複製建置腳本與必要檔案
COPY scripts/download_wheels.py scripts/download_wheels.py

# 執行建置腳本（下載 pyodide/ 與 wheels/ 目錄）
# 這一層會被 Docker cache，只要腳本未變更即可復用
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
