# Docker 開發環境實作計畫

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新增 `docker-compose-dev.yml` 與 `nginx-dev.conf`，以 Nginx + Browser-sync 取代 Python 開發伺服器，讓本地開發環境與正式環境一致，並支援 HTML/CSS/JS 變更時瀏覽器自動重新整理。

**Architecture:** Nginx 容器（nginx:alpine）提供靜態檔案服務並設定 COOP/COEP headers；Browser-sync 容器（node:lts-alpine）作為 Nginx 前端的反向代理，監聽原始碼變動並透過 WebSocket 通知瀏覽器重新整理。開發者訪問 `http://localhost:3000`。

**Tech Stack:** Docker Compose, nginx:alpine, node:lts-alpine, browser-sync (npx)

---

## Task 1：Nginx 開發設定檔

**Files:**
- Create: `nginx-dev.conf`

**Step 1: 建立 nginx-dev.conf**

```nginx
# nginx-dev.conf — 開發環境 Nginx 設定
# 與正式版 nginx.conf 的差異：
#   - root 改為 /usr/share/nginx/html（Docker 容器內路徑）
#   - 移除 server_name（開發不需要）
#   - 移除快取設定（開發時不快取）
#   - 保留所有 COOP/COEP headers（Pyodide 必要）

server {
    listen 80;

    root /usr/share/nginx/html;
    index index.html;

    # ── 必要：SharedArrayBuffer 安全標頭 ──────────────────────────────────
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;

    # ── MIME Types ─────────────────────────────────────────────────────────
    types {
        text/html                             html htm;
        text/css                              css;
        application/javascript                js mjs;
        application/json                      json;
        application/wasm                      wasm;
        application/octet-stream              whl;
    }

    # pyodide/ 和 wheels/ 靜態資源加上 CORP header（browser-sync 代理需要）
    location ~* ^/(pyodide|wheels)/ {
        add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
        add_header Cross-Origin-Resource-Policy "same-origin" always;
    }

    # 所有路由回到 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    server_tokens off;
}
```

**Step 2: 確認格式正確（目視檢查）**

確認：
- `listen 80;` 在最上方
- `add_header Cross-Origin-Opener-Policy` 與 `add_header Cross-Origin-Embedder-Policy` 兩行都存在
- `application/wasm wasm;` 在 types 區塊中

**Step 3: Commit**

```bash
git add nginx-dev.conf
git commit -m "feat: add nginx-dev.conf for Docker development environment"
```

---

## Task 2：docker-compose-dev.yml

**Files:**
- Create: `docker-compose-dev.yml`

**Step 1: 建立 docker-compose-dev.yml**

```yaml
# docker-compose-dev.yml — 本地開發環境
#
# 使用方式：
#   docker compose -f docker-compose-dev.yml up
#
# 前置條件：
#   先執行 python scripts/download_wheels.py 確保 pyodide/ 和 wheels/ 已存在
#
# 開啟瀏覽器：http://localhost:3000
# 停止：Ctrl+C 或 docker compose -f docker-compose-dev.yml down

services:
  nginx:
    image: nginx:alpine
    volumes:
      # 整個專案目錄掛載為 nginx 的 web root（唯讀）
      - .:/usr/share/nginx/html:ro
      # 使用開發專用的 nginx 設定
      - ./nginx-dev.conf:/etc/nginx/conf.d/default.conf:ro
    # nginx 只在內部網路暴露，不對外開放（由 browser-sync 代理）
    expose:
      - "80"
    networks:
      - dev-network

  browser-sync:
    image: node:lts-alpine
    working_dir: /app
    # browser-sync 作為 nginx 的反向代理，並監聽檔案變動
    # --proxy nginx:80    → 將請求代理至 nginx 容器
    # --files            → 監聽這些路徑的變動（不監聽 pyodide/ 和 wheels/）
    # --no-open          → 不自動開啟瀏覽器（在容器內無意義）
    # --port 3000        → browser-sync HTTP port
    command: >
      npx --yes browser-sync start
      --proxy "nginx:80"
      --files "*.html,css/**,js/**"
      --no-open
      --port 3000
    volumes:
      # 掛載專案目錄供 browser-sync watcher 監聽（唯讀）
      - .:/app:ro
    ports:
      - "3000:3000"   # HTTP（開啟瀏覽器訪問此 port）
      - "3001:3001"   # WebSocket（browser-sync 重載通知用）
    depends_on:
      - nginx
    networks:
      - dev-network

networks:
  dev-network:
    driver: bridge
```

**Step 2: Commit**

```bash
git add docker-compose-dev.yml
git commit -m "feat: add docker-compose-dev.yml with nginx and browser-sync"
```

---

## Task 3：驗證

**前置條件：** 確認 Docker Desktop 已啟動，且 `pyodide/` 與 `wheels/` 目錄存在（若不存在，先執行 `python scripts/download_wheels.py`）

**Step 1: 啟動開發環境**

```bash
docker compose -f docker-compose-dev.yml up
```

預期輸出（前幾秒）：
```
[+] Running 2/2
 ✔ Container markitdown-website-nginx-1          Started
 ✔ Container markitdown-website-browser-sync-1   Started
...
browser-sync-1  | [Browsersync] Proxying: http://nginx:80
browser-sync-1  | [Browsersync] Access URLs:
browser-sync-1  |  Local: http://localhost:3000
```

**Step 2: 開啟瀏覽器確認**

開啟 `http://localhost:3000`，確認：
1. 頁面正常顯示（深色主題 MarkItDown 介面）
2. 右上角顯示「正在載入轉換引擎...」→「就緒」
3. DevTools → Console 無 JavaScript 錯誤
4. DevTools → Network → Response Headers 包含：
   - `Cross-Origin-Opener-Policy: same-origin`
   - `Cross-Origin-Embedder-Policy: require-corp`

**Step 3: 驗證熱重載**

1. 開著瀏覽器，編輯 `index.html`（例如修改 `<title>` 文字）
2. 儲存檔案
3. 確認瀏覽器在 1-2 秒內自動重新整理

**Step 4: 驗證靜態資源正確提供**

在 DevTools → Network 確認：
- `pyodide/pyodide.js` 回應狀態 200
- `pyodide/pyodide.asm.wasm` 回應狀態 200，Content-Type 為 `application/wasm`
- `wheels/manifest.json` 回應狀態 200

**Step 5: 停止環境**

```bash
# Ctrl+C 停止，或另開終端機執行：
docker compose -f docker-compose-dev.yml down
```

預期輸出：
```
[+] Running 3/3
 ✔ Container markitdown-website-browser-sync-1  Removed
 ✔ Container markitdown-website-nginx-1         Removed
 ✔ Network markitdown-website-dev-network       Removed
```

---

## 備註：.gitignore 更新

若專案 `.gitignore` 尚未存在（執行 Task 8 之前），暫時不需要更新。若已存在，`docker-compose-dev.yml` 應該提交至 git（不需排除）。
