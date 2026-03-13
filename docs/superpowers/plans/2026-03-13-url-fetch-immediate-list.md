# URL 抓取立即進入列表顯示 - 實作計畫

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 URL 抓取與檔案上傳擁有一致的 UX——點擊轉換後立即進入列表頁，在列表項目中顯示 `fetching` 狀態。

**Architecture:** 改造 `fetchAndConvert` 為「先建 item 進列表、再背景 fetch」模式。新增 `fetching` FileItem 狀態，搭配 `AbortController` 取消機制。所有改動限於 `js/main.js` 和 `css/style.css`。

**Tech Stack:** Vanilla JS、CSS

**Spec:** `docs/superpowers/specs/2026-03-13-url-fetch-immediate-list-design.md`

---

## File Map

- **Modify:** `js/main.js` — `fetchAndConvert`、`createFileItemEl`、`updateListHeader`、`resetToUpload`，新增模組變數 `currentFetchController`
- **Modify:** `css/style.css` — 新增 `.file-item--fetching` 樣式

---

## Chunk 1: 實作

### Task 1: 更新 `createFileItemEl` 支援 `fetching` 狀態

**Files:**
- Modify: `js/main.js:437-445`

- [ ] **Step 1: 修改 `iconContent` 判斷，加入 `fetching`**

將 `js/main.js:437-439` 從：

```js
const iconContent = item.status === 'converting'
  ? '<div class="spinner-small"></div>'
  : '';
```

改為：

```js
const iconContent = (item.status === 'converting' || item.status === 'fetching')
  ? '<div class="spinner-small"></div>'
  : '';
```

- [ ] **Step 2: 修改 `metaText` 判斷，加入 `fetching`**

將 `js/main.js:441-445` 從：

```js
const metaText = item.status === 'done'
  ? `${item.charCount.toLocaleString()} 字 · ${(item.duration / 1000).toFixed(1)}s`
  : item.status === 'error'
    ? escapeHtml(item.errorMessage)
    : '';
```

改為：

```js
const metaText = item.status === 'done'
  ? `${item.charCount.toLocaleString()} 字 · ${(item.duration / 1000).toFixed(1)}s`
  : item.status === 'error'
    ? escapeHtml(item.errorMessage)
    : item.status === 'fetching'
      ? '抓取中...'
      : '';
```

### Task 2: 更新 `updateListHeader` 加入 `fetching` 狀態

**Files:**
- Modify: `js/main.js:486`

- [ ] **Step 1: 修改 `isProcessing` 判斷**

將 `js/main.js:486` 從：

```js
const isProcessing = fileQueue.some(i => i.status === 'converting' || i.status === 'waiting');
```

改為：

```js
const isProcessing = fileQueue.some(i => i.status === 'fetching' || i.status === 'converting' || i.status === 'waiting');
```

### Task 3: 新增模組變數 `currentFetchController`

**Files:**
- Modify: `js/main.js:56`（在 `fileQueue` 宣告附近）

- [ ] **Step 1: 在 `let currentIndex = -1;` 後新增**

```js
let currentFetchController = null;
```

### Task 4: 改造 `fetchAndConvert`

**Files:**
- Modify: `js/main.js:258-336`

- [ ] **Step 1: 改寫 `fetchAndConvert` 函式**

將整個函式（`js/main.js:258-336`）替換為：

