# MarkItDown Website 實作計畫

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 建立純靜態網站，讓使用者透過瀏覽器上傳文件，由 Pyodide（Python WASM）執行 MarkItDown 轉換後下載 Markdown 檔案。

**Architecture:** 純 HTML/CSS/JS 前端，Pyodide 在 Web Worker 中執行以避免 UI 凍結。所有 Python 套件（含 Pyodide runtime）預先由建置腳本下載至伺服器，無需外部 CDN 連線。Nginx 靜態托管並加入 SharedArrayBuffer 所需的 COOP/COEP 標頭。

**Tech Stack:** Pyodide 0.26.4, MarkItDown (markitdown[docx,xlsx,pptx,pdf]), micropip, Web Worker API, Nginx

---

## Task 1：建置腳本

**Files:**
- Create: `scripts/download_wheels.py`

本腳本負責：
1. 下載 Pyodide 0.26.4 完整發行包並解壓至 `pyodide/`
2. 使用 `pip download` 下載 markitdown 及其 Python 依賴 wheel 檔案至 `wheels/`（只保留純 Python wheel，排除平台相依的 C 擴充套件）
3. 產生 `wheels/manifest.json`，供 Web Worker 讀取並安裝套件

**Step 1: 建立腳本檔案**

```python
#!/usr/bin/env python3
"""
MarkItDown Website 建置腳本
============================
此腳本會下載所有必要的檔案，讓網站可以在瀏覽器中離線執行文件轉換。

使用方式：
    python scripts/download_wheels.py

執行前請確認：
    - Python 3.10 或以上版本（輸入 python --version 確認）
    - pip 已安裝（輸入 pip --version 確認）
    - 網路連線（第一次執行需要下載約 400MB 資料）

執行一次即可，檔案會快取在 pyodide/ 和 wheels/ 目錄中。
"""

import os
import sys
import json
import shutil
import subprocess
import urllib.request
import tarfile
from pathlib import Path

# ── 設定 ────────────────────────────────────────────────────────────────────

# Pyodide 版本（如需更新，請至 https://github.com/pyodide/pyodide/releases 確認最新版本）
PYODIDE_VERSION = "0.26.4"

# 根目錄（此腳本的上一層）
ROOT_DIR = Path(__file__).parent.parent.resolve()
PYODIDE_DIR = ROOT_DIR / "pyodide"
WHEELS_DIR = ROOT_DIR / "wheels"
SCRIPTS_DIR = ROOT_DIR / "scripts"

# 需要額外下載的套件（不在 Pyodide 內建套件清單中的純 Python 套件）
EXTRA_PACKAGES = [
    "markitdown[docx,xlsx,pptx,pdf]",
    "html2text",
    "ebooklib",
]

# ── 工具函式 ─────────────────────────────────────────────────────────────────

def log(msg):
    print(f"[建置] {msg}", flush=True)

def check_prerequisites():
    """確認執行環境符合需求。"""
    log("檢查執行環境...")
    if sys.version_info < (3, 10):
        print(f"錯誤：需要 Python 3.10 或以上版本，目前版本為 {sys.version}")
        sys.exit(1)
    log(f"Python {sys.version.split()[0]} ✓")

def download_file(url, dest_path):
    """下載單一檔案並顯示進度。"""
    def reporthook(count, block_size, total_size):
        if total_size > 0:
            percent = min(100, count * block_size * 100 // total_size)
            print(f"\r  下載中... {percent}%", end="", flush=True)

    log(f"下載：{url}")
    urllib.request.urlretrieve(url, dest_path, reporthook)
    print()  # 換行

def download_pyodide():
    """下載 Pyodide 發行包並解壓至 pyodide/ 目錄。"""
    if PYODIDE_DIR.exists() and (PYODIDE_DIR / "pyodide.js").exists():
        log("pyodide/ 目錄已存在，跳過下載。（如需重新下載，請先刪除 pyodide/ 目錄）")
        return

    tarball_name = f"pyodide-{PYODIDE_VERSION}.tar.bz2"
    tarball_path = SCRIPTS_DIR / tarball_name
    url = f"https://github.com/pyodide/pyodide/releases/download/{PYODIDE_VERSION}/{tarball_name}"

    log(f"開始下載 Pyodide {PYODIDE_VERSION}（約 400MB，僅需下載一次）...")
    download_file(url, tarball_path)

    log("解壓縮中...")
    with tarfile.open(tarball_path, "r:bz2") as tar:
        tar.extractall(ROOT_DIR)

    # Pyodide 解壓後目錄名為 "pyodide"，與我們的目標一致
    tarball_path.unlink()
    log(f"Pyodide {PYODIDE_VERSION} 解壓完成 ✓")

def download_extra_wheels():
    """下載 markitdown 及其依賴的純 Python wheel 檔案。"""
    WHEELS_DIR.mkdir(exist_ok=True)

    log("下載 markitdown 及相關套件...")
    tmp_dir = WHEELS_DIR / "_tmp"
    tmp_dir.mkdir(exist_ok=True)

    # 使用 pip download 下載套件（僅下載 wheel 格式）
    cmd = [
        sys.executable, "-m", "pip", "download",
        "--dest", str(tmp_dir),
        "--only-binary=:all:",
        "--quiet",
        *EXTRA_PACKAGES,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"錯誤：pip download 失敗：\n{result.stderr}")
        sys.exit(1)

    # 只保留純 Python wheel（檔名包含 "none-any"，代表無平台相依性）
    kept = []
    skipped = []
    for whl in tmp_dir.glob("*.whl"):
        filename = whl.name
        # 純 Python wheel 的標籤格式：...-py3-none-any.whl 或 ...-cp3xx-none-any.whl
        if "none-any" in filename or filename.endswith("-py3-none-any.whl"):
            dest = WHEELS_DIR / filename
            shutil.move(str(whl), str(dest))
            kept.append(filename)
        else:
            # 平台相依的套件由 Pyodide 內建版本處理，不需要額外下載
            skipped.append(filename)
            whl.unlink()

    shutil.rmtree(tmp_dir)

    if skipped:
        log(f"跳過 {len(skipped)} 個平台相依套件（將使用 Pyodide 內建版本）：")
        for s in skipped:
            log(f"  - {s}")

    log(f"保留 {len(kept)} 個純 Python wheel ✓")
    return kept

def write_manifest(wheel_filenames):
    """產生 wheels/manifest.json，供 Web Worker 讀取。"""
    manifest_path = WHEELS_DIR / "manifest.json"
    manifest = sorted(wheel_filenames)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    log(f"已產生 wheels/manifest.json（共 {len(manifest)} 個套件）✓")

# ── 主程式 ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("  MarkItDown Website 建置腳本")
    print("=" * 60)

    check_prerequisites()
    download_pyodide()

    existing_wheels = [f.name for f in WHEELS_DIR.glob("*.whl")] if WHEELS_DIR.exists() else []
    if existing_wheels:
        log(f"wheels/ 已有 {len(existing_wheels)} 個套件，跳過下載。（如需重新下載，請先刪除 wheels/ 目錄）")
        write_manifest(existing_wheels)
    else:
        new_wheels = download_extra_wheels()
        write_manifest(new_wheels)

    print()
    print("=" * 60)
    print("  建置完成！")
    print()
    print("  後續步驟：")
    print("  1. 將整個目錄部署至 Nginx 伺服器")
    print("  2. 使用 nginx.conf 中的設定範本設定虛擬主機")
    print()
    print("  本地測試（需要 Python）：")
    print("  python -m http.server 8080 --directory .")
    print("  然後開啟 http://localhost:8080")
    print("=" * 60)
```

