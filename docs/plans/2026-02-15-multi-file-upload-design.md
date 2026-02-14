# 多檔案上傳設計文件

日期：2026-02-15

## 背景

目前系統一次只能處理一個檔案，完成後顯示全螢幕 Markdown 預覽。
本設計新增多檔案批次上傳支援，並統一單檔與多檔的結果顯示方式。

## 需求

- 使用者可一次選取或拖放多個檔案
- 依序轉換（單一 Worker，一次處理一個）
- 清單檢視：每個檔案顯示狀態、字元數、耗時
- 某檔案失敗時跳過，繼續處理其餘檔案
- 每個完成的檔案可個別下載；全部完成後可打包成 ZIP 下載
- 使用者可在清單頁繼續上傳更多檔案

## 狀態機

### 現有

```
UPLOAD → CONVERTING → RESULT
```

### 修改後

```
UPLOAD → LIST
```

- 移除 `CONVERTING` 狀態（旋轉動畫頁）
- 移除 `RESULT` 狀態（全螢幕 Markdown 預覽）
- 新增 `LIST` 狀態，統一承擔單檔與多檔的結果顯示

使用者選取檔案後立即切換至 LIST 狀態，同時開始轉換第一個檔案。

## 資料模型

每個檔案項目（`FileItem`）：

```js
{
  id: string,           // crypto.randomUUID()
  file: File,           // 原始 File 物件
  filename: string,
  status: 'waiting' | 'converting' | 'done' | 'error',
  markdown: string,     // 轉換成功後填入
  errorMessage: string, // 轉換失敗後填入
  charCount: number,
  lineCount: number,
  duration: number,     // 毫秒
  expanded: boolean,    // 預覽區是否展開
}
```

### 佇列管理（main.js）

```
fileQueue: FileItem[]   — 完整清單（含所有狀態的項目）
currentIndex: number    — 目前正在轉換的索引
```

轉換流程：

1. 使用者選取檔案 → 建立 `FileItem[]`，`currentIndex = 0`
2. 切換至 LIST 狀態，渲染清單
3. 對 `fileQueue[currentIndex]` 執行 `FileReader.readAsArrayBuffer()`，送給 Worker
4. Worker 回傳 `result` 或 `error` → 更新該項目的 DOM → `currentIndex++` → 送出下一個
5. 全部處理完畢後，若有至少一個 `done`，啟用「全部下載 ZIP」按鈕

Worker 協定不變，仍為一次一個檔案。

## UI 結構

### HTML 變更

1. `<input type="file">` 加上 `multiple` 屬性
2. 移除 `#state-converting`、`#state-result`
3. 新增 `#state-list`

```html
<section id="state-list" class="state-section">
  <div class="list-container">

    <div class="list-header">
      <span id="list-progress-text">0 / 3 完成</span>
      <div class="list-header__actions">
        <button id="btn-upload-more">繼續上傳</button>
        <button id="btn-download-zip" disabled>全部下載 ZIP</button>
      </div>
    </div>

    <ul id="file-list" class="file-list"></ul>

  </div>
</section>
```

### 每列結構（動態渲染）

```html
<li class="file-item file-item--[status]" data-id="[id]">
  <div class="file-item__row">
    <span class="file-item__icon" aria-hidden="true">…</span>
    <span class="file-item__name">report.pdf</span>
    <span class="file-item__meta">1,234 字 · 0.8s</span>
    <button class="file-item__btn-preview">預覽</button>
    <button class="file-item__btn-download">下載</button>
  </div>
  <div class="file-item__preview" hidden>
    <pre><code>…</code></pre>
  </div>
</li>
```

### 列狀態樣式

| Class | 圖示 | meta / 按鈕 |
|-------|------|------------|
| `file-item--waiting` | 灰色時鐘 | 隱藏 |
| `file-item--converting` | 旋轉動畫 | 隱藏 |
| `file-item--done` | 綠色勾選 | 顯示（字元數、耗時、下載、預覽） |
| `file-item--error` | 紅色 ✕ | 顯示錯誤訊息 |

## 錯誤處理

| 情境 | 處理方式 |
|------|---------|
| 個別檔案轉換失敗 | 標為 `error`，顯示錯誤訊息，繼續下一個 |
| 不支援的副檔名 | 建立 FileItem 時立即標為 `error: 不支援的格式`，不送 Worker |
| 全部失敗 | 「全部下載 ZIP」維持 disabled |

移除現有的全域 `error-banner`，錯誤直接顯示在清單列上。

## ZIP 下載

引入 `JSZip`（本地 `/js/lib/jszip.min.js`，不依賴 CDN）。
所有 `status === 'done'` 的項目打包成一個 ZIP，於主執行緒執行，不需修改 Worker。

## 不在範圍內

- 拖曳排序佇列
- 暫停 / 取消個別轉換
- 轉換歷史紀錄（頁面重整後清除）