```js
async function fetchAndConvert(urlString) {
  // 前端驗證
  if (!/^https?:\/\//i.test(urlString)) {
    showError('請輸入有效的網址（以 http:// 或 https:// 開頭）');
    return;
  }

  // 取消前一次尚未完成的抓取（防禦性）
  currentFetchController?.abort();
  currentFetchController = new AbortController();

  // 立即建立 FileItem 並切換到列表頁
  const item = {
    id: crypto.randomUUID(),
    file: null,
    arrayBuffer: null,
    filename: urlString,
    status: 'fetching',
    errorMessage: '',
    markdown: '',
    charCount: 0,
    lineCount: 0,
    duration: 0,
    _startTime: 0,
    expanded: false,
  };

  fileQueue = [item];
  currentIndex = -1;
  urlInput.value = '';
  showState(STATES.LIST);
  renderFileList();

  try {
    const response = await fetch(
      `/api/fetch-url?url=${encodeURIComponent(urlString)}`,
      { signal: currentFetchController.signal }
    );

    // 檢查 item 是否仍在佇列中（使用者可能已按重新開始）
    if (!fileQueue.includes(item)) return;

    if (!response.ok) {
      let errMsg = `抓取失敗（${response.status}）`;
      try {
        const errData = await response.json();
        if (errData.error) errMsg = errData.error;
      } catch { /* ignore parse error */ }
      item.status = 'error';
      item.errorMessage = errMsg;
      updateFileItem(item);
      updateListHeader();
      return;
    }

    const contentType = response.headers.get('content-type') || '';
    const mimeType = parseMimeType(contentType);
    const rawTitle = response.headers.get('x-page-title');
    const pageTitle = rawTitle ? decodeURIComponent(rawTitle) : '';
    const filename = generateFilename(urlString, mimeType, pageTitle);

    if (!filename) {
      item.status = 'error';
      item.errorMessage = `不支援的內容類型：${mimeType || '未知'}`;
      updateFileItem(item);
      updateListHeader();
      return;
    }

    const arrayBuffer = await response.arrayBuffer();

    // 再次檢查 item 是否仍在佇列中
    if (!fileQueue.includes(item)) return;

    // 更新 FileItem 並進入轉換流程
    item.filename = deduplicateFilename(filename, new Set(fileQueue.filter(i => i !== item).map(i => i.filename)));
    item.arrayBuffer = arrayBuffer;
    item.status = 'waiting';
    updateFileItem(item);
    processNextFile();
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (!fileQueue.includes(item)) return;
    item.status = 'error';
    item.errorMessage = `抓取時發生錯誤：${err.message}`;
    updateFileItem(item);
    updateListHeader();
  } finally {
    currentFetchController = null;
  }
}
```

### Task 5: 更新 `resetToUpload` 加入取消機制和控制項恢復

**Files:**
- Modify: `js/main.js:608-618`

- [ ] **Step 1: 改寫 `resetToUpload` 函式**

將 `js/main.js:608-618` 從：

```js
function resetToUpload() {
  fileQueue = [];
  currentIndex = -1;
  fileList.innerHTML = '';
  urlInput.value = '';
  fileInput.value = '';
  dismissError();
  urlInput.disabled = !(isOnline && isEngineReady);
  btnFetchUrl.disabled = !(isOnline && isEngineReady);
  showState(STATES.UPLOAD);
}
```

改為：

```js
function resetToUpload() {
  currentFetchController?.abort();
  currentFetchController = null;
  fileQueue = [];
  currentIndex = -1;
  fileList.innerHTML = '';
  urlInput.value = '';
  fileInput.value = '';
  dismissError();
  urlInput.disabled = !(isOnline && isEngineReady);
  btnFetchUrl.disabled = !(isOnline && isEngineReady);
  btnFetchUrl.textContent = '轉換';
  if (isEngineReady) {
    dropZone.classList.remove('drop-zone--disabled');
  }
  fileInput.disabled = false;
  showState(STATES.UPLOAD);
}
```

### Task 6: 新增 CSS 樣式

**Files:**
- Modify: `css/style.css:537`（在 `.file-item--waiting` 後面）

- [ ] **Step 1: 新增 `.file-item--fetching` icon 顏色**

在 `.file-item--waiting .file-item__icon` 規則後面新增：

```css
.file-item--fetching .file-item__icon { color: var(--color-muted); }
```

### Task 7: 提交

- [ ] **Step 1: 提交所有變更**

```bash
git add js/main.js css/style.css
git commit -m "feat: URL 抓取點擊後立即進入列表顯示狀態

新增 fetching FileItem 狀態，讓 URL 抓取與檔案上傳擁有一致的 UX。
點擊轉換後立即切換到列表頁顯示抓取進度，而非在上傳頁等待。
加入 AbortController 取消機制，確保重新開始時能取消進行中的抓取。"
```

### Task 8: 手動驗證

- [ ] **Step 1: 啟動開發伺服器**

```bash
docker compose -f docker-compose-dev.yml up
```

- [ ] **Step 2: 驗證 URL 抓取流程**

1. 開啟 http://localhost:3000
2. 輸入一個有效網址（例如 `https://example.com`），點擊「轉換」
3. 確認立即切換到列表頁，顯示 URL 作為檔名 + spinner + 「抓取中...」
4. 等待抓取完成，確認檔名更新為真實名稱，狀態變為 converting → done
5. 確認可正常下載、預覽

- [ ] **Step 3: 驗證錯誤處理**

1. 輸入一個圖片 URL（例如 `https://example.com/image.png`），確認列表項目顯示錯誤
2. 輸入無效 URL，確認 error banner 顯示（前端驗證，未進列表）

- [ ] **Step 4: 驗證取消機制**

1. 輸入一個網址，點擊轉換後立即點擊「重新開始」
2. 確認回到上傳頁面，所有控制項正常可用
3. 確認 console 無錯誤

- [ ] **Step 5: 驗證檔案上傳未受影響**

1. 拖放一個 PDF 檔案，確認流程正常
