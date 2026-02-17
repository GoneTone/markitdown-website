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

// ── DOM 元素 ──────────────────────────────────────────────────────────────

const engineStatus      = document.getElementById('engine-status');
const engineStatusText  = document.getElementById('engine-status-text');
const dropZone          = document.getElementById('drop-zone');
const fileInput         = document.getElementById('file-input');
const errorBanner       = document.getElementById('error-banner');
const errorMessage      = document.getElementById('error-message');
const btnErrorDismiss   = document.getElementById('btn-error-dismiss');
const engineProgressBar = document.getElementById('engine-progress-bar');
const engineProgressText = document.getElementById('engine-progress-text');
const fileList           = document.getElementById('file-list');
const listProgressText   = document.getElementById('list-progress-text');
const btnUploadMore         = document.getElementById('btn-upload-more');
const btnDownloadZip        = document.getElementById('btn-download-zip');
const btnUploadMoreFooter        = document.getElementById('btn-upload-more-footer');
const btnDownloadZipFooter       = document.getElementById('btn-download-zip-footer');
const listProgressTextFooter     = document.getElementById('list-progress-text-footer');

// ── 狀態管理 ──────────────────────────────────────────────────────────────

const STATES = {
  UPLOAD: 'state-upload',
  LIST:   'state-list',
};

let currentState = STATES.UPLOAD;

function showState(stateName) {
  currentState = stateName;
  Object.values(STATES).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('state-section--active', id === stateName);
  });
}

// ── Web Worker 管理 ───────────────────────────────────────────────────────

let worker = null;
let isEngineReady = false;
let fileQueue    = [];   // FileItem[]
let currentIndex = -1;  // 目前正在轉換的索引

function createWorker() {
  worker = new Worker('/js/converter.worker.js');

  worker.onmessage = (event) => {
    const { type, message, markdown, percent } = event.data;

    switch (type) {
      case 'ready':
        isEngineReady = true;
        setEngineStatus('ready', '就緒');
        // 等進度條 100% 的 transition（0.5s）播完後，同步顯示文件框並隱藏進度條
        setTimeout(() => {
          dropZone.classList.remove('drop-zone--disabled');
          document.getElementById('upload-engine-status').hidden = true;
        }, 600);
        break;

      case 'progress':
        if (!isEngineReady) {
          if (engineProgressText) engineProgressText.textContent = message;
          if (engineProgressBar && typeof percent === 'number') {
            engineProgressBar.style.width = `${percent}%`;
          }
        }
        break;

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
    }
  };

  worker.onerror = (err) => {
    showError(`Worker 發生錯誤：${err.message}`);
    setEngineStatus('error', '引擎錯誤');
    document.getElementById('upload-engine-status').hidden = true;
    showState(STATES.UPLOAD);
  };
}

/** 更新引擎狀態指示器 */
function setEngineStatus(state, text) {
  engineStatus.className = `engine-status engine-status--${state}`;
  engineStatusText.textContent = text;
}

// ── 檔案處理 ──────────────────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = new Set([
  'pdf', 'docx', 'xlsx', 'pptx',
  'html', 'htm', 'csv', 'epub',
]);

