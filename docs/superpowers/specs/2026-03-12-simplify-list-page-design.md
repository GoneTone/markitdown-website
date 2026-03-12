# 簡化列表頁為純結果檢視

## 目標

將轉換結果列表頁從「可繼續操作」簡化為「純結果檢視」，移除所有上傳和 URL 輸入功能，僅保留結果瀏覽與下載。

## 現況

列表頁（`#state-list`）目前包含：
- URL 輸入框 + 轉換按鈕（header 和 footer 各一組）
- 「繼續上傳」按鈕（header 和 footer 各一個）
- 「全部下載 ZIP」按鈕（header 和 footer 各一個）
- 拖放上傳功能（drop zone 事件在 state-list 時仍可觸發）
- 檔案結果清單

## 變更

### 移除

1. **URL 輸入框**：`#url-input-list`、`#btn-fetch-url-list`、`#url-input-list-footer`、`#btn-fetch-url-list-footer`
2. **「繼續上傳」按鈕**：`#btn-upload-more`、`#btn-upload-more-footer`
3. **列表頁拖放上傳**：state-list 狀態時 drop zone 不接受檔案
4. **CSS 樣式**：`.url-input--compact`、`.url-input__btn--compact`

### 保留

- 檔案結果清單 `#file-list`
- 「全部下載 ZIP」按鈕（header/footer）
- 進度文字 `#list-progress-text` / `#list-progress-text-footer`

### 新增

- **「重新開始」按鈕**（header/footer 各一個），取代原「繼續上傳」按鈕

### 「重新開始」行為

**前提條件：** 轉換仍在進行中時（`isProcessing === true`），「重新開始」按鈕應 disabled，避免中途重置導致 Worker 訊息寫入已清空的佇列。

點擊後完全重置：
1. 清空 `fileItems[]` 陣列
2. 清空 `#file-list` 的 DOM 內容
3. 重置轉換進度計數（完成數、失敗數等）
4. 隱藏 `#state-list`，顯示 `#state-upload`
5. 清空上傳頁的 URL 輸入框（`#url-input`）
6. 重置 `#file-input` 的 value

### 拖放停用

document 層級的 `dragover`/`dragleave`/`drop` handler 需加入守衛，當 `currentState !== STATES.UPLOAD` 時 return early，不接受檔案。上傳頁的拖放功能不受影響。`.page--dragging` CSS 保留（上傳頁仍使用）。

### 死碼清理

移除列表頁功能後，以下程式碼變成不可達，應一併移除：
- `appendFiles()` 函式（原用於列表頁追加檔案）
- `fileInput.change` handler 中 `currentState === STATES.LIST` 分支
- `fetchAndConvert()` 中 `currentState === STATES.LIST` 分支
- 列表頁 URL 相關的 4 個 DOM 引用與事件監聽

## 涉及檔案

| 檔案 | 變更類型 | 說明 |
|------|---------|------|
| `index.html` | 修改 | 移除 URL input/button x4，「繼續上傳」→「重新開始」 |
| `css/style.css` | 修改 | 移除 `.url-input--compact`、`.url-input__btn--compact` |
| `js/main.js` | 修改 | 移除列表頁 URL DOM 引用與事件監聽；停用 state-list 拖放；新增「重新開始」重置邏輯 |

## 驗收條件

- 列表頁僅顯示結果清單 + 「重新開始」+ 「全部下載 ZIP」按鈕
- 點擊「重新開始」回到空白上傳頁，所有狀態已重置
- 在列表頁拖放檔案無任何反應
- 轉換進行中時「重新開始」按鈕為 disabled
- 瀏覽器 console 無因已移除 DOM 元素產生的錯誤

## 不涉及

- 上傳頁（`#state-upload`）的 URL 輸入功能不受影響
- 後端 proxy、Service Worker、Docker 設定不需變更
- 轉換邏輯不需變更
