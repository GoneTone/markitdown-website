# URL 抓取圓形進度條 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 URL 抓取列表項目的「抓取中...」文字後方新增 28px 圓形進度條，顯示真實的下載進度百分比。

**Architecture:** 前端改用 `ReadableStream` 逐塊讀取 response body，搭配 `Content-Length` header 計算進度。使用 SVG 圓環元件呈現，透過輕量 DOM 更新（只修改 attribute/textContent）避免效能問題。

**Tech Stack:** 純前端 HTML/CSS/JS，SVG 圓形進度條，ReadableStream API

---

## Chunk 1: CSS + HTML 圓形進度條元件

### Task 1: 新增圓形進度條 CSS 樣式

**Files:**
- Modify: `css/style.css:637` (在 `.spinner-small` 區塊之後)

- [ ] **Step 1: 在 `css/style.css` 的 `.spinner-small` 規則後方新增 `.progress-ring` 樣式**

在 line 637（`}` closing `.spinner-small`）之後插入：

```css
/* 抓取進度圓環 */
.progress-ring {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
}

.progress-ring svg {
  transform: rotate(-90deg);
}

.progress-ring__track {
  fill: none;
  stroke: var(--color-border);
  stroke-width: 2.5;
}

.progress-ring__bar {
  fill: none;
  stroke: var(--color-highlight);
  stroke-width: 2.5;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.3s ease;
}

.progress-ring__pct {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 600;
  color: var(--color-text);
}

/* 不定進度（無 Content-Length） */
.progress-ring--indeterminate svg {
  animation: spin 1.2s linear infinite;
}

.progress-ring--indeterminate .progress-ring__bar {
  stroke-dasharray: 25 44;
}
```

- [ ] **Step 2: 更新 `.file-item__meta` 加入 flex 以支援圓環對齊**

修改 `css/style.css` line 554-559 的 `.file-item__meta`，加入 `display: flex; align-items: center; gap: 0.5rem;`：

```css
.file-item__meta {
  font-size: 0.8rem;
  color: var(--color-muted);
  flex-shrink: 0;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
```

- [ ] **Step 3: 驗證 CSS 載入無錯誤**

開啟 http://localhost:3000，確認頁面正常載入無 CSS 錯誤。既有列表項目外觀不應有任何變化。

- [ ] **Step 4: Commit**

```bash
git add css/style.css
git commit -m "style: 新增圓形進度條 CSS 元件樣式"
```

---

### Task 2: 在 `createFileItemEl` 中渲染圓形進度條 HTML

**Files:**
- Modify: `js/main.js:506-544` (`createFileItemEl` 函式)

- [ ] **Step 1: 修改 `createFileItemEl` 在 fetching 狀態時產生進度條 HTML**

在 `js/main.js` 的 `createFileItemEl` 函式中，在 `metaText` 計算之後、`li.innerHTML` 之前，新增進度條 HTML 生成邏輯：

```js
// 在 line 525 (metaText 結尾) 之後插入：
const CIRCUMFERENCE = 2 * Math.PI * 11; // r=11, ≈ 69.115
let progressRingHtml = '';
if (item.status === 'fetching') {
  const p = item.fetchProgress;
  const percent = p ? p.percent : -1;
  const isIndeterminate = percent < 0;
  const offset = isIndeterminate ? 0 : CIRCUMFERENCE * (1 - percent / 100);
  const dasharray = isIndeterminate ? '25 44' : CIRCUMFERENCE.toFixed(2);
  const pctText = isIndeterminate ? '' : `${percent}%`;
  progressRingHtml = `
    <span class="progress-ring${isIndeterminate ? ' progress-ring--indeterminate' : ''}">
      <svg width="28" height="28" viewBox="0 0 28 28">
        <circle class="progress-ring__track" cx="14" cy="14" r="11"/>
        <circle class="progress-ring__bar" cx="14" cy="14" r="11"
          stroke-dasharray="${dasharray}" stroke-dashoffset="${offset.toFixed(2)}"/>
      </svg>
      <span class="progress-ring__pct">${pctText}</span>
    </span>`;
}
```

- [ ] **Step 2: 將 `progressRingHtml` 插入 `<span class="file-item__meta">` 內**

修改 `li.innerHTML` 模板，把 `${metaText}` 改為 `${metaText}${progressRingHtml}`：

```js
// 原本：
<span class="file-item__meta">${metaText}</span>
// 改為：
<span class="file-item__meta">${metaText}${progressRingHtml}</span>
```

- [ ] **Step 3: 驗證 fetching 狀態顯示進度條**

開啟 http://localhost:3000，輸入一個 URL（如 PDF 檔）觸發抓取。確認：
- fetching 狀態時出現「抓取中...」文字 + 圓形進度條（此時應為不定進度動畫，因為還未實作進度追蹤）
- 其他狀態（queued、converting、done、error）無進度條

- [ ] **Step 4: Commit**

```bash
git add js/main.js
git commit -m "feat: 抓取狀態列表項目顯示圓形進度條 UI"
```

---

## Chunk 2: 進度追蹤與 DOM 更新

### Task 3: 新增 `fetchProgress` 資料欄位與 `updateFetchProgress` 函式

**Files:**
- Modify: `js/main.js:294-314` (file item 初始化)
- Modify: `js/main.js:551-559` (`updateFileItem` 附近)

- [ ] **Step 1: 在 URL file item 初始化時加入 `fetchProgress` 屬性**

修改 `fetchAndConvertMultiple` 中的 items 初始化（line 301-314），新增 `fetchProgress` 欄位：

