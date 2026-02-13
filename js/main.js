/**
 * main.js — UI 邏輯
 *
 * 職責：
 * - 管理 Web Worker 的生命週期
 * - 處理拖放與檔案選擇
 * - 控制三種 UI 狀態（上傳 / 轉換中 / 完成）
 * - 觸發 Markdown 檔案下載
 */

// ── DOM 元素 ──────────────────────────────────────────────────────────────

const engineStatus     = document.getElementById('engine-status');
const engineStatusText = document.getElementById('engine-status-text');
const dropZone         = document.getElementById('drop-zone');
const fileInput        = document.getElementById('file-input');
const convertingMsg    = document.getElementById('converting-message');
const resultFilename   = document.getElementById('result-filename');
const resultStats      = document.getElementById('result-stats');
const resultCode       = document.getElementById('result-code');
const btnDownload      = document.getElementById('btn-download');
const btnReset         = document.getElementById('btn-reset');
const errorBanner      = document.getElementById('error-banner');
const errorMessage     = document.getElementById('error-message');
const btnErrorDismiss  = document.getElementById('btn-error-dismiss');

// ── 狀態管理 ──────────────────────────────────────────────────────────────

const STATES = {
  UPLOAD:     'state-upload',
  CONVERTING: 'state-converting',
  RESULT:     'state-result',
};

/** 切換 UI 狀態（只顯示對應的 section） */
function showState(stateName) {
  Object.values(STATES).forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.toggle('state-section--active', id === stateName);
    }
  });
}

// ── Web Worker 管理 ───────────────────────────────────────────────────────

let worker = null;
let isEngineReady = false;
let currentFilename = '';
let currentMarkdown = '';
let convertStartTime = 0;

function createWorker() {
  worker = new Worker('/js/converter.worker.js');

  worker.onmessage = (event) => {
    const { type, message, markdown } = event.data;

    switch (type) {
      case 'ready':
        isEngineReady = true;
        setEngineStatus('ready', '就緒');
        dropZone.classList.remove('drop-zone--disabled');
        document.getElementById('upload-engine-status').hidden = true;
        break;

      case 'progress':
        convertingMsg.textContent = message;
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
  'html', 'htm', 'csv', 'json', 'xml', 'epub',
]);

/** 驗證副檔名是否支援 */
function isSupportedFile(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return SUPPORTED_EXTENSIONS.has(ext);
}

/** 處理選取的檔案 */
function handleFile(file) {
  if (!isEngineReady) {
    showError('請等待轉換引擎完成載入後再上傳檔案。');
    return;
  }

  if (!isSupportedFile(file.name)) {
    const ext = file.name.split('.').pop()?.toUpperCase() ?? '未知';
    showError(
      `不支援的格式：.${ext}\n\n` +
      `支援的格式：PDF、DOCX、XLSX、PPTX、HTML、CSV、JSON、XML、EPUB`
    );
    return;
  }

  currentFilename = file.name;
  convertStartTime = Date.now();
  showState(STATES.CONVERTING);
  convertingMsg.textContent = '準備中...';

  const reader = new FileReader();
  reader.onload = (e) => {
    // 將 ArrayBuffer 傳給 Worker（使用 Transferable 避免複製）
    worker.postMessage(
      { type: 'convert', file: e.target.result, filename: file.name },
      [e.target.result]
    );
  };
  reader.onerror = () => {
    showError('無法讀取檔案，請重試。');
    showState(STATES.UPLOAD);
  };
  reader.readAsArrayBuffer(file);
}

/** 轉換成功後更新 UI */
function handleConversionResult(markdown) {
  currentMarkdown = markdown;
  const elapsed = ((Date.now() - convertStartTime) / 1000).toFixed(1);
  const lines = markdown.split('\n').length;
  const chars = markdown.length;

  resultFilename.textContent = currentFilename.replace(/\.[^.]+$/, '.md');
  resultStats.textContent = `${chars.toLocaleString()} 字元 · ${lines.toLocaleString()} 行 · 耗時 ${elapsed}s`;
  resultCode.textContent = markdown;

  showState(STATES.RESULT);
}

// ── 下載功能 ──────────────────────────────────────────────────────────────

function downloadMarkdown() {
  if (!currentMarkdown) return;

  const outputFilename = currentFilename.replace(/\.[^.]+$/, '.md');
  const blob = new Blob([currentMarkdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = outputFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
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
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
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
  const file = fileInput.files?.[0];
  if (file) {
    handleFile(file);
    fileInput.value = ''; // 允許重複選同一個檔案
  }
});

// ── 按鈕事件 ──────────────────────────────────────────────────────────────

btnDownload.addEventListener('click', downloadMarkdown);

btnReset.addEventListener('click', () => {
  currentMarkdown = '';
  currentFilename = '';
  resultCode.textContent = '';
  showState(STATES.UPLOAD);
});

btnErrorDismiss.addEventListener('click', dismissError);

// ── 初始化 ────────────────────────────────────────────────────────────────

// 在 Pyodide 就緒前禁用上傳
dropZone.classList.add('drop-zone--disabled');

// 啟動 Web Worker
createWorker();