**Step 2: 確認腳本可執行（不需要立刻執行，等所有檔案建立完成後再執行）**

執行環境確認：
```bash
python --version
pip --version
```
預期輸出：Python 3.10 以上版本

**Step 3: Commit**

```bash
git add scripts/download_wheels.py
git commit -m "feat: add build script to download Pyodide and Python wheels"
```

---

## Task 2：Nginx 設定

**Files:**
- Create: `nginx.conf`

Pyodide 使用 SharedArrayBuffer，必須在 HTTP 回應中加入 COOP/COEP 標頭。

**Step 1: 建立 nginx.conf**

```nginx
# MarkItDown Website - Nginx 設定範本
#
# 使用方式：
#   1. 將此檔案複製至 /etc/nginx/sites-available/markitdown
#   2. 修改 server_name 和 root 路徑
#   3. 建立符號連結：ln -s /etc/nginx/sites-available/markitdown /etc/nginx/sites-enabled/
#   4. 測試設定：nginx -t
#   5. 重新載入：nginx -s reload

server {
    listen 80;
    listen [::]:80;

    # 修改為你的網域或 IP
    server_name your-domain.com;

    # 修改為實際部署路徑
    root /var/www/markitdown-website;
    index index.html;

    # ── 必要：SharedArrayBuffer 安全標頭 ──────────────────────────────────
    # Pyodide 需要這兩個標頭才能使用 SharedArrayBuffer
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;

    # ── MIME Types ─────────────────────────────────────────────────────────
    types {
        text/html                             html htm;
        text/css                              css;
        application/javascript                js;
        application/json                      json;
        application/wasm                      wasm;      # WebAssembly
        application/octet-stream              whl;       # Python wheels
    }

    # ── 快取策略 ───────────────────────────────────────────────────────────
    # pyodide/ 和 wheels/ 內容不會變動，可以積極快取
    location ~* ^/(pyodide|wheels)/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        # 重要：子目錄也需要 COOP/COEP 標頭
        add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
        add_header Cross-Origin-Resource-Policy "same-origin" always;
    }

    # HTML、JS、CSS 不快取（方便更新）
    location ~* \.(html|js|css)$ {
        expires -1;
        add_header Cache-Control "no-cache";
    }

    # 所有路由回到 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # ── 安全性 ─────────────────────────────────────────────────────────────
    # 隱藏 Nginx 版本號
    server_tokens off;
}
```

