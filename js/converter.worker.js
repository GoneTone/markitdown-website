/**
 * converter.worker.js
 * Web Worker：在背景執行緒載入 Pyodide 並執行 MarkItDown 文件轉換。
 *
 * 與主執行緒的訊息協定：
 *   接收 { type: 'convert', file: ArrayBuffer, filename: string }
 *   傳送 { type: 'ready' }                          → 初始化完成
 *   傳送 { type: 'progress', message: string }      → 進度更新
 *   傳送 { type: 'result', markdown: string }       → 轉換成功
 *   傳送 { type: 'error', message: string }         → 轉換失敗
 */

importScripts('/pyodide/pyodide.js');

let pyodide = null;
let isReady = false;

/** 傳送進度訊息至主執行緒 */
function sendProgress(message) {
  self.postMessage({ type: 'progress', message });
}

/** 初始化 Pyodide 並安裝所有套件 */
async function initialize() {
  try {
    sendProgress('正在載入 Python 執行環境...');
    pyodide = await loadPyodide({
      indexURL: '/pyodide/',
    });

    sendProgress('正在載入套件管理器...');
    await pyodide.loadPackage('micropip');
    const micropip = pyodide.pyimport('micropip');

    sendProgress('正在讀取套件清單...');
    const response = await fetch('/wheels/manifest.json');
    if (!response.ok) {
      throw new Error(`無法讀取套件清單：${response.status} ${response.statusText}`);
    }
    const manifest = await response.json();

    if (manifest.length === 0) {
      throw new Error('wheels/manifest.json 為空，請重新執行建置腳本');
    }

    sendProgress(`正在安裝 ${manifest.length} 個套件...`);
    const wheelUrls = manifest.map(filename => `/wheels/${filename}`);

    // 安裝所有套件（micropip 會自動處理依賴順序）
    await micropip.install(wheelUrls);

    sendProgress('正在初始化 MarkItDown...');
    // 預先 import 以確認安裝成功
    await pyodide.runPythonAsync(`
import io
import os
import tempfile
from markitdown import MarkItDown

# 建立 MarkItDown 實例（關閉所有需要外部 API 的功能）
_md = MarkItDown(enable_plugins=False)
print("MarkItDown 初始化成功")
    `);

    isReady = true;
    self.postMessage({ type: 'ready' });

  } catch (err) {
    self.postMessage({
      type: 'error',
      message: `初始化失敗：${err.message}\n\n請確認建置腳本已成功執行，且瀏覽器支援 WebAssembly。`,
    });
  }
}

/** 執行文件轉換 */
async function convertFile(fileBuffer, filename) {
  if (!isReady || !pyodide) {
    throw new Error('Pyodide 尚未完成初始化');
  }

  sendProgress('解析文件中...');

  // 將 ArrayBuffer 傳入 Python
  pyodide.globals.set('_file_bytes', new Uint8Array(fileBuffer));
  pyodide.globals.set('_filename', filename);

  sendProgress('轉換為 Markdown...');
  const result = await pyodide.runPythonAsync(`
import io, os, tempfile

# 取得副檔名（含點號，例如 ".pdf"）
_ext = os.path.splitext(_filename)[1].lower()

# 寫入 Pyodide 虛擬檔案系統的暫存檔
_tmp_path = f"/tmp/upload{_ext}"
with open(_tmp_path, "wb") as f:
    f.write(bytes(_file_bytes.tolist()))

# 執行轉換
try:
    _result = _md.convert(_tmp_path)
    _markdown = _result.text_content
finally:
    try:
        os.unlink(_tmp_path)
    except:
        pass

_markdown  # 回傳值
  `);

  return result;
}

/** 處理來自主執行緒的訊息 */
self.onmessage = async (event) => {
  const { type, file, filename } = event.data;

  if (type === 'convert') {
    try {
      const markdown = await convertFile(file, filename);
      self.postMessage({ type: 'result', markdown });
    } catch (err) {
      self.postMessage({
        type: 'error',
        message: `轉換失敗：${err.message}`,
      });
    }
  }
};

// 啟動時立即初始化
initialize();
