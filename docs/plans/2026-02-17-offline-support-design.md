# 離線支援設計文件

**日期：** 2026-02-17
**狀態：** 已確認

## 目標

透過 Service Worker 實現離線使用功能。使用者完成首次 Pyodide 初始化後，即可在無網路環境下正常使用文件轉換功能。

## 新增 / 修改檔案

| 檔案 | 變更 | 說明 |
|------|------|------|
| `sw.js` | 新增 | Service Worker 主程式 |
| `index.html` | 修改 | 加入 SW 註冊與自動重載邏輯 |

## 快取策略

### 資源分組

| 資源路徑 | 策略 | 理由 |
|----------|------|------|
| `index.html`、`css/`、`js/`、`images/` | Stale-while-revalidate | 可能更新，需即時可用 |
| `/pyodide/**` | Cache-first | 版本固定（0.26.4），內容不變 |
| `/wheels/**` | Cache-first | 版本固定，內容不變 |

### 快取命名

```
ui-v1       — UI 靜態資源（HTML、CSS、JS、圖片）
pyodide-v1  — Pyodide runtime 與內建套件
wheels-v1   — Python wheel 檔案
```

版本號統一由 `sw.js` 頂部的 `CACHE_VERSION` 常數控制。

## Service Worker 生命週期

### install
預先快取 UI 靜態資源：
- `/`（index.html）
- `/css/style.css`
- `/js/main.js`
- `/js/converter.worker.js`
- `/images/favicon.svg`

### activate
1. `self.skipWaiting()` — 新 SW 立即生效，不等待舊分頁關閉
2. `clients.claim()` — 立即接管所有已開啟的分頁
3. 清除名稱不在當前版本清單中的舊快取

### fetch
依請求路徑路由至對應策略：
```
/pyodide/** → cache-first（快取命中直接回傳，未命中才抓網路並寫入快取）
/wheels/**  → cache-first（同上）
其他         → stale-while-revalidate（回傳快取，同時背景更新快取）
```

## 自動更新行為

1. 伺服器部署新版本 → SW 檔案內容改變
2. 瀏覽器偵測到新 SW → `skipWaiting` 讓新 SW 立即接管
3. `main.js` 監聽 `navigator.serviceWorker` 的 `controllerchange` 事件
4. 事件觸發 → `window.location.reload()` 自動重載頁面
5. 使用者看到最新版本，過程無感

## 離線可用條件

使用者需完成至少一次完整的 Pyodide 初始化（UI 顯示「就緒」）。初始化過程中所有 fetch 請求均由 SW 攔截並快取，之後斷網即可正常使用。

**估計快取空間：**
- UI 資源（pre-cache）：< 1 MB
- Pyodide core + 套件 + wheels（首次初始化後）：約 80–100 MB

## 版本更新方式

修改 `sw.js` 頂部的 `CACHE_VERSION` 常數即可強制所有客戶端清除舊快取並重新快取所有資源：

```js
const CACHE_VERSION = 'v2'; // v1 → v2 觸發全量更新
```