/** 驗證副檔名是否支援 */
function isSupportedFile(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * 若 filename 已存在於 existingNames，
 * 在主檔名後附加 (1)、(2)… 直到不重複為止。
 * @param {string} filename
 * @param {Set<string>} existingNames
 * @returns {string}
 */
function deduplicateFilename(filename, existingNames) {
  if (!existingNames.has(filename)) return filename;
  const lastDot = filename.lastIndexOf('.');
  const base = lastDot !== -1 ? filename.slice(0, lastDot) : filename;
  const ext  = lastDot !== -1 ? filename.slice(lastDot) : '';
  let n = 1;
  let candidate;
  do { candidate = `${base} (${n++})${ext}`; } while (existingNames.has(candidate));
  return candidate;
}

/**
 * 建立 FileItem 物件
 * @param {File} file
 * @param {Set<string>} existingNames - 已使用的檔名集合（用於去重）
 * @returns {Object}
 */
function createFileItem(file, existingNames = new Set()) {
  const filename  = deduplicateFilename(file.name, existingNames);
  const ext       = file.name.split('.').pop()?.toLowerCase() ?? '';
  const supported = isSupportedFile(file.name);
  return {
    id: crypto.randomUUID(),
    file,
    filename,
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

/**
 * 接收選取的檔案，初始化佇列並切換至清單狀態。
 * @param {FileList|File[]} files
 */
function handleFiles(files) {
  if (!isEngineReady) {
    showError('請等待轉換引擎完成載入後再上傳檔案。');
    return;
  }
  const seen = new Set();
  fileQueue = Array.from(files).map(file => {
    const item = createFileItem(file, seen);
    seen.add(item.filename);
    return item;
  });
  currentIndex = -1;
  showState(STATES.LIST);
  renderFileList();
  processNextFile();
}

/**
 * 追加新檔案至現有佇列，並在閒置時繼續轉換。
 * 前提：僅在 currentState === STATES.LIST 時呼叫（引擎必然已就緒）。
 * @param {FileList|File[]} files
 */
function appendFiles(files) {
  const seen = new Set(fileQueue.map(i => i.filename));
  const newItems = Array.from(files).map(file => {
    const item = createFileItem(file, seen);
    seen.add(item.filename);
    return item;
  });
  fileQueue.push(...newItems);
  newItems.forEach(item => fileList.appendChild(createFileItemEl(item)));
  updateListHeader();

  const isWorkerFree = !fileQueue.some(i => i.status === 'converting');
  if (isWorkerFree) processNextFile();
}

// ── 下載功能 ──────────────────────────────────────────────────────────────

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
  const now = new Date();
  const ts = now.getFullYear().toString()
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0')
    + '-'
    + String(now.getHours()).padStart(2, '0')
    + String(now.getMinutes()).padStart(2, '0')
    + String(now.getSeconds()).padStart(2, '0');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `markitdown_${ts}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── 錯誤顯示 ──────────────────────────────────────────────────────────────

function showError(message) {
  errorMessage.textContent = message;
  errorBanner.removeAttribute('hidden');
}

function dismissError() {
  errorBanner.setAttribute('hidden', '');
  errorMessage.textContent = '';
}

// ── 清單渲染 ──────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

function updateListHeader() {
  const total  = fileQueue.length;
  const done   = fileQueue.filter(i => i.status === 'done').length;
  const failed = fileQueue.filter(i => i.status === 'error').length;

  const isProcessing = fileQueue.some(i => i.status === 'converting' || i.status === 'waiting');
  const failedNote = failed > 0 ? `（${failed} 個失敗）` : '';
  const progressText = `${done} / ${total} 完成${failedNote}`;
  listProgressText.textContent = progressText;
  listProgressTextFooter.textContent = progressText;
  const zipDisabled = done === 0 || isProcessing;
  btnDownloadZip.disabled = zipDisabled;
  btnDownloadZipFooter.disabled = zipDisabled;
}

function renderFileList() {
  fileList.innerHTML = '';
  fileQueue.forEach(item => fileList.appendChild(createFileItemEl(item)));
  updateListHeader();
}

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

// ── 拖放事件 ──────────────────────────────────────────────────────────────

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (!dropZone.classList.contains('drop-zone--disabled')) {
    dropZone.classList.add('drop-zone--dragging');
  }
});

dropZone.addEventListener('dragleave', (e) => {
  if (!dropZone.contains(e.relatedTarget)) {
    dropZone.classList.remove('drop-zone--dragging');
  }
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('drop-zone--dragging');
  const files = e.dataTransfer?.files;
  if (files?.length) handleFiles(files);
});

dropZone.addEventListener('click', () => {
  if (!dropZone.classList.contains('drop-zone--disabled')) {
    fileInput.click();
  }
});

dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (!dropZone.classList.contains('drop-zone--disabled')) {
      fileInput.click();
    }
  }
});

// ── 清單拖放事件（全頁範圍）────────────────────────────────────────────────

document.addEventListener('dragover', (e) => {
  if (currentState !== STATES.LIST) return;
  e.preventDefault();
  document.body.classList.add('page--dragging');
});

document.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) {
    document.body.classList.remove('page--dragging');
  }
});

document.addEventListener('drop', (e) => {
  if (currentState !== STATES.LIST) return;
  e.preventDefault();
  document.body.classList.remove('page--dragging');
  const files = e.dataTransfer?.files;
  if (files?.length) appendFiles(files);
});

fileInput.addEventListener('change', () => {
  const files = fileInput.files;
  if (!files?.length) return;
  if (currentState === STATES.LIST) {
    appendFiles(files);   // Task 9 實作
  } else {
    handleFiles(files);
  }
  fileInput.value = '';
});

// ── 按鈕事件 ──────────────────────────────────────────────────────────────

btnErrorDismiss.addEventListener('click', dismissError);
btnUploadMore.addEventListener('click', () => fileInput.click());
btnUploadMoreFooter.addEventListener('click', () => fileInput.click());

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

btnDownloadZip.addEventListener('click', downloadAllZip);
btnDownloadZipFooter.addEventListener('click', downloadAllZip);

// ── 離線狀態偵測 ──────────────────────────────────────────────────────────

const offlineBanner = document.getElementById('offline-banner');

/**
 * 透過實際 fetch 確認真實連線狀態。
 *
 * 不使用 navigator.onLine：在 iOS Safari 等行動瀏覽器上，
 * 即使完全離線也可能回傳 true，不可靠。
 *
 * 請求帶 _sw_bypass 參數，SW 會略過快取直接打網路；
 * 離線時 fetch 拋出錯誤，即可確認為離線狀態。
 */
async function checkConnectivity() {
  try {
    await fetch(`/sw.js?_sw_bypass=1&_t=${Date.now()}`, {
      method: 'HEAD',
      cache: 'no-store',
    });
    offlineBanner.setAttribute('hidden', '');
  } catch {
    offlineBanner.removeAttribute('hidden');
  }
}

window.addEventListener('online', checkConnectivity);
window.addEventListener('offline', checkConnectivity);

// 手機切換 app 或螢幕解鎖後回到前景時重新檢查
// （mobile 瀏覽器在背景時可能不觸發 offline/online 事件）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkConnectivity();
});

// 定時輪詢：補足行動瀏覽器 offline/online 事件不可靠的問題
// 頁面不可見時跳過，避免浪費資源
setInterval(() => {
  if (document.visibilityState === 'visible') checkConnectivity();
}, 5000);

checkConnectivity();

// ── 初始化 ────────────────────────────────────────────────────────────────

// 啟動 Web Worker
createWorker();
