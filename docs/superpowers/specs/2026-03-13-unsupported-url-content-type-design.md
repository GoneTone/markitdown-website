# 不支援的 URL 內容類型攔截

## 問題

使用者輸入圖片等不支援檔案類型的 URL 時，Puppeteer 會將其渲染為 HTML 頁面（Chrome 行為），後端以 `text/html` 回傳，前端誤認為合法網頁並送入 markitdown 轉換，產生無意義的 `![](url)` 結果。

應與檔案上傳行為一致：不支援的類型直接拒絕，不進行轉換。

## 設計

新增 `isSupportedContentType(contentType)` 函式，在兩個程式碼路徑中進行白名單檢查。

### 允許的 MIME type 白名單

與前端 `MIME_TO_EXT` 及後端 `DIRECT_DOWNLOAD_TYPES` 一致，另加 XHTML：

- `text/html`
- `application/xhtml+xml`
- `application/pdf`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `application/vnd.openxmlformats-officedocument.presentationml.presentation`
- `text/csv`
- `application/epub+zip`

MIME type 比對前須先剝除 charset 等參數（`split(';')[0].trim().toLowerCase()`），與現有 `isDirectDownloadType` 一致。

不支援的類型（含 `application/octet-stream`、`image/*`、`video/*` 等）一律拒絕。

### 變更位置

**`server/fetch-url.js`** — 兩個檢查點：

1. **Puppeteer 路徑（步驟 8）**：取得 `responseContentType` 後、`isDirectDownloadType` 判斷前，呼叫 `isSupportedContentType`。不通過 → 回傳 HTTP 415 + `{ error: '不支援的內容類型：<mime>' }`（若 MIME 為空則顯示「未知」）。
2. **`streamDownload` 路徑**：取得最終回應的 `content-type` 後，呼叫同一函式檢查。不通過 → 回傳 HTTP 415。

### 前端

不需要改動。現有 `generateFilename` 的 null 檢查作為 fallback 保留。

### 測試

在 `server/__tests__/fetch-url.test.js` 新增 `isSupportedContentType` 單元測試：
- 白名單內的類型（含帶 charset 參數的）通過
- `image/png`、`image/jpeg`、`application/json`、`application/octet-stream` 被拒絕
- 空字串或 undefined 被拒絕

## 影響範圍

僅 `server/fetch-url.js` 及其測試檔。
