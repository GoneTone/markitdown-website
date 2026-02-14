# 多檔案上傳實作計畫

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 將單一檔案轉換流程改造為多檔案批次上傳，以統一清單頁面顯示所有檔案的轉換狀態與下載功能。

**Architecture:** main.js 以 `fileQueue`（FileItem 陣列）+ `currentIndex` 管理佇列，Worker 保持「一次一個檔案」協定不變。移除 CONVERTING/RESULT 兩個 UI 狀態，新增 LIST 狀態。清單項目互動以事件委派處理。ZIP 打包使用本地 JSZip，在主執行緒執行。

**Tech Stack:** Vanilla JS (ES2020+), JSZip 3.10.1, CSS custom properties

**Design doc:** `docs/plans/2026-02-15-multi-file-upload-design.md`

---

### Task 1: 下載 JSZip 並加入專案

**Files:**
- Create: `js/lib/jszip.min.js`

**Step 1: 建立目錄**
```bash
mkdir js/lib
```

**Step 2: 下載 JSZip（擇一執行）**

PowerShell:
```powershell
Invoke-WebRequest -Uri "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js" -OutFile "js/lib/jszip.min.js"
```

uv Python:
```bash
"C:/Users/p2902/AppData/Roaming/uv/python/cpython-3.13.3-windows-x86_64-none/python.exe" -c "import urllib.request; urllib.request.urlretrieve('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'js/lib/jszip.min.js')"
```

**Step 3: 確認檔案存在且大小合理（應約 100KB）**
```bash
ls -la js/lib/jszip.min.js
```

**Step 4: Commit**
```bash
git add js/lib/jszip.min.js
git commit -m "feat: 新增 JSZip 3.10.1 函式庫"
```

---

### Task 2: 更新 index.html 結構

**Files:**
- Modify: `index.html`

**Step 1: 在 `<input type="file">` 加上 `multiple` 屬性**

找到（約第 70 行）：
```html
<input type="file"
       id="file-input"
       class="file-input"
       accept=".pdf,.docx,.xlsx,.pptx,.html,.htm,.csv,.epub"
       aria-hidden="true"
       tabindex="-1" />
```
改為：
```html
<input type="file"
       id="file-input"
       class="file-input"
       accept=".pdf,.docx,.xlsx,.pptx,.html,.htm,.csv,.epub"
       multiple
       aria-hidden="true"
       tabindex="-1" />
```

**Step 2: 在 `</body>` 前，`main.js` 的 `<script>` 標籤之前插入 JSZip**
```html
<script src="/js/lib/jszip.min.js"></script>
<script src="/js/main.js"></script>
```

**Step 3: 移除整個 `#state-converting` section**

刪除：
```html
<section id="state-converting" class="state-section" aria-live="polite">
  ...（含所有子元素）...
</section>
```

**Step 4: 移除整個 `#state-result` section**

刪除：
```html
<section id="state-result" class="state-section">
  ...（含所有子元素）...
</section>
```

**Step 5: 在 `#state-upload` section 之後插入 `#state-list` section**

```html
<!-- 狀態二：轉換清單 -->
<section id="state-list" class="state-section">
  <div class="list-container">

    <div class="list-header">
      <span id="list-progress-text"></span>
      <div class="list-header__actions">
        <button id="btn-upload-more" class="btn btn--secondary" type="button">繼續上傳</button>
        <button id="btn-download-zip" class="btn btn--primary" type="button" disabled>全部下載 ZIP</button>
      </div>
    </div>

    <ul id="file-list" class="file-list" aria-live="polite"></ul>

  </div>
</section>
```

**Step 6: Commit**
```bash
git add index.html
git commit -m "feat: 更新 HTML 結構，新增 #state-list"
```

---

### Task 3: 更新 CSS

**Files:**
- Modify: `css/style.css`

**Step 1: 移除以下舊樣式區塊（全文搜尋確認）**

刪除以下 class 的所有規則：
- `.converting-container`
- `.converting-message`
- 大 spinner（`.spinner { ... }`，保留 `.spinner-small`）
- `.result-container`
- `.result-header`
- `.result-meta`
- `.result-filename`
- `.result-stats`
- `.result-actions`
- `.result-preview`
- `.btn--small`（如僅用於 error-banner dismiss，視情況保留）

**Step 2: 在檔案末尾新增清單樣式**

