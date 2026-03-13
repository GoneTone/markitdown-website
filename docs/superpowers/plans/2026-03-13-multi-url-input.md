# Multi-URL Input Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to paste multiple URLs (one per line, max 10) in a textarea for batch conversion to Markdown.

**Architecture:** Replace the single-line `<input type="url">` with a `<textarea>`, add a `parseUrls()` function for validation, and refactor `fetchAndConvert()` into `fetchAndConvertMultiple()` that sequentially fetches each URL and feeds them into the existing conversion queue.

**Tech Stack:** Vanilla JS, CSS, HTML — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-03-13-multi-url-input-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `index.html:117-138` | Modify | Replace `<input>` with `<textarea>`, restructure button layout, add hint/error elements |
| `css/style.css:656-710` | Modify | Update `.url-input-group` layout, textarea styles, add `.file-item--queued`, hint/error styles |
| `js/main.js` | Modify | Add `parseUrls()`, replace `fetchAndConvert()` with `fetchAndConvertMultiple()`, update event listeners, update `updateListHeader()` and `createFileItemEl()` |

---

## Chunk 1: HTML + CSS Changes

### Task 1: Update HTML — textarea and new elements

**Files:**
- Modify: `index.html:117-138`

- [ ] **Step 1: Replace `<input>` with `<textarea>` and restructure layout**

Replace lines 121-138 in `index.html` with:

```html
      <div class="url-input-area">
        <div class="url-input-group">
          <textarea
            id="url-input"
            class="url-input"
            placeholder="每行輸入一個網址，例如：&#10;https://example.com&#10;https://docs.python.org"
            aria-describedby="url-offline-hint url-input-hint url-limit-error"
            rows="3"
            disabled
          ></textarea>
          <div class="url-input-actions">
            <p id="url-input-hint" class="url-input-hint">每行一個網址，最多 10 個</p>
            <p id="url-limit-error" class="url-limit-error" hidden>最多輸入 10 個網址</p>
            <button id="btn-fetch-url" class="btn btn--primary url-input__btn" type="button" disabled>
              轉換
            </button>
          </div>
        </div>
        <p id="url-offline-hint" class="url-input-hint url-input-hint--warning" hidden>
          目前無網路連線，無法使用網址轉換。
        </p>
      </div>
```

Note: `&#10;` is a newline character in HTML attribute, which displays as a line break in the textarea placeholder.

- [ ] **Step 2: Verify HTML renders correctly**

Run: `docker compose -f docker-compose-dev.yml up` and open `http://localhost:3000`
Expected: The textarea appears with the placeholder text showing multiple lines. The "轉換" button is below the textarea on the right. The hint "每行一個網址，最多 10 個" appears below left.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: replace URL input with textarea for multi-URL support"
```

### Task 2: Update CSS for textarea layout

**Files:**
- Modify: `css/style.css:656-710`

- [ ] **Step 1: Update `.url-input-group` and `.url-input` styles**

Replace the CSS at lines 662-710 with:

```css
.url-input-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.url-input {
  width: 100%;
  min-height: 80px;
  padding: 0.75rem 1rem;
  background: #1e1e1e;
  border: 2px solid #444;
  border-radius: 8px;
  color: #e0e0e0;
  font-size: 0.95rem;
  font-family: inherit;
  line-height: 1.6;
  resize: vertical;
  outline: none;
  transition: border-color 0.2s;
}

.url-input:focus {
  border-color: #6c9fff;
}

.url-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.url-input::placeholder {
  color: #666;
}

.url-input-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.url-input__btn {
  white-space: nowrap;
  padding: 0.75rem 1.5rem;
}

.url-input__btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.url-input-hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-muted);
}

.url-input-hint--warning {
  margin: 0.5rem 0 0;
  color: #f0a500;
}

.url-input-hint[hidden] {
  display: none;
}

.url-limit-error {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-error);
}

