# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

MarkItDown Website — 瀏覽器端的檔案轉 Markdown 工具，使用 Pyodide（Python WASM）。檔案轉換完全在客戶端執行；網址轉換則透過 Node.js 後端代理取得網頁內容。

## 開發指令

```bash
# 下載 Pyodide runtime 及 Python wheels（約 400MB，僅需執行一次）
python scripts/download_wheels.py

# 啟動開發伺服器（Nginx + Browser-sync 熱重載 + Node.js 代理）
docker compose -f docker-compose-dev.yml up
# 開啟 http://localhost:3000

# 執行伺服器端測試（Node.js 內建測試框架）
cd server && npm test

# 正式環境 Docker 建置
docker compose up
# 開啟 http://localhost:8080
```

## 架構

**雙層設計**：靜態前端（瀏覽器內 Pyodide）+ Node.js API 代理。

- **前端**（`index.html`、`css/style.css`、`js/main.js`）：單頁應用程式，兩種狀態——上傳頁面與結果頁面。支援拖放上傳與網址輸入。
- **Web Worker**（`js/converter.worker.js`）：在背景執行緒中執行 Pyodide + markitdown。透過 `postMessage` 與主執行緒通訊。使用 `micropip` 搭配 `deps=False` 從 `wheels/manifest.json` 載入 wheel。
- **Node.js 代理**（`server/index.js`、`server/fetch-url.js`）：Express 伺服器，監聽 port 3002。提供 `POST /api/fetch-url`，含 SSRF 防護、10MB 大小限制、15 秒逾時及速率限制。
- **Nginx**：提供靜態檔案服務，並將 `/api/` 反向代理至 Node.js。需設定 COOP/COEP 標頭以啟用 SharedArrayBuffer。
- **Service Worker**（`sw.js`）：離線快取——UI 資源使用 stale-while-revalidate，pyodide/wheels 使用 cache-first。修改 `CACHE_VERSION` 即可強制清除舊快取。
- **Docker**（`Dockerfile`）：三階段建置（Python builder → Node 依賴 → Alpine runner，含 nginx + node）。

## 重要慣例

- 所有 UI 文字使用繁體中文。
- `pyodide/` 和 `wheels/` 為建置產物，已加入 gitignore。
- 版本字串 `APP_VERSION` 須在 `index.html` 和 `sw.js` 之間保持同步。
- `magika` 套件已被 stub 取代，使 markitdown 回退至副檔名推斷路徑。
- 靜態資源使用 CSS query parameter（`?v=VERSION`）進行快取破壞。
- 功能完成時，須執行快取破壞：遞增 `APP_VERSION`（semver），同步更新 `index.html` 和 `sw.js`；更新 `index.html` 中所有 `?v=` 查詢參數；視情況遞增 `sw.js` 的 `CACHE_VERSION`。

## CI/CD

GitHub Actions（`.github/workflows/docker-publish.yml`）：推送至 `master` 或 semver tag 時，自動建置多平台（amd64/arm64）Docker 映像檔並推送至 Docker Hub（`gonetone/markitdown-website`）。
