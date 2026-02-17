# PWA 支援實作計畫

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新增 `manifest.json`、PWA 圖示與必要的 HTML meta 標籤，讓瀏覽器自動顯示「新增至主畫面」安裝提示。

**Architecture:** 以 `scripts/generate_icons.py`（uv inline script + cairosvg）從現有的 `favicon.svg` 產生三個尺寸的 PNG 圖示，再新增 `manifest.json` 並更新 `index.html` 與 `sw.js`。Service Worker 快取版本從 `v1` 升至 `v2`，強制所有客戶端清除舊快取並重新快取含圖示與 manifest 的完整資源集。

**Tech Stack:** Python 3（uv inline script）、cairosvg、Service Worker Cache Storage API、Web App Manifest

---

## Task 1：建立圖示產生腳本並產生 PNG 圖示

**Files:**
- Create: `scripts/generate_icons.py`
- Create（腳本產生）: `images/icon-192.png`
- Create（腳本產生）: `images/icon-512.png`
- Create（腳本產生）: `images/icon-180.png`

**Step 1: 建立 generate_icons.py**

```python
# /// script
# dependencies = ["cairosvg"]
# ///
"""
從 images/favicon.svg 產生 PWA 所需的 PNG 圖示。

使用方式：
    uv run scripts/generate_icons.py

產生檔案：
    images/icon-192.png  — manifest 用（192×192）
    images/icon-512.png  — manifest 用（512×512，含 maskable）
    images/icon-180.png  — iOS apple-touch-icon（180×180）
"""

import cairosvg
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
SVG_SOURCE = PROJECT_ROOT / 'images' / 'favicon.svg'

ICONS = [
    ('icon-192.png', 192),
    ('icon-512.png', 512),
    ('icon-180.png', 180),
]

def main():
    if not SVG_SOURCE.exists():
        raise FileNotFoundError(f'找不到來源檔案：{SVG_SOURCE}')

    svg_data = SVG_SOURCE.read_bytes()

    for filename, size in ICONS:
        output_path = PROJECT_ROOT / 'images' / filename
        cairosvg.svg2png(
            bytestring=svg_data,
            write_to=str(output_path),
            output_width=size,
            output_height=size,
        )
        print(f'✓ {filename} ({size}×{size})')

    print('圖示產生完成。')

if __name__ == '__main__':
    main()
```

**Step 2: 執行腳本產生圖示**

```bash
uv run scripts/generate_icons.py
```

預期輸出：
```
✓ icon-192.png (192×192)
✓ icon-512.png (512×512)
✓ icon-180.png (180×180)
圖示產生完成。
```

**Step 3: 確認三個檔案已產生**

```bash
ls images/icon-*.png
```

預期：找到 `icon-192.png`、`icon-512.png`、`icon-180.png`

**Step 4: Commit**

```bash
git add scripts/generate_icons.py images/icon-192.png images/icon-512.png images/icon-180.png
git commit -m "feat: add icon generation script and PWA icon assets"
```

---

## Task 2：建立 manifest.json

**Files:**
- Create: `manifest.json`

**Step 1: 建立 manifest.json**

```json
{
  "name": "MarkItDown — 文件轉 Markdown",
  "short_name": "MarkItDown",
  "description": "在瀏覽器中將文件轉換為 Markdown，所有處理完全在本機端進行",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1a1a1a",
  "theme_color": "#2d2d2d",
  "icons": [
    {
      "src": "/images/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/images/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

**Step 2: 確認檔案在根目錄**

```bash
ls manifest.json
```

預期：找到 `manifest.json`

**Step 3: Commit**

```bash
git add manifest.json
git commit -m "feat: add PWA web app manifest"
```

---

## Task 3：更新 index.html，加入 PWA meta 標籤

**Files:**
- Modify: `index.html`（在 `<link rel="icon">` 之後，`<link rel="stylesheet">` 之前）

**Step 1: 確認 index.html 目前的 head 結構**

讀取 `index.html` 前 30 行，確認目前結構，預期看到：
```html
  <link rel="icon" type="image/svg+xml" href="/images/favicon.svg" />
  <link rel="stylesheet" href="/css/style.css" />
