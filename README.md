# MarkItDown Website

在瀏覽器中將文件轉換為 Markdown，**所有處理完全在本機端進行，不會上傳任何資料至伺服器**。

由 [Microsoft MarkItDown](https://github.com/microsoft/markitdown) 提供轉換核心，透過 [Pyodide](https://pyodide.org/)（Python WebAssembly）在瀏覽器中直接執行 Python。

## 功能特色

- **隱私優先**：文件在瀏覽器內處理，完全離線可用，零伺服器傳輸
- **免安裝**：使用者只需一個瀏覽器，無需安裝任何軟體
- **多格式支援**：PDF、DOCX、XLSX、PPTX、HTML、CSV、EPUB
- **拖放上傳**：支援拖放或點擊選擇檔案
- **即時預覽**：轉換完成後可直接預覽 Markdown 內容並下載 `.md` 檔案

## 快速開始

### 使用 Docker（推薦）

```bash
# 啟動（首次會自動建置映像檔，需下載約 400MB 的 Pyodide runtime）
docker compose up

# 背景執行
docker compose up -d

# 修改程式碼後，強制重新建置映像檔
docker compose up --build
```

啟動後開啟瀏覽器前往 [http://localhost:8080](http://localhost:8080)

> **注意**：首次啟動會自動建置映像檔，需要下載 Pyodide runtime 及 Python wheel 檔案，請確認網路連線正常。建置完成後映像檔會快取所有資源，後續啟動無需重新下載。

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
├── index.html          UI 介面（三態設計：上傳 / 轉換中 / 完成）
├── css/style.css       深色主題樣式
└── js/
    ├── main.js         UI 邏輯、拖放事件、狀態管理
    └── converter.worker.js  Web Worker（背景執行緒）
            │
            ├── Pyodide 0.26.4（Python WASM）
            ├── markitdown 0.1.4（純 Python wheel）
            └── 依賴套件：pdfminer.six、python-docx、openpyxl、python-pptx…
```

### 關鍵技術決策

| 技術 | 說明 |
|------|------|
| **Pyodide** | 在瀏覽器中執行 Python，免伺服器 |
| **Web Worker** | 將 Python 執行移至背景執行緒，避免凍結 UI |
| **micropip + deps=False** | 安裝本地 wheel 並跳過 PyPI 依賴解析 |
| **COOP/COEP 標頭** | SharedArrayBuffer 的瀏覽器安全要求 |
| **magika stub** | 取代無 WASM 版的 magika，讓 markitdown 回退至副檔名推斷路徑 |

## 支援格式

| 格式 | 說明 |
|------|------|
| PDF | 透過 pdfminer.six 解析文字 |
| DOCX | Microsoft Word 文件 |
| XLSX | Microsoft Excel 試算表（轉為 Markdown 表格） |
| PPTX | Microsoft PowerPoint 簡報 |
| HTML / HTM | 網頁原始碼 |
| CSV | 逗號分隔值（轉為 Markdown 表格） |
| EPUB | 電子書格式 |

## 專案結構

```
markitdown-website/
├── index.html                  主頁面
├── css/
│   └── style.css               樣式表
├── js/
│   ├── main.js                 UI 邏輯
│   └── converter.worker.js     轉換 Web Worker
├── scripts/
│   ├── download_wheels.py      建置腳本（下載 Pyodide + wheels）
│   └── dev_server.py           本地開發伺服器
├── docker/
│   └── nginx.conf              Docker 用 Nginx 設定
├── examples/
│   └── nginx.conf              一般部署用 Nginx 設定範本
├── Dockerfile                  多階段 Docker 建置
├── docker-compose.yml          Docker Compose 設定
└── .gitignore
```

> `pyodide/` 和 `wheels/` 目錄由建置腳本產生，不納入版本控制。

## 部署（不使用 Docker）

1. 執行建置腳本下載所有資源：
   ```bash
   python scripts/download_wheels.py
   ```

2. 將整個目錄（含 `pyodide/`、`wheels/`）部署至 Nginx

3. 參考 `examples/nginx.conf` 設定虛擬主機，**必須加入以下兩個標頭**：
   ```nginx
   add_header Cross-Origin-Opener-Policy  "same-origin"  always;
   add_header Cross-Origin-Embedder-Policy "require-corp" always;
   ```

## 授權

本專案以 [MIT License](LICENSE) 授權。

轉換核心由 [Microsoft MarkItDown](https://github.com/microsoft/markitdown) 提供，遵循其原始授權條款。

---

❤️使用 [Claude Code](https://github.com/anthropics/claude-code) 開發❤️
