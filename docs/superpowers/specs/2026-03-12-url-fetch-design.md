# URL 抓取轉換功能設計

## 概述

新增讓使用者輸入網頁網址，由後端 proxy 抓取網頁內容，再由瀏覽器端的 Pyodide MarkItDown 轉換為 Markdown 的功能。

## 架構決策

- **後端 proxy**：自建 Node.js (Express) 服務，只負責抓取內容並回傳，不做轉換
- **部署方式**：與靜態網站同一個 nginx 下，用反向代理轉發 `/api/` 路徑到 Node.js 服務
- **轉換**：瀏覽器端 Pyodide MarkItDown 處理（與檔案上傳走同一條路）
- **Content-Type 感知**：proxy 回傳原始 content-type，前端據此判斷副檔名，未來可支援 URL 指向的 PDF 等格式

## Proxy API

### 端點

`GET /api/fetch-url?url=<encoded_url>`

### 成功回應

回傳原始內容（binary），附帶 headers：
- `Content-Type`：來源伺服器回傳的原始 content-type
- `X-Original-Url`：原始請求的 URL

### 錯誤回應

JSON `{ "error": "錯誤訊息" }` 搭配對應 HTTP status code：
- `400`：無效的 URL、不允許的協定
- `403`：內網 IP（SSRF 防護）
- `413`：回應超過 10MB
- `408`：請求超時（15 秒）
- `502`：目標伺服器無法連線或回應錯誤
- `504`：nginx 層級超時（Node 無回應）
- `429`：請求頻率超限

### 安全措施

1. 只允許 `http://` 和 `https://` 協定
2. DNS 解析後封鎖私有 IP（127.0.0.0/8、10.0.0.0/8、172.16.0.0/12、192.168.0.0/16、::1 等）
3. 回應大小上限 10MB
4. 請求超時 15 秒
5. Rate limiting：每個 IP 每分鐘 30 次（Express 須設定 `app.set('trust proxy', 1)` 以正確讀取 `X-Real-IP`）
6. 設定合理的 User-Agent

### 技術選擇

- Express.js
- `node:dns` 做 IP 檢查
- `express-rate-limit` 做頻率限制

## 前端 UI

### URL 輸入區

在現有拖放區域下方新增 URL 輸入區塊：

```
┌─────────────────────────────────────┐
│        拖放文件至此                    │
│        或點擊選擇檔案                  │
│   支援格式：PDF DOCX XLSX ...         │
└─────────────────────────────────────┘

────────────── 或 ──────────────

┌──────────────────────────────┬──────┐
│  輸入網頁網址...               │ 轉換 │
└──────────────────────────────┴──────┘
```

- 分隔線用「或」字樣分開兩種輸入方式
- 輸入框 placeholder：`輸入網頁網址，例如 https://example.com`
- 「轉換」按鈕在引擎未就緒時 disabled
- 按 Enter 也能觸發轉換
- 基本的 URL 格式前端驗證（必須是 http/https 開頭）

### 轉換流程

1. 使用者輸入 URL 並點擊「轉換」
2. 前端 fetch `/api/fetch-url?url=...` 取得內容
3. 從 response 的 `Content-Type` 判斷副檔名（解析 MIME type 時忽略 `; charset=...` 等參數，只取分號前的部分）
4. 將內容包裝成虛擬 FileItem，送進現有的 Worker 轉換佇列
5. 自動切換到清單狀態，顯示轉換進度

### 虛擬 FileItem 結構

URL 抓取產生的 FileItem 與檔案上傳的差異：
- 新增 `arrayBuffer` 欄位（`ArrayBuffer`），存放抓取到的內容
- 無 `file` 屬性（`file` 為 `null`）
- `processNextFile()` 須判斷：若 `item.arrayBuffer` 存在，直接 postMessage 給 Worker；否則走原本的 `FileReader` 路徑

### 檔名產生演算法

1. 解析 URL，取最後一個 path segment（去除 query string）
2. 去除該 segment 原有的副檔名
3. 依據 Content-Type 對應表附加正確的副檔名
4. 若 path 為空或僅為 `/`，使用 hostname 作為基底名稱
5. 例如：`https://example.com/report` + `text/html` → `report.html`
6. 例如：`https://example.com/` + `text/html` → `example.com.html`

### 狀態處理

- 抓取中：輸入框和按鈕 disabled，按鈕文字改為「抓取中...」
- 抓取失敗：用現有的 error banner 顯示錯誤訊息（全域提示）
- 不支援的 Content-Type：同樣用 error banner 提示
- 抓取成功：進入正常的轉換流程（轉換階段的錯誤走 FileItem 行內錯誤顯示）

### Content-Type 對應副檔名

前端解析 Content-Type 時，只取分號前的 MIME type 部分進行比對：

| Content-Type | 副檔名 |
|---|---|
| `text/html` | `.html` |
| `application/pdf` | `.pdf` |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `.docx` |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `.xlsx` |
| `application/vnd.openxmlformats-officedocument.presentationml.presentation` | `.pptx` |
| `text/csv` | `.csv` |
| `application/epub+zip` | `.epub` |
| 不支援的類型 | error banner 提示 |

## Service Worker 更新

`sw.js` 須排除 `/api/` 路徑，不進行任何快取：

```js
// 在 fetch handler 中，/api/ 請求直接放行不快取
if (url.pathname.startsWith('/api/')) return;
```

## Nginx 設定

在現有 nginx.conf 中新增：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3001/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 20s;
}
```

nginx 的 `proxy_read_timeout 20s` 大於 Node 的 15 秒超時，確保 Node 有時間回傳錯誤訊息。若 Node 無回應，nginx 回傳 `504`。

## 隱私聲明更新

頁尾與 meta description 須更新隱私說明，明確告知使用 URL 抓取功能時網頁內容會經由伺服器中轉：
- 檔案上傳仍為純瀏覽器端處理
- URL 抓取會透過伺服器代理取得網頁內容

## 新增檔案結構

```
markitdown-website/
├── server/
│   ├── package.json
│   ├── index.js          # Express 入口，啟動 HTTP server（PORT 預設 3001，可由環境變數設定）
│   └── fetch-url.js      # /fetch-url 路由邏輯（URL 驗證、SSRF 防護、抓取）
```

## 開發環境

`scripts/dev_server.py` 須新增 `/api/` 的反向代理轉發至 `http://localhost:3001`，使開發環境不需要 nginx 即可正常使用。開發時啟動流程：
1. `node server/index.js`（啟動 proxy）
2. 啟動 dev_server.py（靜態檔案 + API 反向代理）

## 部署

- Node.js 服務建議使用 PM2 管理程序（自動重啟、日誌管理）
- 環境變數：`PORT`（預設 3001）