</head>
```

**Step 2: 在 `<link rel="icon">` 之後插入三個 PWA 標籤**

插入位置：`<link rel="icon" ... />` 之後、`<link rel="stylesheet" ...>` 之前

插入內容：
```html
  <link rel="manifest" href="/manifest.json" />
  <meta name="theme-color" content="#2d2d2d" />
  <link rel="apple-touch-icon" href="/images/icon-180.png" />
```

修改後的結構應如下：
```html
  <link rel="icon" type="image/svg+xml" href="/images/favicon.svg" />
  <link rel="manifest" href="/manifest.json" />
  <meta name="theme-color" content="#2d2d2d" />
  <link rel="apple-touch-icon" href="/images/icon-180.png" />
  <link rel="stylesheet" href="/css/style.css" />
</head>
```

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add PWA manifest link and meta tags to index.html"
```

---

## Task 4：更新 sw.js — 升級 CACHE_VERSION 並加入新資源

**Files:**
- Modify: `sw.js`

**Step 1: 確認 sw.js 目前的 CACHE_VERSION 和 UI_PRECACHE**

讀取 `sw.js` 前 30 行，確認目前內容：
```javascript
const CACHE_VERSION = 'v1';
// ...
const UI_PRECACHE = [
  '/',
  '/css/style.css',
  '/js/main.js',
  '/js/converter.worker.js',
  '/js/lib/jszip.min.js',
  '/images/favicon.svg',
];
```

**Step 2: 將 CACHE_VERSION 改為 `'v2'`**

```javascript
const CACHE_VERSION = 'v2';
```

**Step 3: 在 UI_PRECACHE 末尾加入四個新項目**

修改後的 `UI_PRECACHE`：
```javascript
const UI_PRECACHE = [
  '/',
  '/css/style.css',
  '/js/main.js',
  '/js/converter.worker.js',
  '/js/lib/jszip.min.js',
  '/images/favicon.svg',
  '/images/icon-192.png',
  '/images/icon-512.png',
  '/images/icon-180.png',
  '/manifest.json',
];
```

**Step 4: Commit**

```bash
git add sw.js
git commit -m "feat: update Service Worker to cache PWA icons and manifest (v2)"
```

---

## Task 5：本地驗證

**前置條件：** Docker 開發環境已啟動（`docker compose -f docker-compose-dev.yml up`）

**Step 1: 確認 manifest 已連結**

開啟 `http://localhost:3000`，前往：
- DevTools → Application → Manifest
- 確認顯示 `manifest.json` 內容（name、short_name、icons）

**Step 2: 確認 SW 已升級至 v2**

DevTools → Application → Service Workers：
- 確認 `sw.js` 狀態為 **activated and running**
- DevTools → Application → Cache Storage：確認存在 `ui-v2`（不再有 `ui-v1`）

**Step 3: 確認圖示已快取**

DevTools → Application → Cache Storage → `ui-v2`：
- 確認包含 `/images/icon-192.png`、`/images/icon-512.png`、`/images/icon-180.png`、`/manifest.json`

**Step 4: 確認 PWA 可安裝性**

DevTools → Application → Manifest → 底部：
- 確認出現「App is installable」或無明顯錯誤
- Chrome：網址列右側應出現安裝圖示（⊕）

---

## Task 6：更新 README

**Files:**
- Modify: `README.md`

**Step 1: 在「技術架構」的結構圖中加入 sw.js 和 manifest.json**

在現有結構圖中，根目錄層新增兩個項目：

```
├── sw.js                         Service Worker（離線快取）
├── manifest.json                 PWA Web App Manifest
```

**Step 2: 在「技術架構」→「關鍵技術決策」表格中新增 PWA 一行**

在表格末尾加入：

| 技術 | 說明 |
|---|---|
| **Web App Manifest** | 宣告 PWA 元數據（名稱、圖示、啟動模式），觸發瀏覽器安裝提示 |

**Step 3: 在「本地開發」章節的前置說明中補充圖示產生步驟**

在現有步驟 1（`python scripts/download_wheels.py`）之後插入：

```markdown
# 1.5. 產生 PWA 圖示（僅需執行一次）
uv run scripts/generate_icons.py
```

**Step 4: 在「專案結構」加入 generate_icons.py**

```
├── scripts/
│   ├── download_wheels.py        建置腳本（下載 Pyodide + wheels）
│   └── generate_icons.py         建置腳本（產生 PWA PNG 圖示）
```

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: update README for PWA support and generate_icons.py"
```