```css
/* ===== 清單狀態 ===== */
.list-container {
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  padding: 2rem 0;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 0.25rem;
  gap: 1rem;
}

.list-header__actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

#list-progress-text {
  font-size: 0.9rem;
  color: var(--color-muted);
}

/* 檔案清單 */
.file-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.file-item {
  border-bottom: 1px solid var(--color-border);
}

.file-item:last-child {
  border-bottom: none;
}

.file-item__row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 0;
  min-height: 3rem;
}

.file-item__icon {
  width: 20px;
  text-align: center;
  flex-shrink: 0;
  font-size: 0.85rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.file-item--done .file-item__icon  { color: #27ae60; }
.file-item--error .file-item__icon { color: #e74c3c; }
.file-item--waiting .file-item__icon { color: var(--color-muted); }

.file-item__name {
  flex: 1;
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.file-item--error .file-item__name {
  color: var(--color-muted);
}

.file-item__meta {
  font-size: 0.8rem;
  color: var(--color-muted);
  flex-shrink: 0;
  white-space: nowrap;
}

.file-item--error .file-item__meta {
  color: #e74c3c;
}

.file-item__btn-preview,
.file-item__btn-download {
  flex-shrink: 0;
  padding: 0.2rem 0.6rem;
  font-size: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 4px);
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
  color: inherit;
  transition: background-color 0.15s;
}

.file-item__btn-preview:hover,
.file-item__btn-download:hover {
  background: var(--color-surface);
}

/* Markdown 預覽展開區 */
.file-item__preview {
  padding: 0.5rem 0 1rem 28px;
}

.file-item__preview pre {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 4px);
  padding: 1rem;
  overflow-x: auto;
  max-height: 400px;
  overflow-y: auto;
  font-size: 0.78rem;
  line-height: 1.5;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
```

**Step 3: Commit**
```bash
git add css/style.css
git commit -m "feat: 新增清單視圖 CSS，移除舊轉換/結果樣式"
```

---

### Task 4: main.js — 常數、狀態追蹤、DOM refs、佇列變數

**Files:**
- Modify: `js/main.js`

此 task 僅做結構調整，不新增任何功能函數。完成後 app **暫時無法正常運作**，後續 task 補完。

**Step 1: 更新頂部檔案說明註解**
```js
/**
 * main.js — UI 邏輯
 *
 * 職責：
 * - 管理 Web Worker 的生命週期
 * - 處理拖放與多檔案選擇
 * - 控制 UI 狀態（上傳 / 清單）
 * - 管理轉換佇列（依序轉換）
 * - 觸發 Markdown 檔案下載與 ZIP 打包
 */
```

**Step 2: 更新 DOM refs 區塊（完整替換）**

移除以下行：
```js
const convertingMsg     = document.getElementById('converting-message');
const resultFilename    = document.getElementById('result-filename');
const resultStats       = document.getElementById('result-stats');
const resultCode        = document.getElementById('result-code');
const btnDownload       = document.getElementById('btn-download');
const btnReset          = document.getElementById('btn-reset');
```

新增以下行：
```js
const fileList           = document.getElementById('file-list');
const listProgressText   = document.getElementById('list-progress-text');
const btnUploadMore      = document.getElementById('btn-upload-more');
const btnDownloadZip     = document.getElementById('btn-download-zip');
```

**Step 3: 更新 STATES 常數**
```js
const STATES = {
  UPLOAD: 'state-upload',
  LIST:   'state-list',
};
```

**Step 4: 新增 currentState 追蹤，更新 showState 函數**
```js
let currentState = STATES.UPLOAD;

function showState(stateName) {
  currentState = stateName;
  Object.values(STATES).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('state-section--active', id === stateName);
  });
}
```

**Step 5: 更新全域狀態變數**

移除：
```js
let currentFilename = '';
let currentMarkdown = '';
let convertStartTime = 0;
```

新增：
```js
let fileQueue    = [];   // FileItem[]
let currentIndex = -1;  // 目前正在轉換的索引
```

**Step 6: 移除已無對應 DOM 元素的事件監聽器**

在「按鈕事件」區塊，移除：
```js
btnDownload.addEventListener('click', downloadMarkdown);

btnReset.addEventListener('click', () => {
  currentMarkdown = '';
  currentFilename = '';
  resultCode.textContent = '';
  showState(STATES.UPLOAD);
});
```

保留：
```js
btnErrorDismiss.addEventListener('click', dismissError);
```

**Step 7: Commit**
```bash
git add js/main.js
git commit -m "refactor: 更新 main.js 常數、DOM refs 與佇列狀態"
```

---

### Task 5: main.js — FileItem 工廠函數 + handleFiles

**Files:**
- Modify: `js/main.js`

