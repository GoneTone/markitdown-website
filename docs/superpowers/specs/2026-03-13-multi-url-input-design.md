# 多網址輸入設計規格

## 概述

將現有的單一 URL 輸入（`<input type="url">`）改為多行文字輸入（`<textarea>`），讓使用者一次貼上多個網址進行批次轉換。每個網址各自獨立產生 Markdown 結果，與多檔上傳的行為一致。

## 需求

- 使用者可在 textarea 中輸入多個網址，每行一個
- 最多 10 個網址，超過時阻擋提交並顯示提示
- 每個網址各自獨立轉換，產生獨立的 Markdown 結果
- 逐一抓取（不並行），與 server rate limit 和 Puppeteer 並行限制相容
- Server 端不改動

## UI 變更

### HTML

- `<input type="url" id="url-input">` → `<textarea id="url-input">`
- placeholder 改為：`每行輸入一個網址，例如：\nhttps://example.com\nhttps://docs.python.org`
- 按鈕從 input 右側移至 textarea 下方右側
- 新增提示文字元素：「每行一個網址，最多 10 個」
- 新增超過上限錯誤提示元素（預設 hidden）

### CSS

- `.url-input-group` 佈局從 `display: flex`（水平排列）改為垂直排列
- `.url-input` 樣式調整：`min-height: 80px`、`resize: vertical`、`line-height: 1.6`、`font-family: inherit`
- 按鈕與提示文字的容器使用 `display: flex; justify-content: space-between`
- 新增超過上限錯誤提示的樣式

### 互動行為

- Enter 鍵為換行（textarea 預設行為），不觸發提交
- 只靠「轉換」按鈕觸發提交
- 按鈕的 disabled 邏輯維持不變（需 `isOnline && isEngineReady`）

## URL 解析邏輯

點擊「轉換」按鈕時，新增 `parseUrls(text)` 函數：

1. 按換行符切割 textarea 內容
2. 每行 trim 去除前後空白
3. 過濾空行
4. 去重（相同 URL 只保留第一個）
5. 上限檢查：超過 10 個時，阻擋提交，顯示「最多輸入 10 個網址」提示，return
6. 對每個 URL 檢查是否以 `http://` 或 `https://` 開頭，標記有效/無效
7. 回傳 URL 物件陣列：`[{ url: string, valid: boolean }]`

若去重及過濾空行後結果為空（全部空行），不執行任何動作。

## Fetch 佇列流程

### fetchAndConvert 重構

現有的 `fetchAndConvert(url)` 處理單一 URL。重構為 `fetchAndConvertMultiple(urlEntries)` 處理多個：

1. **建立 FileItem 陣列**：為每個 URL entry 建立 FileItem
   - 有效 URL：狀態設為 `waiting`
   - 無效 URL：狀態立即設為 `error`，顯示「網址格式無效」
2. **切換到列表視圖**：清空舊 `fileQueue`，加入所有 FileItem，`currentIndex = -1`，切換到 `STATES.LIST`
3. **清空 textarea**
4. **逐一抓取有效的 URL**：async 迴圈，依序處理每個有效的 FileItem：
   - 將該項目狀態改為 `fetching`（帶 spinner），更新 DOM
   - 發送 `GET /api/fetch-url?url=<encoded>` 請求
   - 成功：更新 filename（從 `x-page-title` + content-type 推斷）、存入 `arrayBuffer`、狀態改 `waiting`
   - 失敗：狀態改 `error`，顯示錯誤訊息（不中斷迴圈）
   - 每個完成後呼叫 `processNextFile()`，讓已 waiting 的項目立即開始轉換
5. **Fetch 與 convert 自然交錯**：第一個 URL fetch 完成進入 convert 時，第二個 URL 開始 fetch，以此類推

### AbortController

- 使用單一 `currentFetchController = new AbortController()`
- 所有 fetch 請求共用同一個 `signal`
- 「重新開始」按鈕呼叫 `resetToUpload()` 時 abort，所有尚未完成的 fetch 取消
- 尚未開始的 fetch（還在迴圈中等待前一個完成）在迴圈開頭檢查 `signal.aborted`，若已取消則跳出迴圈

## 錯誤處理

| 情境 | 行為 |
|------|------|
| URL 格式無效 | 加入列表，立即顯示 `error` 狀態，訊息「網址格式無效」 |
| 超過 10 個網址 | 阻擋提交，textarea 下方顯示提示「最多輸入 10 個網址」 |
| 全部為空行 | 不執行任何動作 |
| 單一 URL fetch 失敗（網路錯誤） | 該項目 `error`，顯示錯誤訊息，繼續下一個 |
| Rate limit 429 | 該項目 `error`，顯示「請求過於頻繁，請稍後再試」，繼續下一個 |
| Content-type 不支援 | 沿用 server 端驗證，該項目 `error`，繼續下一個 |
| 使用者按「重新開始」 | abort 所有 fetch，清空佇列，回到上傳頁 |

## 向下相容

- **單一網址**：textarea 只填一個網址時，行為與現有完全一致（一個 FileItem，fetch → convert）
- **Server 端**：`/api/fetch-url` API 不改動，前端逐一呼叫
- **既有 `fetchAndConvert`**：可保留為內部呼叫或整合進新函數，視實作方便決定

## 影響範圍

| 檔案 | 變更 |
|------|------|
| `index.html` | `<input>` → `<textarea>`、按鈕位置、新增提示文字元素 |
| `css/style.css` | `.url-input-group` 佈局、`.url-input` textarea 樣式、提示文字樣式 |
| `js/main.js` | 新增 `parseUrls()`、重構 `fetchAndConvert` 為批次處理、按鈕事件處理更新 |
| `server/*` | **不改動** |

## 不在此次範圍

- 並行抓取
- 合併多個 URL 結果為單一 Markdown
- 「加入佇列」互動模式
- URL 自動偵測（從任意文字中提取 URL）