**Step 2: Commit**

```bash
git add nginx.conf
git commit -m "feat: add Nginx config with COOP/COEP headers for Pyodide"
```

---

## Task 3：Web Worker

**Files:**
- Create: `js/converter.worker.js`

Web Worker 負責載入 Pyodide、安裝套件，並執行 MarkItDown 轉換。

**Step 1: 建立 js/converter.worker.js**

```javascript
/**
 * converter.worker.js
 * Web Worker：在背景執行緒載入 Pyodide 並執行 MarkItDown 文件轉換。
 *
 * 與主執行緒的訊息協定：
 *   接收 { type: 'convert', file: ArrayBuffer, filename: string }
 *   傳送 { type: 'ready' }                          → 初始化完成
 *   傳送 { type: 'progress', message: string }      → 進度更新
 *   傳送 { type: 'result', markdown: string }       → 轉換成功
 *   傳送 { type: 'error', message: string }         → 轉換失敗
 */

importScripts('/pyodide/pyodide.js');

let pyodide = null;
let isReady = false;

/** 傳送進度訊息至主執行緒 */
function sendProgress(message) {
  self.postMessage({ type: 'progress', message });
}

/** 初始化 Pyodide 並安裝所有套件 */
async function initialize() {
  try {
    sendProgress('正在載入 Python 執行環境...');
    pyodide = await loadPyodide({
      indexURL: '/pyodide/',
    });

    sendProgress('正在載入套件管理器...');
    await pyodide.loadPackage('micropip');
    const micropip = pyodide.pyimport('micropip');

    sendProgress('正在讀取套件清單...');
    const response = await fetch('/wheels/manifest.json');
    if (!response.ok) {
      throw new Error(`無法讀取套件清單：${response.status} ${response.statusText}`);
    }
    const manifest = await response.json();

    if (manifest.length === 0) {
      throw new Error('wheels/manifest.json 為空，請重新執行建置腳本');
    }

    sendProgress(`正在安裝 ${manifest.length} 個套件...`);
    const wheelUrls = manifest.map(filename => `/wheels/${filename}`);

    // 安裝所有套件（micropip 會自動處理依賴順序）
    await micropip.install(wheelUrls);

    sendProgress('正在初始化 MarkItDown...');
    // 預先 import 以確認安裝成功
    await pyodide.runPythonAsync(`
import io
import os
import tempfile
from markitdown import MarkItDown

# 建立 MarkItDown 實例（關閉所有需要外部 API 的功能）
_md = MarkItDown(enable_plugins=False)
print("MarkItDown 初始化成功")
    `);

    isReady = true;
    self.postMessage({ type: 'ready' });

  } catch (err) {
    self.postMessage({
      type: 'error',
      message: `初始化失敗：${err.message}\n\n請確認建置腳本已成功執行，且瀏覽器支援 WebAssembly。`,
    });
  }
}

/** 執行文件轉換 */
async function convertFile(fileBuffer, filename) {
  if (!isReady || !pyodide) {
    throw new Error('Pyodide 尚未完成初始化');
  }

  sendProgress('解析文件中...');

  // 將 ArrayBuffer 傳入 Python
  pyodide.globals.set('_file_bytes', new Uint8Array(fileBuffer));
  pyodide.globals.set('_filename', filename);

  sendProgress('轉換為 Markdown...');
  const result = await pyodide.runPythonAsync(`
import io, os, tempfile

# 取得副檔名（含點號，例如 ".pdf"）
_ext = os.path.splitext(_filename)[1].lower()

# 寫入 Pyodide 虛擬檔案系統的暫存檔
_tmp_path = f"/tmp/upload{_ext}"
with open(_tmp_path, "wb") as f:
    f.write(bytes(_file_bytes.tolist()))

# 執行轉換
try:
    _result = _md.convert(_tmp_path)
    _markdown = _result.text_content
finally:
    try:
        os.unlink(_tmp_path)
    except:
        pass