```js
const items = urlEntries.map(entry => ({
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
  fetchProgress: null,  // { loaded: number, total: number, percent: number (-1=indeterminate) }
}));
```

- [ ] **Step 2: 新增 `updateFetchProgress` 函式**

在 `updateFileItem` 函式之後（line 559 之後）插入：

```js
/**
 * 輕量更新抓取進度 — 只修改 SVG 屬性和百分比文字，不重建 DOM。
 * @param {Object} item - FileItem
 */
function updateFetchProgress(item) {
  const el = fileList.querySelector(`[data-id="${item.id}"]`);
  if (!el) return;
  const ring = el.querySelector('.progress-ring');
  const bar = el.querySelector('.progress-ring__bar');
  const pct = el.querySelector('.progress-ring__pct');
  if (!ring || !bar || !pct) return;

  const p = item.fetchProgress;
  if (!p || p.percent < 0) return; // indeterminate，不需更新

  const CIRCUMFERENCE = 2 * Math.PI * 11;
  // 從不定進度切換到確定進度：移除 indeterminate class、設定 dasharray
  if (ring.classList.contains('progress-ring--indeterminate')) {
    ring.classList.remove('progress-ring--indeterminate');
    bar.setAttribute('stroke-dasharray', CIRCUMFERENCE.toFixed(2));
  }
  bar.style.strokeDashoffset = (CIRCUMFERENCE * (1 - p.percent / 100)).toFixed(2);
  pct.textContent = `${p.percent}%`;
}
```

- [ ] **Step 3: Commit**

```bash
git add js/main.js
git commit -m "feat: 新增 fetchProgress 資料欄位及輕量 DOM 更新函式"
```

---

### Task 4: 改用 ReadableStream 讀取 response body 追蹤下載進度

**Files:**
- Modify: `js/main.js:386-397` (`fetchAndConvertMultiple` 中的 `response.arrayBuffer()` 區段)

- [ ] **Step 1: 將 `response.arrayBuffer()` 替換為 ReadableStream 逐塊讀取**

修改 `fetchAndConvertMultiple` 函式中 line 386 的 `const arrayBuffer = await response.arrayBuffer();` 及其後續程式碼（到 line 397），替換為：

```js
      // ── 逐塊讀取 response body，追蹤下載進度 ──
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      item.fetchProgress = { loaded: 0, total: contentLength, percent: contentLength > 0 ? 0 : -1 };
      updateFileItem(item); // 重建 DOM 以顯示正確的進度條初始狀態

      const reader = response.body.getReader();
      const chunks = [];
      let loaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        item.fetchProgress.loaded = loaded;
        if (contentLength > 0) {
          item.fetchProgress.percent = Math.min(Math.round((loaded / contentLength) * 100), 100);
        }
        updateFetchProgress(item);
      }

      // 再次檢查 item 是否仍在佇列中
      if (!fileQueue.includes(item)) continue;

      // 合併 chunks 為 ArrayBuffer
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      const arrayBuffer = merged.buffer;

      // ── 完成過渡：顯示 100% 停留 0.5 秒 ──
      item.fetchProgress.percent = 100;
      updateFetchProgress(item);
      await new Promise(r => setTimeout(r, 500));

      // 更新 FileItem 並進入轉換流程
      const usedNames = new Set(fileQueue.filter(i => i !== item).map(i => i.filename));
      item.filename = deduplicateFilename(filename, usedNames);
      item.arrayBuffer = arrayBuffer;
      item.status = 'waiting';
      updateFileItem(item);
      processNextFile();
```

注意：此段取代了原本 line 386-397 的全部內容。`filename` 變數已在上方（line 376）定義。

- [ ] **Step 2: 驗證完整流程**

開啟 http://localhost:3000，測試以下情境：

1. **PDF URL**（如大型 PDF）：應顯示真實百分比進度 0%→100%，停留 0.5 秒後切換為「轉換中...」
2. **一般網頁 URL**：可能無 Content-Length，應顯示不定進度旋轉動畫
3. **多個 URL 同時輸入**：逐一抓取，每個項目獨立顯示進度
4. **無效 URL**：應直接顯示錯誤，無進度條

- [ ] **Step 3: Commit**

```bash
git add js/main.js
git commit -m "feat: URL 抓取顯示真實下載進度的圓形進度條"
```

---

## Chunk 3: 快取破壞與文件更新

### Task 5: 版本號與快取破壞

**Files:**
- Modify: `index.html` (APP_VERSION, CSS/JS query params)
- Modify: `sw.js` (APP_VERSION, CACHE_VERSION)
- Modify: `README.md` (功能描述更新)

- [ ] **Step 1: 遞增 `APP_VERSION`**

查看目前 `index.html` 和 `sw.js` 中的 `APP_VERSION`，將 patch 版本號遞增 1（例如 `1.x.y` → `1.x.(y+1)`）。同步更新兩個檔案。

- [ ] **Step 2: 更新 `index.html` 中所有 `?v=` 查詢參數**

搜尋 `index.html` 中所有 `?v=` 參數，更新為新版本號。

- [ ] **Step 3: 遞增 `sw.js` 的 `CACHE_VERSION`**

將 `CACHE_VERSION` 數字 +1。

- [ ] **Step 4: 更新 `README.md`**

在功能描述中新增圓形進度條的說明。

- [ ] **Step 5: Commit**

```bash
git add index.html sw.js README.md
git commit -m "chore: 遞增版本號並更新快取破壞參數"
```
