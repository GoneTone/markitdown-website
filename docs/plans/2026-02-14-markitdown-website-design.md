# MarkItDown Website — 設計文件

**日期：** 2026-02-14
**狀態：** 已確認

## 目標

建立一個純靜態網站，讓使用者可以在瀏覽器中上傳文件，透過 Pyodide（Python WebAssembly）執行 MarkItDown 轉換，並下載結果的 Markdown 檔案。所有文件處理完全在客戶端進行，伺服器只提供靜態檔案。

## 技術棧

- **前端：** 純 HTML + CSS + JavaScript（無框架）
- **Python 執行環境：** Pyodide（CPython 編譯為 WebAssembly）
- **轉換函式庫：** Microsoft MarkItDown
- **執行緒模型：** Web Worker（避免 UI 凍結）
- **部署：** Nginx 靜態托管

## 支援的文件格式

| 格式 | 副檔名 | Python 依賴 |
|------|--------|-------------|
| PDF | .pdf | pdfminer.six（純 Python） |
| Word | .docx | python-docx |
| Excel | .xlsx | openpyxl |
| PowerPoint | .pptx | python-pptx |
| HTML | .html, .htm | html2text, beautifulsoup4 |
| CSV / JSON / XML | .csv, .json, .xml | 標準函式庫 |
| EPUB | .epub | ebooklib |

## 目錄結構

```
markitdown-website/
├── index.html                   # 主頁面
├── css/
│   └── style.css                # 深色主題樣式
├── js/
│   ├── main.js                  # UI 互動邏輯
│   └── converter.worker.js      # Web Worker（執行 Pyodide + MarkItDown）
├── pyodide/                     # Pyodide runtime（由建置腳本下載）
├── wheels/                      # Python 套件 wheels（由建置腳本下載）
├── scripts/
│   └── download_wheels.py       # 建置腳本（含詳細中文說明）
├── nginx.conf                   # Nginx 設定範本
└── docs/
    └── plans/
        └── 2026-02-14-markitdown-website-design.md
```

## 架構設計

### 資料流

```
使用者上傳檔案
    → FileReader.readAsArrayBuffer()
    → postMessage({ file: ArrayBuffer, name: filename }) → Web Worker
        → io.BytesIO(bytes)
        → MarkItDown().convert(stream)
        → result.text_content
    → postMessage({ markdown: string }) → 主執行緒
    → 預覽顯示 + 觸發 .md 下載
```

### Web Worker 初始化順序

```
importScripts('/pyodide/pyodide.js')
→ loadPyodide({ indexURL: '/pyodide/' })
→ await micropip.install([所有 wheel 路徑])
→ postMessage({ type: 'ready' })
```

### Nginx 必要設定

Pyodide 使用 SharedArrayBuffer，需要以下 HTTP 回應標頭：

```nginx
add_header Cross-Origin-Opener-Policy "same-origin";
add_header Cross-Origin-Embedder-Policy "require-corp";
```

以及 WASM 的 MIME type：

```nginx
types {
    application/wasm wasm;
}
```

## UI 設計

### 深色主題

背景色 `#1a1a2e`，主色調 `#16213e`，強調色 `#0f3460` 或亮藍色 `#e94560`。

### 三種畫面狀態

**狀態一：初始**
- 頁面中央大型拖放區（支援拖放與點擊選檔）
- 顯示支援格式清單
- 右上角 Pyodide 初始化狀態指示器（「正在載入轉換引擎...」→「就緒 ✓」）

**狀態二：轉換中**
- 進度指示器取代拖放區
- 顯示目前步驟文字（「解析文件...」、「轉換為 Markdown...」）
- 上傳功能暫時停用

**狀態三：完成**
- 左側：Markdown 原始碼預覽（可捲動 `<pre>` 區塊）
- 右側：「下載 .md 檔案」按鈕 + 「重新轉換」按鈕
- 顯示檔案大小與轉換耗時

### 錯誤處理

- 不支援的副檔名 → 提示支援格式清單，不送入 Worker
- 轉換失敗 → 顯示 Python exception 訊息（方便除錯）
- Pyodide 載入失敗 → 提示需要支援 WebAssembly 的現代瀏覽器

## 建置流程

執行一次建置腳本即可完成所有準備工作：

```bash
python scripts/download_wheels.py
```

腳本會：
1. 下載指定版本的 Pyodide runtime 並解壓至 `pyodide/`
2. 使用 `pip download` 下載所有必要的 Python wheel 檔案至 `wheels/`
3. 過濾掉 Pyodide 已內建的套件（避免版本衝突）
4. 列印每個步驟的執行狀態

腳本內含詳細的中文說明與錯誤提示，不需要 Python 開發經驗即可操作。

## 部署

建置完成後，將整個目錄部署至 Nginx 伺服器：

```bash
# 將目錄複製至伺服器 web root，例如：
/var/www/markitdown-website/
```

使用提供的 `nginx.conf` 範本設定虛擬主機，啟動後即可使用。無需任何後端服務或資料庫。