**Step 1: 在「檔案處理」區塊，新增 createFileItem 函數（isSupportedFile 之後）**

```js
/**
 * 建立 FileItem 物件
 * @param {File} file
 * @returns {Object}
 */
function createFileItem(file) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const supported = isSupportedFile(file.name);
  return {
    id: crypto.randomUUID(),
    file,
    filename: file.name,
    status: supported ? 'waiting' : 'error',
    errorMessage: supported ? '' : `不支援的格式：.${ext}`,
    markdown: '',
    charCount: 0,
    lineCount: 0,
    duration: 0,
    _startTime: 0,
    expanded: false,
  };
}
```

**Step 2: 新增 handleFiles 函數（取代舊的 handleFile）**

```js
/**
 * 接收選取的檔案，初始化佇列並切換至清單狀態。
 * @param {FileList|File[]} files
 */
function handleFiles(files) {
  if (!isEngineReady) {
    showError('請等待轉換引擎完成載入後再上傳檔案。');
    return;
  }
  fileQueue = Array.from(files).map(createFileItem);
  currentIndex = -1;
  showState(STATES.LIST);
  renderFileList();
  processNextFile();
}
```

**Step 3: 刪除舊的 handleFile 函數（整個函數）**

刪除：
```js
function handleFile(file) { ... }
```

**Step 4: 更新 drop 事件監聽器**
```js
// 修改前
const file = e.dataTransfer?.files?.[0];
if (file) handleFile(file);

// 修改後
const files = e.dataTransfer?.files;
if (files?.length) handleFiles(files);
```

**Step 5: 更新 fileInput change 事件監聽器**
```js
fileInput.addEventListener('change', () => {
  const files = fileInput.files;
  if (!files?.length) return;
  if (currentState === STATES.LIST) {
    appendFiles(files);   // 在 LIST 狀態下追加（Task 9 實作）
  } else {
    handleFiles(files);
  }
  fileInput.value = '';   // 允許重複選同一個檔案
});
```

**Step 6: 刪除 handleConversionResult 和 downloadMarkdown 函數**

刪除整個：
```js
function handleConversionResult(markdown) { ... }
function downloadMarkdown() { ... }
```

**Step 7: Commit**
```bash
git add js/main.js
git commit -m "feat: 新增 createFileItem/handleFiles，更新事件監聽器"
```

---

### Task 6: main.js — 清單渲染函數

**Files:**
- Modify: `js/main.js`

**Step 1: 新增 escapeHtml 工具函數（放在檔案最上方的工具函數區，或「下載功能」區塊之前）**

```js
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

**Step 2: 新增 createFileItemEl 函數（建立單一 `<li>` DOM 元素）**

```js
/**
 * 根據 FileItem 建立 <li> 元素
 * @param {Object} item - FileItem
 * @returns {HTMLLIElement}
 */
function createFileItemEl(item) {
  const li = document.createElement('li');
  li.className = `file-item file-item--${item.status}`;
  li.dataset.id = item.id;

  const iconContent = item.status === 'converting'
    ? '<div class="spinner-small"></div>'
    : '';

  const metaText = item.status === 'done'
    ? `${item.charCount.toLocaleString()} 字 · ${(item.duration / 1000).toFixed(1)}s`
    : item.status === 'error'
      ? escapeHtml(item.errorMessage)
      : '';

  const isDone = item.status === 'done';
  const previewLabel = item.expanded ? '收起' : '預覽';
  const previewContent = item.expanded ? escapeHtml(item.markdown) : '';

  li.innerHTML = `
    <div class="file-item__row">
      <span class="file-item__icon" aria-hidden="true">${iconContent}</span>
      <span class="file-item__name" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</span>
      <span class="file-item__meta">${metaText}</span>
      <button class="file-item__btn-preview" type="button"${isDone ? '' : ' hidden'}>${previewLabel}</button>
      <button class="file-item__btn-download" type="button"${isDone ? '' : ' hidden'}>下載</button>
    </div>
    <div class="file-item__preview"${item.expanded ? '' : ' hidden'}>
      <pre><code>${previewContent}</code></pre>
    </div>
  `;
  return li;
}
```

**Step 3: 新增 updateFileItem 函數**

```js
/**
 * 以最新 item 資料替換 fileList 中既有的 <li>，
 * 若不存在則附加至末尾。
 * @param {Object} item - FileItem
 */