_markdown  # 回傳值
  `);

  return result;
}

/** 處理來自主執行緒的訊息 */
self.onmessage = async (event) => {
  const { type, file, filename } = event.data;

  if (type === 'convert') {
    try {
      const markdown = await convertFile(file, filename);
      self.postMessage({ type: 'result', markdown });
    } catch (err) {
      self.postMessage({
        type: 'error',
        message: `轉換失敗：${err.message}`,
      });
    }
  }
};

// 啟動時立即初始化
initialize();
```

**Step 2: Commit**

```bash
git add js/converter.worker.js
git commit -m "feat: add Web Worker with Pyodide and MarkItDown integration"
```

---

## Task 4：HTML 結構

**Files:**
- Create: `index.html`

**Step 1: 建立 index.html**

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MarkItDown — 文件轉 Markdown</title>
  <link rel="stylesheet" href="/css/style.css" />
</head>
<body>

  <!-- 頁首 -->
  <header class="site-header">
    <div class="header-inner">
      <h1 class="site-title">MarkItDown</h1>
      <p class="site-subtitle">在瀏覽器中將文件轉換為 Markdown</p>
    </div>
    <!-- 引擎狀態指示器 -->
    <div id="engine-status" class="engine-status engine-status--loading" aria-live="polite">
      <span class="status-dot"></span>
      <span id="engine-status-text">正在載入轉換引擎...</span>
    </div>
  </header>

  <!-- 主要內容區域 -->
  <main class="main-content">

    <!-- 狀態一：初始上傳區域 -->
    <section id="state-upload" class="state-section state-section--active">
      <div
        id="drop-zone"
        class="drop-zone"
        role="button"
        tabindex="0"
        aria-label="上傳文件，點擊或拖放至此區域"
      >
        <div class="drop-zone__icon" aria-hidden="true">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <p class="drop-zone__title">拖放文件至此</p>
        <p class="drop-zone__subtitle">或點擊選擇檔案</p>
        <input
          type="file"
          id="file-input"
          class="file-input"
          accept=".pdf,.docx,.xlsx,.pptx,.html,.htm,.csv,.json,.xml,.epub"
          aria-hidden="true"
          tabindex="-1"
        />
      </div>

      <div class="supported-formats">
        <p class="supported-formats__label">支援格式：</p>
        <div class="supported-formats__list">
          <span class="format-badge">PDF</span>
          <span class="format-badge">DOCX</span>
          <span class="format-badge">XLSX</span>
          <span class="format-badge">PPTX</span>
          <span class="format-badge">HTML</span>
          <span class="format-badge">CSV</span>
          <span class="format-badge">JSON</span>
          <span class="format-badge">XML</span>
          <span class="format-badge">EPUB</span>
        </div>
      </div>
    </section>

    <!-- 狀態二：轉換中 -->
    <section id="state-converting" class="state-section" aria-live="polite">
      <div class="converting-container">
        <div class="spinner" aria-hidden="true"></div>
        <p id="converting-message" class="converting-message">準備中...</p>
      </div>
    </section>

    <!-- 狀態三：轉換完成 -->
    <section id="state-result" class="state-section">
      <div class="result-container">
        <div class="result-header">
          <div class="result-meta">
            <span id="result-filename" class="result-filename"></span>
            <span id="result-stats" class="result-stats"></span>
          </div>
          <div class="result-actions">
            <button id="btn-download" class="btn btn--primary" type="button">
              下載 .md 檔案
            </button>
            <button id="btn-reset" class="btn btn--secondary" type="button">
              重新轉換
            </button>
          </div>
        </div>
        <pre id="result-preview" class="result-preview"><code id="result-code"></code></pre>
      </div>
    </section>

    <!-- 錯誤提示 -->
    <div id="error-banner" class="error-banner" role="alert" aria-live="assertive" hidden>
      <div class="error-banner__inner">
        <strong>轉換失敗</strong>
        <p id="error-message"></p>
        <button id="btn-error-dismiss" class="btn btn--small" type="button">關閉</button>
      </div>
    </div>

  </main>

  <!-- 頁尾 -->
  <footer class="site-footer">
    <p>所有文件處理完全在您的瀏覽器中進行，不會上傳至任何伺服器。</p>
    <p>由 <a href="https://github.com/microsoft/markitdown" target="_blank" rel="noopener">Microsoft MarkItDown</a> 提供轉換功能。</p>
  </footer>

  <script src="/js/main.js"></script>