.url-limit-error[hidden] {
  display: none;
}
```

- [ ] **Step 2: Add `.file-item--queued` CSS**

Add after the existing `.file-item--fetching` rule (around line 538):

```css
.file-item--queued .file-item__icon { color: var(--color-muted); }
```

- [ ] **Step 3: Verify visually**

Open `http://localhost:3000` and confirm:
- Textarea displays correctly with proper height and styling
- "每行一個網址，最多 10 個" hint is visible below left
- "轉換" button is aligned right of the hint
- Overall layout matches the dark theme

- [ ] **Step 4: Commit**

```bash
git add css/style.css
git commit -m "feat: update CSS for textarea layout and queued status"
```

---

## Chunk 2: parseUrls function

### Task 3: Add `parseUrls()` function with tests

**Files:**
- Modify: `js/main.js` (add function after `deduplicateFilename`, around line 228)

Since this is a browser-only project without a JS test runner for `main.js`, we verify behavior through manual testing and code review. The function is pure and deterministic.

- [ ] **Step 1: Add the `parseUrls` function**

Add after `deduplicateFilename()` (after line 228) in `js/main.js`:

```javascript
/**
 * 解析 textarea 文字為 URL 物件陣列
 * @param {string} text - textarea 內容
 * @returns {{ entries: Array<{url: string, valid: boolean}>, error: string|null }}
 */
function parseUrls(text) {
  const MAX_URLS = 10;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { entries: [], error: null };

  // 去重（保留第一個出現的）
  const unique = [...new Set(lines)];

  // 上限檢查
  if (unique.length > MAX_URLS) {
    return { entries: [], error: `最多輸入 ${MAX_URLS} 個網址` };
  }

  // 驗證每個 URL
  const entries = unique.map(url => ({
    url,
    valid: /^https?:\/\//i.test(url),
  }));

  return { entries, error: null };
}
```

- [ ] **Step 2: Verify in browser console**

Open browser DevTools console and test:
```javascript
// These are internal tests — paste into console to verify
console.assert(parseUrls('').entries.length === 0);
console.assert(parseUrls('  \n  \n  ').entries.length === 0);
console.assert(parseUrls('https://a.com\nhttps://b.com').entries.length === 2);
console.assert(parseUrls('https://a.com\nhttps://a.com').entries.length === 1); // dedup
console.assert(parseUrls('not-a-url').entries[0].valid === false);
console.assert(parseUrls('https://a.com').entries[0].valid === true);
// 11 unique URLs should return error
console.assert(parseUrls(Array.from({length: 11}, (_, i) => `https://${i}.com`).join('\n')).error !== null);
console.log('All parseUrls tests passed');
```

- [ ] **Step 3: Commit**

```bash
git add js/main.js
git commit -m "feat: add parseUrls function for multi-URL parsing and validation"
```

---

## Chunk 3: fetchAndConvertMultiple + event listener updates

### Task 4: Add `fetchAndConvertMultiple()` function

**Files:**
- Modify: `js/main.js` (replace `fetchAndConvert` at lines 259-349)

- [ ] **Step 1: Add the new DOM element reference**

At the top of `js/main.js` (after line 32), add:

```javascript
const urlLimitError    = document.getElementById('url-limit-error');
```

- [ ] **Step 2: Replace `fetchAndConvert` with `fetchAndConvertMultiple`**

Replace the entire `fetchAndConvert` function (lines 259-349) with:

```javascript
/**
 * 從多個 URL 逐一抓取內容並建立虛擬 FileItem 送入轉換佇列
 * @param {Array<{url: string, valid: boolean}>} urlEntries
 */
