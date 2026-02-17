# PWA 支援設計文件

**日期：** 2026-02-17
**狀態：** 已確認

## 目標

補全 PWA（Progressive Web App）所需元件，讓瀏覽器自動顯示「新增至主畫面」安裝提示，使用者無需任何自訂 UI 即可將網站安裝為 App。

## 前提

Service Worker（`sw.js`）已實作完整的離線快取策略（`CACHE_VERSION = 'v1'`）。本次僅補全 PWA Manifest 與圖示，並將 SW 快取版本升至 `v2`。

## 新增 / 修改檔案

| 檔案 | 變更 | 說明 |
|------|------|------|
| `scripts/generate_icons.py` | 新增 | uv inline script，從 `favicon.svg` 產生 PNG 圖示 |
| `images/icon-192.png` | 新增（腳本產生） | manifest 用圖示（192×192） |
| `images/icon-512.png` | 新增（腳本產生） | manifest 用圖示（512×512，含 maskable） |
| `images/icon-180.png` | 新增（腳本產生） | iOS apple-touch-icon（180×180） |
| `manifest.json` | 新增 | PWA Web App Manifest |
| `index.html` | 修改 | 新增 manifest、theme-color、apple-touch-icon 標籤 |
| `sw.js` | 修改 | UI_PRECACHE 加入新檔案，CACHE_VERSION 升為 `v2` |

## 圖示產生腳本

**執行方式：**
```bash
uv run scripts/generate_icons.py
```

使用 `cairosvg`（PEP 723 inline 依賴），從 `images/favicon.svg` 轉換為三個 PNG 尺寸。圖示產生後 commit 進版本控制（與 `og-image.png` 同樣處理方式）。

## manifest.json

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

- `display: standalone`：安裝後隱藏瀏覽器 UI，像原生 App
- `background_color: #1a1a1a`：啟動畫面背景色（與網站深色主題一致）
- `theme_color: #2d2d2d`：瀏覽器標題列顏色
- `purpose: any maskable`：512px 圖示同時支援一般顯示和 Android 自適應圖示裁切

## index.html 修改

在 `<head>` 區塊的 `<link rel="icon">` 附近新增：

```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#2d2d2d" />
<link rel="apple-touch-icon" href="/images/icon-180.png" />
```

## sw.js 修改

### CACHE_VERSION 升級

```js
const CACHE_VERSION = 'v2';
```

強制所有已安裝的客戶端清除 `v1` 快取並重新快取所有資源（含新圖示與 manifest）。

### UI_PRECACHE 新增項目

```js
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

## 安裝流程說明

1. 使用者首次開啟網站，SW 安裝並預快取所有 UI 資源（含圖示與 manifest）
2. Pyodide 初始化完成後，所有資源均已快取
3. 瀏覽器偵測到有效的 manifest + SW，自動顯示「新增至主畫面」提示
4. 使用者安裝後，以 standalone 模式開啟，無瀏覽器 UI

## 不在範圍內

- 自訂安裝按鈕（`beforeinstallprompt` 事件處理）
- 自訂離線頁面
- Push 通知
