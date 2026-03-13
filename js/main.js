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
const btnDownloadZip        = document.getElementById('btn-download-zip');
const btnDownloadZipFooter       = document.getElementById('btn-download-zip-footer');
const listProgressTextFooter     = document.getElementById('list-progress-text-footer');
const btnRestart            = document.getElementById('btn-restart');
const btnRestartFooter      = document.getElementById('btn-restart-footer');
const urlInput         = document.getElementById('url-input');
const btnFetchUrl      = document.getElementById('btn-fetch-url');
const urlOfflineHint   = document.getElementById('url-offline-hint');

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
let isOnline      = false;
let fileQueue    = [];   // FileItem[]
let currentIndex = -1;  // 目前正在轉換的索引
let currentFetchController = null; // URL 抓取的 AbortController

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
          if (isOnline) {
            urlInput.disabled = false;
            btnFetchUrl.disabled = false;
          }
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

/** Content-Type → 副檔名對應表 */
const MIME_TO_EXT = {
  'text/html': '.html',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/csv': '.csv',
  'application/epub+zip': '.epub',
};

/**
 * 從 Content-Type header 取得 MIME type（忽略 charset 等參數）
 * @param {string} contentType
 * @returns {string}
 */
function parseMimeType(contentType) {
  return (contentType || '').split(';')[0].trim().toLowerCase();
}

/**
 * 清理字串使其可作為檔名（移除檔案系統不允許的字元）
 * @param {string} name
 * @returns {string}
 */
function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
}

/**
 * 從 URL、Content-Type 及可選的頁面標題產生檔名
 * @param {string} urlString
 * @param {string} mimeType - 已解析的 MIME type
 * @param {string} [pageTitle] - 頁面 <title>（可選）
 * @returns {string|null}
 */
function generateFilename(urlString, mimeType, pageTitle) {
  const ext = MIME_TO_EXT[mimeType];
  if (!ext) return null; // 不支援的類型

  // 優先使用頁面標題
  if (pageTitle) {
    const sanitized = sanitizeFilename(pageTitle);
    if (sanitized) return sanitized + ext;
  }

  let baseName;
  try {
    const url = new URL(urlString);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const lastSegment = pathSegments[pathSegments.length - 1] || '';

    if (lastSegment) {
      // 去除原有副檔名
      const dotIndex = lastSegment.lastIndexOf('.');
      baseName = dotIndex > 0 ? lastSegment.slice(0, dotIndex) : lastSegment;
    } else {
      baseName = url.hostname;
    }
  } catch {
    baseName = 'page';
  }

  return baseName + ext;
}

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
 * 從 URL 抓取內容並建立虛擬 FileItem 送入轉換佇列
 * @param {string} urlString
 */
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
    _startTime: Date.now(),
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

  const isProcessing = fileQueue.some(i => i.status === 'fetching' || i.status === 'converting' || i.status === 'waiting');
  const failedNote = failed > 0 ? `（${failed} 個失敗）` : '';
  const progressText = `${done} / ${total} 完成${failedNote}`;
  listProgressText.textContent = progressText;
  listProgressTextFooter.textContent = progressText;
  const zipDisabled = done === 0 || isProcessing;
  btnDownloadZip.disabled = zipDisabled;
  btnDownloadZipFooter.disabled = zipDisabled;
  btnRestart.disabled = isProcessing;
  btnRestartFooter.disabled = isProcessing;
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
  if (!item._startTime) item._startTime = Date.now();
  updateFileItem(item);

  // URL 抓取的虛擬 FileItem 已有 arrayBuffer，直接送入 Worker
  if (item.arrayBuffer) {
    const buffer = item.arrayBuffer;
    item.arrayBuffer = null; // 轉移後釋放參考
    try {
      worker.postMessage(
        { type: 'convert', file: buffer, filename: item.filename },
        [buffer]
      );
    } catch (err) {
      item.status = 'error';
      item.errorMessage = '無法傳送檔案至 Worker';
      updateFileItem(item);
      updateListHeader();
      processNextFile();
    }
    return;
  }

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

fileInput.addEventListener('change', () => {
  const files = fileInput.files;
  if (!files?.length) return;
  handleFiles(files);
  fileInput.value = '';
});

// ── 按鈕事件 ──────────────────────────────────────────────────────────────

/** 重置所有狀態，回到初始上傳畫面 */
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

btnRestart.addEventListener('click', resetToUpload);
btnRestartFooter.addEventListener('click', resetToUpload);
btnErrorDismiss.addEventListener('click', dismissError);

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
