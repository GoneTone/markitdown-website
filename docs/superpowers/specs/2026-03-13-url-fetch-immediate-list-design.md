# URL 抓取立即進入列表顯示設計

## 問題

目前 URL 抓取流程在上傳頁面原地等待 fetch 完成後才切換到列表頁，與檔案上傳的即時列表體驗不一致。使用者點擊「轉換」後看到按鈕變成「抓取中...」，無法得知詳細進度。

## 目標

讓 URL 抓取與檔案上傳擁有一致的 UX：點擊轉換後立即進入列表頁，在列表項目中顯示抓取狀態。

## 設計

### 新增 `fetching` 狀態

FileItem 狀態流程：

```
fetching → waiting → converting → done
    ↓                      ↓
  error                  error
```

- `fetching`：列表中顯示 spinner + meta 文字「抓取中...」
- 抓取成功後：更新檔名、存入 arrayBuffer、狀態改 `waiting`，進入轉換流程
- 抓取失敗：狀態直接改 `error`，錯誤訊息顯示在列表項目中

### `fetchAndConvert` 改造

1. 前端驗證 URL 格式（不變）
2. 驗證通過後，立即建立 FileItem：`{ status: 'fetching', filename: url }`
3. 立即執行：`fileQueue = [item]`、`showState(STATES.LIST)`、`renderFileList()`
4. 清空 `urlInput`
5. 背景非同步執行 `fetch /api/fetch-url`：
   - **成功**：從 response headers 取得 Content-Type 和 X-Page-Title，產生真實檔名，更新 FileItem 的 `filename` 和 `arrayBuffer`，狀態改 `waiting`，呼叫 `updateFileItem` + `processNextFile`
   - **HTTP 錯誤**：解析錯誤訊息，狀態改 `error`，`errorMessage` 寫入失敗原因，呼叫 `updateFileItem` + `updateListHeader`
   - **網路錯誤**：狀態改 `error`，`errorMessage` = `抓取時發生錯誤：${err.message}`
6. 移除 `finally` 中恢復上傳頁面按鈕狀態的邏輯（已切到列表頁，不需要）

### `processNextFile` 修改

尋找下一個待處理項目時，條件為 `item.status === 'waiting'`（現有邏輯），自動跳過 `fetching` 狀態的項目，無需額外改動。

### `createFileItemEl` 修改

`fetching` 狀態的渲染邏輯：
- `iconContent`：顯示 `<div class="spinner-small"></div>`（與 `converting` 相同）
- `metaText`：顯示 `抓取中...`

### `updateListHeader` 修改

`isProcessing` 判斷加入 `fetching`：

```js
const isProcessing = fileQueue.some(
  i => i.status === 'fetching' || i.status === 'converting' || i.status === 'waiting'
);
```

確保在抓取階段 ZIP 下載和重新開始按鈕保持禁用。

### URL 顯示

檔名欄位暫時顯示完整 URL。現有的 `.file-item__name` CSS 已有 `text-overflow: ellipsis` 和 `title` 屬性處理長文字，hover 可看到完整 URL。

### 不變的部分

- `handleFiles`：檔案上傳流程不受影響
- `processNextFile`：核心邏輯不變，只處理 `waiting` 狀態
- Worker 通訊：不受影響
- 伺服器端：不受影響

## 影響範圍

- `js/main.js`：`fetchAndConvert`、`createFileItemEl`、`updateListHeader`
- `css/style.css`：可能需要 `file-item--fetching` 樣式（可沿用 `converting` 的樣式）