</body>
</html>
```

**Step 2: Commit**

```bash
git add index.html
git commit -m "feat: add HTML structure with three-state UI"
```

---

## Task 5：深色主題 CSS

**Files:**
- Create: `css/style.css`

**Step 1: 建立 css/style.css**

```css
/* MarkItDown Website — 深色主題樣式
   色彩：
     背景      #1a1a2e
     表面      #16213e
     強調      #0f3460
     亮點      #e94560
     文字      #eaeaea
     次要文字  #a0a0b0
*/

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --color-bg:        #1a1a2e;
  --color-surface:   #16213e;
  --color-accent:    #0f3460;
  --color-highlight: #e94560;
  --color-text:      #eaeaea;
  --color-muted:     #a0a0b0;
  --color-border:    #2a2a4a;
  --color-success:   #4caf7d;
  --color-error:     #e94560;

  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 20px;

  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 24px rgba(0, 0, 0, 0.4);
}

html {
  font-size: 16px;
  scroll-behavior: smooth;
}

body {
  background-color: var(--color-bg);
  color: var(--color-text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* ── 頁首 ──────────────────────────────────────────────────────────────── */

.site-header {
  background-color: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  padding: 1rem 2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  box-shadow: var(--shadow-sm);
}

.header-inner {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  flex-wrap: wrap;
}

.site-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-highlight);
  letter-spacing: -0.02em;
}

.site-subtitle {
  font-size: 0.875rem;
  color: var(--color-muted);
}

/* 引擎狀態指示器 */
.engine-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: var(--color-muted);
  padding: 0.375rem 0.75rem;
  border-radius: var(--radius-sm);
  background-color: var(--color-accent);
  transition: background-color 0.3s, color 0.3s;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--color-muted);
  transition: background-color 0.3s;
  flex-shrink: 0;
}

.engine-status--loading .status-dot {
  background-color: #f0a500;
  animation: pulse 1.5s ease-in-out infinite;
}

.engine-status--ready .status-dot {
  background-color: var(--color-success);
  animation: none;
}

.engine-status--ready {
  color: var(--color-success);
}

.engine-status--error .status-dot {
  background-color: var(--color-error);
  animation: none;
}

.engine-status--error {
  color: var(--color-error);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}

/* ── 主要內容 ──────────────────────────────────────────────────────────── */

.main-content {
  flex: 1;
  padding: 3rem 2rem;
  max-width: 960px;
  margin: 0 auto;
  width: 100%;
  position: relative;
}

/* 狀態區塊：預設隱藏 */
.state-section {
  display: none;
}

.state-section--active {
  display: block;
}

/* ── 拖放上傳區域 ──────────────────────────────────────────────────────── */

.drop-zone {
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-lg);
  padding: 4rem 2rem;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, background-color 0.2s, transform 0.1s;
  background-color: var(--color-surface);
  position: relative;
  user-select: none;
}

.drop-zone:hover,
.drop-zone:focus {
  border-color: var(--color-highlight);
  background-color: var(--color-accent);
  outline: none;
}

.drop-zone--dragging {
  border-color: var(--color-highlight);
  background-color: var(--color-accent);
  transform: scale(1.01);
  box-shadow: 0 0 0 4px rgba(233, 69, 96, 0.2);
}

.drop-zone--disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.drop-zone__icon {
  color: var(--color-highlight);
  margin-bottom: 1.25rem;
  display: flex;
  justify-content: center;
}

