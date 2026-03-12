# 網址輸入區塊離線禁用設計

## 目標

當使用者無網路連線時，禁用網址輸入轉換區塊並顯示原因，讓使用者清楚知道為何無法使用網址轉換功能。網路恢復時自動解除禁用。

## 方案

擴展現有 `checkConnectivity()` 回呼（方案 A），在同一個函式內同時控制 `offline-banner` 和 URL 輸入區塊的狀態。不引入新機制。

## 設計細節

### HTML

在 `.url-input-group` 下方新增行內提示元素，預設隱藏：

```html
<p id="url-offline-hint" class="url-input-hint" hidden>
  目前無網路連線，無法使用網址轉換。
</p>
```

位置在 `.url-input-area > .url-input-group` 之後。

### CSS

行內提示採用與 `offline-banner` 同色系（`#f0a500`），以小字呈現：

```css
.url-input-hint {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: #f0a500;
}

.url-input-hint[hidden] {
  display: none;
}
```

### JS

#### 新增狀態變數與元素參考

```js
const urlOfflineHint = document.getElementById('url-offline-hint');
let isOnline = false;
```

#### 擴展 `checkConnectivity()`

```js
async function checkConnectivity() {
  try {
    await fetch(`/sw.js?_sw_bypass=1&_t=${Date.now()}`, {
      method: 'HEAD',
      cache: 'no-store',
    });
    isOnline = true;
    offlineBanner.setAttribute('hidden', '');
    urlOfflineHint.setAttribute('hidden', '');
    if (isEngineReady) {
      urlInput.disabled = false;
      btnFetchUrl.disabled = false;
    }
  } catch {
    isOnline = false;
    offlineBanner.removeAttribute('hidden');
    urlOfflineHint.removeAttribute('hidden');
    urlInput.disabled = true;
    btnFetchUrl.disabled = true;
  }
}
```

#### Engine 就緒時加入 `isOnline` 檢查

原本 engine 就緒後直接啟用 URL 輸入的位置，改為：

```js
if (isOnline) {
  urlInput.disabled = false;
  btnFetchUrl.disabled = false;
}
```

#### 重置回上傳頁時

URL 輸入的 disabled 狀態根據 `isOnline && isEngineReady` 決定，而非一律啟用。

### 邊界情況

| 情境 | 處理方式 |
|------|----------|
| 轉換進行中切到離線 | fetch 請求自然失敗，進入既有錯誤處理 |
| 離線時回到上傳頁（重置） | URL 輸入根據 `isOnline && isEngineReady` 決定 disabled 狀態 |
| 頁面載入即離線 | 初始 `checkConnectivity()` 偵測離線，URL 輸入維持 disabled 並顯示行內提示 |
| 離線 → 上線自動恢復 | 依賴現有 `online` 事件 + 定時輪詢，偵測到上線即解除 disabled |

### 視覺行為摘要

- **離線時**：頂部顯示 `offline-banner`、URL 輸入與按鈕 disabled（opacity 0.5）、輸入區下方顯示橙黃色提示「目前無網路連線，無法使用網址轉換。」
- **上線時**：隱藏 `offline-banner`、隱藏行內提示、URL 輸入根據 engine 狀態啟用
- Placeholder 文字不變，維持原本的「輸入網頁網址，例如 https://example.com」

## 不做的事

- 不為 URL 區塊建立獨立的離線偵測機制
- 不引入自訂事件系統
- 不修改 placeholder 文字
