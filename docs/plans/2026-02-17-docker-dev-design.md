# Docker 開發環境設計文件

**日期：** 2026-02-17
**狀態：** 已確認

## 目標

新增 `docker-compose-dev.yml`，使用 Nginx + Browser-sync 取代原本的 Python 開發伺服器（`scripts/dev_server.py`），讓本地開發環境與正式環境（Nginx）保持一致，並支援修改 HTML/CSS/JS 後瀏覽器自動重新整理。

## 前置條件

執行 `python scripts/download_wheels.py` 建置腳本，確保 `pyodide/` 和 `wheels/` 目錄已存在。Docker 只負責伺服器，不負責下載套件。

## 新增檔案

| 檔案 | 說明 |
|------|------|
| `docker-compose-dev.yml` | 開發環境 Compose 設定（nginx + browser-sync 兩個服務） |
| `nginx-dev.conf` | 開發用 Nginx 設定（適配 Docker 路徑與 port） |

## 架構

```
開發者瀏覽器
    → http://localhost:3000
    → browser-sync 容器（port 3000/3001）
        ↓ 反向代理
    → nginx 容器（port 80，僅內部）
        ↓ 讀取靜態檔案
    → volume mount（專案根目錄）
```

## docker-compose-dev.yml 服務設計

### nginx 服務
- Image：`nginx:alpine`
- 內部 port 80（不對外暴露）
- Volume：整個專案根目錄 → `/usr/share/nginx/html:ro`
- 使用 `nginx-dev.conf`

### browser-sync 服務
- Image：`node:lts-alpine`
- 啟動指令：`npx --yes browser-sync start --proxy "nginx:80" --files "*.html,css/**,js/**" --no-open --port 3000`
- 對外暴露：`3000`（HTTP）、`3001`（WebSocket 重載通知）
- Volume：專案根目錄 → `/app:ro`（供 watcher 監聽檔案變動）
- 依賴 nginx 服務

### 監聽範圍

只監聽以下路徑（不監聽 `pyodide/` 與 `wheels/` 以避免大量檔案拖慢 watcher）：
- `*.html`
- `css/**`
- `js/**`

## nginx-dev.conf

與正式版 `nginx.conf` 的差異：
- `root` 路徑改為 `/usr/share/nginx/html`（Docker 內路徑）
- 移除 `server_name`（開發環境不需要）
- 保留所有 COOP/COEP headers（Pyodide/SharedArrayBuffer 需要）
- 保留 WASM MIME type

## 使用方式

```bash
# 1. 確認已執行建置腳本（只需一次）
python scripts/download_wheels.py

# 2. 啟動開發環境
docker compose -f docker-compose-dev.yml up

# 3. 開啟瀏覽器
# http://localhost:3000

# 4. 停止
# Ctrl+C，或另一個終端機執行：
docker compose -f docker-compose-dev.yml down
```

## 關於原有 dev_server.py

`scripts/dev_server.py` 保留作為備用（不刪除），適用於無 Docker 環境的情況。
