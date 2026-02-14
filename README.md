# MarkItDown Website

[![GitHub](https://img.shields.io/badge/GitHub-GoneTone%2Fmarkitdown--website-181717?logo=github)](https://github.com/GoneTone/markitdown-website)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Docker Hub](https://img.shields.io/badge/Docker%20Hub-gonetone%2Fmarkitdown--website-2496ED?logo=docker&logoColor=white)](https://hub.docker.com/r/gonetone/markitdown-website)

在瀏覽器中將文件轉換為 Markdown，**所有處理完全在本機端進行，不會上傳任何資料至伺服器**。

本專案以 MIT License 開源於 [GitHub](https://github.com/GoneTone/markitdown-website)，歡迎提交 Issue 或 Pull Request。

由 [Microsoft MarkItDown](https://github.com/microsoft/markitdown) 提供轉換核心，透過 [Pyodide](https://pyodide.org/)（Python WebAssembly）在瀏覽器中直接執行 Python。

## 功能特色

- **隱私優先**：文件在瀏覽器內處理，完全離線可用，零伺服器傳輸
- **免安裝**：使用者只需一個瀏覽器，無需安裝任何軟體
- **多格式支援**：PDF、DOCX、XLSX、PPTX、HTML、CSV、EPUB
- **拖放上傳**：支援拖放或點擊選擇檔案
- **即時預覽**：轉換完成後可直接預覽 Markdown 內容並下載 `.md` 檔案

## 快速開始

### 使用 Docker（推薦）

下載 [docker-compose.yml](docker-compose.yml) 後執行：

```bash
# 啟動（首次會自動從 Docker Hub 拉取映像檔）
docker compose up

# 背景執行
docker compose up -d

# 停止
docker compose down
```

`docker-compose.yml` 內容如下，可依需求調整 port：

```yaml
services:
  markitdown:
    image: gonetone/markitdown-website:latest
    container_name: markitdown-website
    ports:
      - "8080:80"
    restart: unless-stopped
```

啟動後開啟瀏覽器前往 [http://localhost:8080](http://localhost:8080)

### 本地開發

**環境需求：** Python 3.10+

```bash
# 1. 下載 Pyodide runtime 及 wheel 套件（僅需執行一次，約 400MB）
python scripts/download_wheels.py

# 2. 啟動本地測試伺服器（包含必要的 COOP/COEP 安全標頭）
python scripts/dev_server.py

# 3. 開啟瀏覽器前往 http://localhost:8080
```

## 技術架構

```
瀏覽器
├── index.html               UI 介面（三態設計：上傳 / 轉換中 / 完成）
├── css/style.css            深色主題樣式
└── js/
    ├── main.js              UI 邏輯、拖放事件、狀態管理
    └── converter.worker.js  Web Worker（背景執行緒）
            │
            ├── Pyodide 0.26.4（Python WASM）
            ├── markitdown 0.1.4（純 Python wheel）
            └── 依賴套件：pdfminer.six、python-docx、openpyxl、python-pptx…
```

### 關鍵技術決策

| 技術                        | 說明                                         |
|---------------------------|--------------------------------------------|
| **Pyodide**               | 在瀏覽器中執行 Python，免伺服器                        |
| **Web Worker**            | 將 Python 執行移至背景執行緒，避免凍結 UI                 |
| **micropip + deps=False** | 安裝本地 wheel 並跳過 PyPI 依賴解析                   |
| **COOP/COEP 標頭**          | SharedArrayBuffer 的瀏覽器安全要求                 |
| **magika stub**           | 取代無 WASM 版的 magika，讓 markitdown 回退至副檔名推斷路徑 |

## 支援格式

| 格式         | 說明                                  |
|------------|-------------------------------------|
| PDF        | 透過 pdfminer.six 解析文字                |
| DOCX       | Microsoft Word 文件                   |
| XLSX       | Microsoft Excel 試算表（轉為 Markdown 表格） |
| PPTX       | Microsoft PowerPoint 簡報             |
| HTML / HTM | 網頁原始碼                               |
| CSV        | 逗號分隔值（轉為 Markdown 表格）               |
| EPUB       | 電子書格式                               |

## 專案結構

```
markitdown-website/
├── index.html                    主頁面
├── css/
│   └── style.css                 樣式表
├── js/
│   ├── main.js                   UI 邏輯
│   └── converter.worker.js       轉換 Web Worker
├── scripts/
│   ├── download_wheels.py        建置腳本（下載 Pyodide + wheels）
│   └── dev_server.py             本地開發伺服器
├── docker/
│   └── nginx.conf                Docker 用 Nginx 設定
├── examples/
│   ├── nginx.conf                一般部署用 Nginx 設定範本
│   └── nginx-reverse-proxy.conf  Nginx 反向代理範本（Docker + SSL）
├── .github/
│   └── workflows/
│       └── docker-publish.yml    CI/CD：自動建置並推送至 Docker Hub
├── Dockerfile                    多階段 Docker 建置
├── docker-compose.yml            Docker Compose 設定
├── .dockerignore
└── .gitignore
```

> `pyodide/` 和 `wheels/` 目錄由建置腳本產生，不納入版本控制。

## 反向代理（Docker + SSL）

若需要 HTTPS 或在同一台伺服器上架設多個服務，可在 Docker 容器前加一層 Nginx 反向代理。

參考 [examples/nginx-reverse-proxy.conf](examples/nginx-reverse-proxy.conf)，修改 `server_name` 和 SSL 憑證路徑後套用即可。

> COOP/COEP 安全標頭已由容器內的 Nginx 設定，反向代理層直接透傳，**不需要重複設定**。

## 部署（不使用 Docker）

1. 執行建置腳本下載所有資源：
   ```bash
   python scripts/download_wheels.py
   ```

2. 將整個目錄（含 `pyodide/`、`wheels/`）部署至 Nginx

3. 參考 [examples/nginx.conf](examples/nginx.conf) 設定虛擬主機，**必須加入以下兩個標頭**：
   ```nginx
   add_header Cross-Origin-Opener-Policy  "same-origin"  always;
   add_header Cross-Origin-Embedder-Policy "require-corp" always;
   ```

## 授權

本專案以 [MIT License](LICENSE) 授權。

轉換核心由 [Microsoft MarkItDown](https://github.com/microsoft/markitdown) 提供，遵循其原始授權條款。

---

❤️使用 [Claude Code](https://github.com/anthropics/claude-code) 開發❤️
