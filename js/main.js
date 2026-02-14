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
const btnUploadMore      = document.getElementById('btn-upload-more');
const btnDownloadZip     = document.getElementById('btn-download-zip');

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

      case 'result':
        handleConversionResult(markdown);
        break;

      case 'error':
        showError(message);
        showState(STATES.UPLOAD);
        break;
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

// ── 錯誤顯示 ──────────────────────────────────────────────────────────────

function showError(message) {
  errorMessage.textContent = message;
  errorBanner.removeAttribute('hidden');
}

function dismissError() {
  errorBanner.setAttribute('hidden', '');
  errorMessage.textContent = '';
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
  if (currentState === STATES.LIST) {
    appendFiles(files);   // Task 9 實作
  } else {
    handleFiles(files);
  }
  fileInput.value = '';
});

// ── 按鈕事件 ──────────────────────────────────────────────────────────────

btnErrorDismiss.addEventListener('click', dismissError);

// ── 初始化 ────────────────────────────────────────────────────────────────

// 啟動 Web Worker
createWorker();