async function fetchAndConvertMultiple(urlEntries) {
  // 取消前一次尚未完成的批次（防禦性）
  currentFetchController?.abort();
  currentFetchController = new AbortController();
  const signal = currentFetchController.signal;

  // 建立所有 FileItem
  const existingNames = new Set();
  const items = urlEntries.map(entry => {
    const item = {
      id: crypto.randomUUID(),
      file: null,
      arrayBuffer: null,
      filename: entry.url,
      status: entry.valid ? 'queued' : 'error',
      errorMessage: entry.valid ? '' : '網址格式無效',
      markdown: '',
      charCount: 0,
      lineCount: 0,
      duration: 0,
      _startTime: 0,
      expanded: false,
    };
    return item;
  });

  // 切換到列表視圖
  fileQueue = items;
  currentIndex = -1;
  urlInput.value = '';
  showState(STATES.LIST);
  renderFileList();

  // 逐一抓取有效的 URL
  for (const item of items) {
    if (item.status !== 'queued') continue;
    if (signal.aborted) break;

    // 更新為 fetching 狀態
    item.status = 'fetching';
    item._startTime = Date.now();
    updateFileItem(item);
    updateListHeader();

    try {
      const response = await fetch(
        `/api/fetch-url?url=${encodeURIComponent(item.filename)}`,
        { signal }
      );

      // 檢查 item 是否仍在佇列中（使用者可能已按重新開始）
      if (!fileQueue.includes(item)) continue;

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
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      const mimeType = parseMimeType(contentType);
      const rawTitle = response.headers.get('x-page-title');
      const pageTitle = rawTitle ? decodeURIComponent(rawTitle) : '';
      const filename = generateFilename(item.filename, mimeType, pageTitle);

      if (!filename) {
        item.status = 'error';
        item.errorMessage = `不支援的內容類型：${mimeType || '未知'}`;
        updateFileItem(item);
        updateListHeader();
        continue;
      }

      const arrayBuffer = await response.arrayBuffer();

      // 再次檢查 item 是否仍在佇列中
      if (!fileQueue.includes(item)) continue;

      // 更新 FileItem 並進入轉換流程
      const usedNames = new Set(fileQueue.filter(i => i !== item).map(i => i.filename));
      item.filename = deduplicateFilename(filename, usedNames);
      item.arrayBuffer = arrayBuffer;
      item.status = 'waiting';
      updateFileItem(item);
      processNextFile();
    } catch (err) {
      if (err.name === 'AbortError') break;
      if (!fileQueue.includes(item)) continue;
      item.status = 'error';
      item.errorMessage = `抓取時發生錯誤：${err.message}`;
      updateFileItem(item);
      updateListHeader();
    }
  }

  // 整個迴圈結束後才清除 controller
  currentFetchController = null;
}
```

- [ ] **Step 3: Commit**

```bash
git add js/main.js
git commit -m "feat: add fetchAndConvertMultiple for batch URL processing"
```

### Task 5: Update event listeners and UI logic

**Files:**
- Modify: `js/main.js` (lines 450-510 for createFileItemEl/updateListHeader, lines 665-676 for event listeners)

- [ ] **Step 1: Update `createFileItemEl` to handle `queued` status**

In `createFileItemEl()` (around line 450), update the `iconContent` and `metaText` logic:

Replace:
```javascript
  const iconContent = (item.status === 'converting' || item.status === 'fetching')
    ? '<div class="spinner-small"></div>'
    : '';

  const metaText = item.status === 'done'
    ? `${item.charCount.toLocaleString()} 字 · ${(item.duration / 1000).toFixed(1)}s`
    : item.status === 'error'
      ? escapeHtml(item.errorMessage)
      : item.status === 'fetching'
        ? '抓取中...'
        : '';
```

With:
```javascript
  const iconContent = (item.status === 'converting' || item.status === 'fetching')
    ? '<div class="spinner-small"></div>'
    : '';

  const metaText = item.status === 'done'
    ? `${item.charCount.toLocaleString()} 字 · ${(item.duration / 1000).toFixed(1)}s`
    : item.status === 'error'
      ? escapeHtml(item.errorMessage)
      : item.status === 'fetching'
        ? '抓取中...'
        : item.status === 'queued'
          ? '排隊中'
          : '';
```

- [ ] **Step 2: Update `updateListHeader` to include `queued` in `isProcessing`**

In `updateListHeader()` (line 501), replace:

```javascript
  const isProcessing = fileQueue.some(i => i.status === 'fetching' || i.status === 'converting' || i.status === 'waiting');