.drop-zone__title {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.drop-zone__subtitle {
  font-size: 0.9rem;
  color: var(--color-muted);
}

.file-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

/* 支援格式標籤 */
.supported-formats {
  margin-top: 2rem;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.supported-formats__label {
  font-size: 0.85rem;
  color: var(--color-muted);
  margin-right: 0.25rem;
}

.format-badge {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  padding: 0.25rem 0.6rem;
  border-radius: var(--radius-sm);
  background-color: var(--color-accent);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

/* ── 轉換中狀態 ────────────────────────────────────────────────────────── */

.converting-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 6rem 2rem;
  gap: 1.5rem;
}

.spinner {
  width: 48px;
  height: 48px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-highlight);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.converting-message {
  font-size: 1rem;
  color: var(--color-muted);
  text-align: center;
}

/* ── 轉換結果 ──────────────────────────────────────────────────────────── */

.result-container {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
}

.result-meta {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.result-filename {
  font-size: 1rem;
  font-weight: 600;
}

.result-stats {
  font-size: 0.8rem;
  color: var(--color-muted);
}

.result-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.result-preview {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 1.5rem;
  max-height: 60vh;
  overflow-y: auto;
  box-shadow: var(--shadow-sm);
}

.result-preview code {
  font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 0.85rem;
  line-height: 1.7;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 捲軸樣式 */
.result-preview::-webkit-scrollbar {
  width: 6px;
}
.result-preview::-webkit-scrollbar-track {
  background: var(--color-bg);
}
.result-preview::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 3px;
}
.result-preview::-webkit-scrollbar-thumb:hover {
  background: var(--color-muted);
}

/* ── 按鈕 ──────────────────────────────────────────────────────────────── */

.btn {
  padding: 0.6rem 1.25rem;
  border-radius: var(--radius-sm);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background-color 0.15s, transform 0.1s;
  white-space: nowrap;
}

.btn:active {
  transform: scale(0.97);
}

.btn--primary {
  background-color: var(--color-highlight);
  color: #fff;
  border-color: var(--color-highlight);
}

.btn--primary:hover {
  background-color: #d03850;
}

.btn--secondary {
  background-color: transparent;
  color: var(--color-text);
  border-color: var(--color-border);
}

.btn--secondary:hover {
  background-color: var(--color-accent);
}

.btn--small {
  padding: 0.4rem 0.875rem;
  font-size: 0.8rem;
}

/* ── 錯誤提示 ──────────────────────────────────────────────────────────── */

.error-banner {
  position: fixed;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  max-width: 600px;
  width: calc(100% - 2rem);
  z-index: 100;
}

.error-banner[hidden] {
  display: none;
}

.error-banner__inner {
  background-color: #3d1a20;
  border: 1px solid var(--color-error);
  border-radius: var(--radius-md);
  padding: 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  box-shadow: var(--shadow-md);
}

.error-banner strong {
  color: var(--color-error);
  font-size: 1rem;
}

.error-banner p {
  font-size: 0.85rem;
  color: var(--color-text);
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}

/* ── 頁尾 ──────────────────────────────────────────────────────────────── */

.site-footer {
  background-color: var(--color-surface);
  border-top: 1px solid var(--color-border);
  padding: 1.5rem 2rem;
  text-align: center;
  font-size: 0.8rem;
  color: var(--color-muted);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.site-footer a {
  color: var(--color-muted);
  text-decoration: underline;
}

.site-footer a:hover {
  color: var(--color-text);
}

/* ── 響應式 ────────────────────────────────────────────────────────────── */

@media (max-width: 600px) {
  .main-content {
    padding: 1.5rem 1rem;
  }

  .drop-zone {
    padding: 3rem 1.5rem;
  }

  .result-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .site-header {
    padding: 0.75rem 1rem;
  }
}
```

**Step 2: Commit**

```bash
git add css/style.css
git commit -m "feat: add dark theme CSS"
```

---

## Task 6：主要 JavaScript

**Files:**
- Create: `js/main.js`

**Step 1: 建立 js/main.js**

```javascript
/**
 * main.js — UI 邏輯
 *
 * 職責：
 * - 管理 Web Worker 的生命週期
 * - 處理拖放與檔案選擇
 * - 控制三種 UI 狀態（上傳 / 轉換中 / 完成）
 * - 觸發 Markdown 檔案下載
 */

// ── DOM 元素 ──────────────────────────────────────────────────────────────

const engineStatus     = document.getElementById('engine-status');
const engineStatusText = document.getElementById('engine-status-text');
const dropZone         = document.getElementById('drop-zone');
const fileInput        = document.getElementById('file-input');
const convertingMsg    = document.getElementById('converting-message');
const resultFilename   = document.getElementById('result-filename');
const resultStats      = document.getElementById('result-stats');
const resultCode       = document.getElementById('result-code');
const btnDownload      = document.getElementById('btn-download');
const btnReset         = document.getElementById('btn-reset');
const errorBanner      = document.getElementById('error-banner');
const errorMessage     = document.getElementById('error-message');
const btnErrorDismiss  = document.getElementById('btn-error-dismiss');

// ── 狀態管理 ──────────────────────────────────────────────────────────────

const STATES = {
  UPLOAD:     'state-upload',
  CONVERTING: 'state-converting',
  RESULT:     'state-result',
};

/** 切換 UI 狀態（只顯示對應的 section） */
function showState(stateName) {
  Object.values(STATES).forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.toggle('state-section--active', id === stateName);
    }
  });
}

// ── Web Worker 管理 ───────────────────────────────────────────────────────

let worker = null;
let isEngineReady = false;
let currentFilename = '';
let currentMarkdown = '';
let convertStartTime = 0;

function createWorker() {
  worker = new Worker('/js/converter.worker.js');

  worker.onmessage = (event) => {
    const { type, message, markdown } = event.data;

    switch (type) {
      case 'ready':
        isEngineReady = true;
        setEngineStatus('ready', '就緒');
        dropZone.classList.remove('drop-zone--disabled');
        break;

      case 'progress':
        convertingMsg.textContent = message;
        break;

      case 'result':
        handleConversionResult(markdown);
        break;

      case 'error':
        showError(message);
        showState(STATES.UPLOAD);
        break;
    }
  };

  worker.onerror = (err) => {
    showError(`Worker 發生錯誤：${err.message}`);
    setEngineStatus('error', '引擎錯誤');
    showState(STATES.UPLOAD);
  };
}

/** 更新引擎狀態指示器 */
function setEngineStatus(state, text) {
  engineStatus.className = `engine-status engine-status--${state}`;
  engineStatusText.textContent = text;
}

// ── 檔案處理 ──────────────────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = new Set([
  'pdf', 'docx', 'xlsx', 'pptx',
  'html', 'htm', 'csv', 'json', 'xml', 'epub',
]);

