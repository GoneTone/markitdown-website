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
# 階段二：runner
#   使用 nginx:alpine 提供靜態檔案服務。
#   只複製必要的靜態資源，不含 Python 環境。
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:alpine AS runner

# 移除預設的 nginx 設定
RUN rm /etc/nginx/conf.d/default.conf

# 複製 Docker 專用的 nginx 設定
COPY docker/nginx.conf /etc/nginx/conf.d/markitdown.conf

# 複製靜態網站檔案
COPY index.html     /usr/share/nginx/html/index.html
COPY css/           /usr/share/nginx/html/css/
COPY js/            /usr/share/nginx/html/js/

# 從 builder 階段複製下載好的 Pyodide runtime 和 wheels
COPY --from=builder /build/pyodide/ /usr/share/nginx/html/pyodide/
COPY --from=builder /build/wheels/  /usr/share/nginx/html/wheels/

EXPOSE 80

# 使用前景模式啟動 nginx（容器內標準做法）
CMD ["nginx", "-g", "daemon off;"]