```

With:

```javascript
  const isProcessing = fileQueue.some(i => i.status === 'queued' || i.status === 'fetching' || i.status === 'converting' || i.status === 'waiting');
```

- [ ] **Step 3: Update button click handler and remove Enter key listener**

Replace the URL event listeners (lines 665-676):

```javascript
// URL 抓取
btnFetchUrl.addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (url) fetchAndConvert(url);
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (url) fetchAndConvert(url);
  }
});
```

With:

```javascript
// URL 批次抓取
btnFetchUrl.addEventListener('click', () => {
  const text = urlInput.value.trim();
  if (!text) return;

  // 隱藏之前的上限錯誤
  urlLimitError.setAttribute('hidden', '');

  const { entries, error } = parseUrls(text);

  if (error) {
    urlLimitError.textContent = error;
    urlLimitError.removeAttribute('hidden');
    return;
  }

  if (entries.length === 0) return;

  fetchAndConvertMultiple(entries);
});
```

Note: The `urlInput.addEventListener('keydown', ...)` listener is intentionally removed. Enter now inserts newlines in the textarea (default behavior).

- [ ] **Step 4: Update `resetToUpload` to clear limit error**

In `resetToUpload()` (around line 623), add after `dismissError();` (line 631):

```javascript
  urlLimitError.setAttribute('hidden', '');
```

- [ ] **Step 5: Commit**

```bash
git add js/main.js
git commit -m "feat: update UI logic for multi-URL queued status and event handlers"
```

---

## Chunk 4: Integration testing and cache busting

### Task 6: Manual integration testing

- [ ] **Step 1: Test single URL (backward compatibility)**

1. Enter one URL in the textarea: `https://example.com`
2. Click "轉換"
Expected: Item appears as "排隊中" → "抓取中..." (with spinner) → converts → done. Same behavior as before.

- [ ] **Step 2: Test multiple valid URLs**

1. Paste into textarea:
```
https://example.com
https://httpbin.org/html
```
2. Click "轉換"
Expected: Two items appear all as "排隊中". First becomes "抓取中..." then "waiting" → "converting" → done. Second follows sequentially.

- [ ] **Step 3: Test mixed valid/invalid URLs**

1. Paste:
```
https://example.com
not-a-valid-url
ftp://invalid.protocol
https://httpbin.org/html
```
2. Click "轉換"
Expected: 4 items in list. Items 2 and 3 immediately show error "網址格式無效". Items 1 and 4 process normally.

- [ ] **Step 4: Test over-limit (11 URLs)**

1. Paste 11 different URLs
2. Click "轉換"
Expected: Submission blocked. Error message "最多輸入 10 個網址" appears below textarea. No items in list.

- [ ] **Step 5: Test duplicate URLs**

1. Paste:
```
https://example.com
https://example.com
https://httpbin.org/html
```
2. Click "轉換"
Expected: Only 2 items in list (duplicate removed silently).

- [ ] **Step 6: Test empty/whitespace input**

1. Enter only whitespace and newlines
2. Click "轉換"
Expected: Nothing happens.

- [ ] **Step 7: Test "重新開始" button**

1. Submit multiple URLs
2. Wait until processing completes
3. Click "重新開始"
Expected: Returns to upload page, textarea is empty and enabled.

### Task 7: Cache busting and version update

**Files:**
- Modify: `index.html` (APP_VERSION, `?v=` query params)
- Modify: `sw.js` (APP_VERSION)

- [ ] **Step 1: Check current version**

Read `APP_VERSION` from `index.html` and `sw.js`.

- [ ] **Step 2: Increment version**

Update `APP_VERSION` in both `index.html` and `sw.js` (patch increment). Update all `?v=` query parameters in `index.html`.

- [ ] **Step 3: Commit**

```bash
git add index.html sw.js
git commit -m "chore: bump version for multi-URL input feature"
```

### Task 8: Update README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update feature description**

Add multi-URL batch conversion to the features section of README.md, mentioning textarea input with max 10 URLs.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for multi-URL input feature"
```