/** 驗證副檔名是否支援 */
function isSupportedFile(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return SUPPORTED_EXTENSIONS.has(ext);
}

/** 處理選取的檔案 */
function handleFile(file) {
  if (!isEngineReady) {
    showError('請等待轉換引擎完成載入後再上傳檔案。');
    return;
  }

  if (!isSupportedFile(file.name)) {
    const ext = file.name.split('.').pop()?.toUpperCase() ?? '未知';
    showError(
      `不支援的格式：.${ext}\n\n` +
      `支援的格式：PDF、DOCX、XLSX、PPTX、HTML、CSV、JSON、XML、EPUB`
    );
    return;
  }

  currentFilename = file.name;
  convertStartTime = Date.now();
  showState(STATES.CONVERTING);
  convertingMsg.textContent = '準備中...';

  const reader = new FileReader();
  reader.onload = (e) => {
    // 將 ArrayBuffer 傳給 Worker（使用 Transferable 避免複製）
    worker.postMessage(
      { type: 'convert', file: e.target.result, filename: file.name },
      [e.target.result]
    );
  };
  reader.onerror = () => {
    showError('無法讀取檔案，請重試。');
    showState(STATES.UPLOAD);
  };
  reader.readAsArrayBuffer(file);
}

/** 轉換成功後更新 UI */
function handleConversionResult(markdown) {
  currentMarkdown = markdown;
  const elapsed = ((Date.now() - convertStartTime) / 1000).toFixed(1);
  const lines = markdown.split('\n').length;
  const chars = markdown.length;

  resultFilename.textContent = currentFilename.replace(/\.[^.]+$/, '.md');
  resultStats.textContent = `${chars.toLocaleString()} 字元 · ${lines.toLocaleString()} 行 · 耗時 ${elapsed}s`;
  resultCode.textContent = markdown;

  showState(STATES.RESULT);
}

// ── 下載功能 ──────────────────────────────────────────────────────────────

function downloadMarkdown() {
  if (!currentMarkdown) return;

  const outputFilename = currentFilename.replace(/\.[^.]+$/, '.md');
  const blob = new Blob([currentMarkdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = outputFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── 錯誤顯示 ──────────────────────────────────────────────────────────────

function showError(message) {
  errorMessage.textContent = message;
  errorBanner.removeAttribute('hidden');
}

function dismissError() {
  errorBanner.setAttribute('hidden', '');
  errorMessage.textContent = '';
}

// ── 拖放事件 ──────────────────────────────────────────────────────────────

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (!dropZone.classList.contains('drop-zone--disabled')) {
    dropZone.classList.add('drop-zone--dragging');
  }
});

dropZone.addEventListener('dragleave', (e) => {
  if (!dropZone.contains(e.relatedTarget)) {
    dropZone.classList.remove('drop-zone--dragging');
  }
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drop-zone--dragging');
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});

dropZone.addEventListener('click', () => {
  if (!dropZone.classList.contains('drop-zone--disabled')) {
    fileInput.click();
  }
});

dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (!dropZone.classList.contains('drop-zone--disabled')) {
      fileInput.click();
    }
  }
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) {
    handleFile(file);
    fileInput.value = ''; // 允許重複選同一個檔案
  }
});

// ── 按鈕事件 ──────────────────────────────────────────────────────────────

btnDownload.addEventListener('click', downloadMarkdown);

btnReset.addEventListener('click', () => {
  currentMarkdown = '';
  currentFilename = '';
  resultCode.textContent = '';
  showState(STATES.UPLOAD);
});

btnErrorDismiss.addEventListener('click', dismissError);

// ── 初始化 ────────────────────────────────────────────────────────────────

// 在 Pyodide 就緒前禁用上傳
dropZone.classList.add('drop-zone--disabled');

// 啟動 Web Worker
createWorker();
```

**Step 2: Commit**

```bash
git add js/main.js
git commit -m "feat: add main UI JavaScript with drag-drop and worker management"
```

---

## Task 7：執行建置腳本並驗證

所有程式碼檔案建立完成後，執行建置腳本下載 Pyodide 和 Python 套件，然後在本地驗證。

**Step 1: 執行建置腳本**

```bash
python scripts/download_wheels.py
```

預期輸出（過程約需幾分鐘，取決於網路速度）：
```
============================================================
  MarkItDown Website 建置腳本