function updateFileItem(item) {
  const existing = fileList.querySelector(`[data-id="${item.id}"]`);
  const newEl = createFileItemEl(item);
  if (existing) {
    existing.replaceWith(newEl);
  } else {
    fileList.appendChild(newEl);
  }
}
```

**Step 4: 新增 updateListHeader 函數**

```js
function updateListHeader() {
  const total  = fileQueue.length;
  const done   = fileQueue.filter(i => i.status === 'done').length;
  const failed = fileQueue.filter(i => i.status === 'error').length;

  const failedNote = failed > 0 ? `（${failed} 個失敗）` : '';
  listProgressText.textContent = `${done} / ${total} 完成${failedNote}`;
  btnDownloadZip.disabled = done === 0;
}
```

**Step 5: 新增 renderFileList 函數**

```js
function renderFileList() {
  fileList.innerHTML = '';
  fileQueue.forEach(item => fileList.appendChild(createFileItemEl(item)));
  updateListHeader();
}
```

**Step 6: Commit**
```bash
git add js/main.js
git commit -m "feat: 新增清單渲染函數"
```

---

### Task 7: main.js — 依序轉換佇列 + worker.onmessage 更新

**Files:**
- Modify: `js/main.js`

**Step 1: 新增 processNextFile 函數（放在「檔案處理」區塊）**

```js
/**
 * 找出佇列中下一個 waiting 項目並送給 Worker 轉換。
 * 若無則更新 header 後結束。
 */
function processNextFile() {
  const nextIndex = fileQueue.findIndex(
    (item, i) => i > currentIndex && item.status === 'waiting'
  );

  if (nextIndex === -1) {
    updateListHeader();
    return;
  }

  currentIndex = nextIndex;
  const item = fileQueue[currentIndex];
  item.status = 'converting';
  item._startTime = Date.now();
  updateFileItem(item);

  const reader = new FileReader();
  reader.onload = (e) => {
    worker.postMessage(
      { type: 'convert', file: e.target.result, filename: item.filename },
      [e.target.result]
    );
  };
  reader.onerror = () => {
    item.status = 'error';
    item.errorMessage = '無法讀取檔案';
    updateFileItem(item);
    updateListHeader();
    processNextFile();
  };
  reader.readAsArrayBuffer(item.file);
}
```

**Step 2: 更新 worker.onmessage 內的 `progress`、`result`、`error` 處理**

在 `createWorker()` 的 `switch` 區塊中：

```js
// 修改 progress（移除對已刪除的 convertingMsg 的操作）
case 'progress':
  if (!isEngineReady) {
    if (engineProgressText) engineProgressText.textContent = message;
    if (engineProgressBar && typeof percent === 'number') {
      engineProgressBar.style.width = `${percent}%`;
    }
  }
  break;

// 替換 result
case 'result': {
  const item = fileQueue[currentIndex];
  if (item) {
    item.status = 'done';
    item.markdown = markdown;
    item.charCount = markdown.length;
    item.lineCount = markdown.split('\n').length;
    item.duration = Date.now() - item._startTime;
    updateFileItem(item);
    updateListHeader();
  }
  processNextFile();
  break;
}

// 替換 error（file-level 錯誤，不彈 error-banner）
case 'error': {
  const item = fileQueue[currentIndex];
  if (item) {
    item.status = 'error';
    item.errorMessage = message || '轉換失敗';
    updateFileItem(item);
    updateListHeader();
  }
  processNextFile();
  break;
}
```

Note: `worker.onerror`（Worker crash，非檔案錯誤）維持現有行為，繼續使用 `showError`。

**Step 3: 手動驗證**

啟動 dev server，開啟 http://localhost:8080，拖放 2–3 個支援格式的檔案：
- ✅ 畫面切換至清單頁
- ✅ 第一個檔案顯示旋轉動畫（converting），其他顯示等待中
- ✅ 轉換完成後依序更新為 done（綠勾、字元數、耗時）
- ✅ header 顯示正確進度「N / M 完成」

**Step 4: Commit**
```bash
git add js/main.js
git commit -m "feat: 實作依序轉換佇列"
```

---

### Task 8: main.js — 下載功能（個別 + ZIP）

**Files:**
- Modify: `js/main.js`

**Step 1: 新增 downloadFile 函數（取代舊的 downloadMarkdown）**

```js
/**
 * 下載單一 FileItem 的 Markdown 輸出
 * @param {Object} item - FileItem (status === 'done')
 */
