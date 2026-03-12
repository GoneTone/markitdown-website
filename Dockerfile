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
#   安裝 Node.js proxy 的依賴。
# ─────────────────────────────────────────────────────────────────────────────
FROM node:lts-alpine AS server-deps

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --production

# ─────────────────────────────────────────────────────────────────────────────
# 階段三：runner
#   使用 node:lts-alpine + nginx 提供靜態檔案與 API proxy。
# ─────────────────────────────────────────────────────────────────────────────
FROM node:lts-alpine AS runner

# 安裝 nginx
RUN apk add --no-cache nginx

# 移除預設的 nginx 設定
RUN rm -f /etc/nginx/http.d/default.conf

# 複製 Docker 專用的 nginx 設定
COPY docker/nginx.conf /etc/nginx/http.d/markitdown.conf

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

# 從 server-deps 階段複製 Node.js proxy
COPY server/index.js     /app/server/index.js
COPY server/fetch-url.js /app/server/fetch-url.js
COPY --from=server-deps /app/server/node_modules/ /app/server/node_modules/

# 複製啟動腳本
COPY docker/start.sh /app/start.sh
RUN chmod +x /app/start.sh

ENV PORT=3002

EXPOSE 80

CMD ["/app/start.sh"]