============================================================
[建置] 檢查執行環境...
[建置] Python 3.x.x ✓
[建置] 開始下載 Pyodide 0.26.4（約 400MB，僅需下載一次）...
[建置] 下載：https://github.com/pyodide/pyodide/releases/...
  下載中... 100%
[建置] 解壓縮中...
[建置] Pyodide 0.26.4 解壓完成 ✓
[建置] 下載 markitdown 及相關套件...
[建置] 保留 N 個純 Python wheel ✓
[建置] 已產生 wheels/manifest.json（共 N 個套件）✓

============================================================
  建置完成！
  ...
============================================================
```

**Step 2: 確認目錄結構**

```bash
ls pyodide/
# 預期：pyodide.js, pyodide.asm.wasm, pyodide-lock.json, python_stdlib.zip, ...

ls wheels/
# 預期：多個 .whl 檔案 + manifest.json

cat wheels/manifest.json
# 預期：JSON 陣列，列出所有 wheel 檔名
```

**Step 3: 本地測試伺服器**

> 注意：本地測試需要繞過 COOP/COEP 限制（Python 內建伺服器不支援自訂標頭）。
> 可使用以下方式啟動有 COOP/COEP 標頭的本地伺服器：

```python
# 建立一個簡單的測試伺服器腳本：scripts/dev_server.py
```

```python
#!/usr/bin/env python3
"""本地開發測試用伺服器（含 COOP/COEP 標頭）"""
import http.server
import socketserver
import os

class COOPHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        super().end_headers()

    def log_message(self, format, *args):
        pass  # 靜音日誌

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PORT = 8080
print(f"測試伺服器啟動於 http://localhost:{PORT}")
print("按 Ctrl+C 停止")
with socketserver.TCPServer(("", PORT), COOPHandler) as httpd:
    httpd.serve_forever()
```

執行測試伺服器：
```bash
python scripts/dev_server.py
```

**Step 4: 瀏覽器驗證清單**

開啟 http://localhost:8080，按順序確認：

1. 頁面載入後右上角顯示「正在載入轉換引擎...」（橘色）
2. 等待片刻後顯示「就緒」（綠色）
3. 拖放一個 `.docx` 檔案，確認進入「轉換中」狀態
4. 轉換完成後顯示 Markdown 預覽
5. 點擊「下載 .md 檔案」，確認檔案可下載
6. 點擊「重新轉換」，確認回到上傳頁面
7. 上傳不支援的格式（如 `.jpg`），確認顯示錯誤提示
8. 在 DevTools → Console 確認無 JavaScript 錯誤

**Step 5: Commit**

```bash
git add scripts/dev_server.py
git commit -m "feat: add local dev server with COOP/COEP headers"
```

---

## Task 8：最終提交

所有功能驗證通過後，建立最終 commit 並整理目錄。

**Step 1: 確認 .gitignore（避免提交大型二進位檔案）**

建立 `.gitignore`：

```gitignore
# Pyodide runtime（由建置腳本下載，不提交至 git）
pyodide/

# Python wheels（由建置腳本下載，不提交至 git）
wheels/

# Python 快取
__pycache__/
*.pyc
*.pyo

# 建置腳本暫存
scripts/_tmp/
scripts/*.tar.bz2

# 系統檔案
.DS_Store
Thumbs.db
```

**Step 2: 最終 Commit**

```bash
git add .gitignore
git commit -m "chore: add .gitignore to exclude Pyodide runtime and wheels"

git log --oneline
```

預期 git log：
```
(最新) chore: add .gitignore to exclude Pyodide runtime and wheels
       feat: add local dev server with COOP/COEP headers
       feat: add main UI JavaScript with drag-drop and worker management
       feat: add dark theme CSS
       feat: add HTML structure with three-state UI
       feat: add Web Worker with Pyodide and MarkItDown integration
       feat: add Nginx config with COOP/COEP headers for Pyodide
       feat: add build script to download Pyodide and Python wheels
       Add design document for MarkItDown website
```

---

## 部署至 Nginx 伺服器

建置完成後，將整個目錄（含 `pyodide/` 和 `wheels/`）複製至伺服器：

```bash
# 將專案目錄同步至伺服器（請修改為實際路徑和伺服器位址）
rsync -avz --exclude='.git' ./ user@your-server:/var/www/markitdown-website/

# 在伺服器上設定 Nginx
sudo cp /var/www/markitdown-website/nginx.conf /etc/nginx/sites-available/markitdown
# 修改 nginx.conf 中的 server_name 和 root 路徑後：
sudo ln -s /etc/nginx/sites-available/markitdown /etc/nginx/sites-enabled/
sudo nginx -t && sudo nginx -s reload
```