function downloadFile(item) {
  const filename = item.filename.replace(/\.[^.]+$/, '.md');
  const blob = new Blob([item.markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

**Step 2: 新增 downloadAllZip 函數**

```js
/** 將所有 done 項目打包成 ZIP 下載 */
async function downloadAllZip() {
  const doneItems = fileQueue.filter(i => i.status === 'done');
  if (doneItems.length === 0) return;

  const zip = new JSZip();
  doneItems.forEach(item => {
    const filename = item.filename.replace(/\.[^.]+$/, '.md');
    zip.file(filename, item.markdown);
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'converted.zip';
  a.click();
  URL.revokeObjectURL(url);
}
```

**Step 3: 在「按鈕事件」區塊，新增 fileList 事件委派監聽器**

```js
// 清單項目互動（下載、預覽切換）
fileList.addEventListener('click', (e) => {
  const li = e.target.closest('[data-id]');
  if (!li) return;
  const item = fileQueue.find(i => i.id === li.dataset.id);
  if (!item) return;

  if (e.target.closest('.file-item__btn-download')) {
    downloadFile(item);
  } else if (e.target.closest('.file-item__btn-preview')) {
    item.expanded = !item.expanded;
    updateFileItem(item);
  }
});
```

**Step 4: 綁定 ZIP 按鈕**

```js
btnDownloadZip.addEventListener('click', downloadAllZip);
```

**Step 5: 手動驗證**
- 轉換完成後點擊「下載」→ 應下載 `.md` 檔案，檔名為原檔名（副檔名換為 .md）
- 點擊「預覽」→ 展開 Markdown 內容；再次點擊 → 收起
- 點擊「全部下載 ZIP」→ 應下載 `converted.zip`，解壓後確認內含所有 `.md`

**Step 6: Commit**
```bash
git add js/main.js
git commit -m "feat: 實作個別下載與 ZIP 批次下載"
```

---

### Task 9: main.js — 繼續上傳功能

**Files:**
- Modify: `js/main.js`

**Step 1: 新增 appendFiles 函數**

```js
/**
 * 追加新檔案至現有佇列，並在閒置時繼續轉換。
 * @param {FileList|File[]} files
 */
function appendFiles(files) {
  const newItems = Array.from(files).map(createFileItem);
  fileQueue.push(...newItems);
  newItems.forEach(item => fileList.appendChild(createFileItemEl(item)));
  updateListHeader();

  const isIdle = !fileQueue.some(i => i.status === 'converting');
  if (isIdle) processNextFile();
}
```

**Step 2: 綁定「繼續上傳」按鈕**

```js
btnUploadMore.addEventListener('click', () => fileInput.click());
```

**Step 3: 手動驗證**
- 在清單頁點擊「繼續上傳」→ 觸發檔案選擇
- 選取新檔案後 → 應附加至清單底部，自動開始轉換
- 若前一批還在轉換中，新增的檔案應排隊等待

**Step 4: Commit**
```bash
git add js/main.js
git commit -m "feat: 實作繼續上傳（appendFiles）"
```

---

### Task 10: 最終清理與完整驗證

**Files:**
- Modify: `js/main.js`（確認清理）
- Modify: `css/style.css`（確認清理）

**Step 1: 確認 main.js 中已無死碼**

搜尋以下不應再出現的引用，若存在則刪除：
- `convertingMsg`
- `resultFilename`、`resultStats`、`resultCode`
- `btnDownload`、`btnReset`
- `currentFilename`、`currentMarkdown`、`convertStartTime`
- `STATES.CONVERTING`、`STATES.RESULT`

**Step 2: 確認 css/style.css 中已無孤立樣式**

搜尋以下不應再出現的 class，若存在則刪除：
- `.converting-container`、`.converting-message`
- `.result-container`、`.result-header`、`.result-preview` 等

**Step 3: 完整手動驗證流程**

啟動 dev server，執行以下測試：

1. **引擎載入** — 進度條正常推進至 100% 後隱藏，文件框淡入啟用
2. **單檔轉換** — 拖放 1 個支援格式，確認清單顯示正常，下載 `.md` 可用
3. **多檔轉換** — 拖放 3+ 個檔案（含不支援格式），確認：
   - 不支援格式立即標紅（不送 Worker）
   - 支援格式依序轉換（converting → done）
   - header 顯示「N / M 完成（K 個失敗）」
4. **預覽** — 點擊展開/收起確認正常
5. **個別下載** — 每個 done 項目下載檔名正確
6. **ZIP 下載** — 確認 `converted.zip` 只含成功項目
7. **繼續上傳** — 追加檔案後正常入列轉換
8. **鍵盤操作** — Tab 到文件框後按 Enter/Space 可觸發選擇

**Step 4: Commit**
```bash
git add js/main.js css/style.css
git commit -m "refactor: 清理多檔案重構後的舊程式碼"
```
