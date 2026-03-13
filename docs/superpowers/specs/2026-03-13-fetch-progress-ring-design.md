# URL 抓取圓形進度條設計

## 概述

在 URL 抓取列表項目中，於「抓取中...」文字後方新增 28px 圓形進度條，顯示真實的下載進度百分比。

## 視覺設計

- **位置**：`file-item__meta` 區域，「抓取中...」文字**後方**
- **尺寸**：28px 圓環，stroke-width 2.5px
- **數字**：圓環內顯示百分比（9px，font-weight 600）
- **配色**：軌道 `var(--color-border)` (#2a2a4a)，進度條 `var(--color-highlight)` (#e94560)，`stroke-linecap: round`
- **左側 spinner 保持不變**

## 行為規格

### 有 Content-Length 時
- 顯示真實百分比 0%→100%
- `stroke-dashoffset` 搭配 CSS `transition: stroke-dashoffset 0.3s ease` 平滑過渡
- 百分比數字即時更新

### 無 Content-Length 時
- 顯示不定進度旋轉動畫（整個圓弧旋轉）
- 不顯示百分比數字

### 完成過渡
- 到達 100% 後停留約 0.5 秒
- 再切換為「轉換中...」狀態（移除圓形進度條）

## 技術實作

### 前端資料模型（js/main.js）

在 file item 物件新增 `fetchProgress` 屬性：
```js
{
  fetchProgress: { loaded: 0, total: 0, percent: -1 }
  // percent: -1 表示不定進度（無 Content-Length）
  // percent: 0~100 表示確定進度
}
```

### 下載進度追蹤

將 `fetchAndConvertMultiple` 中的 `response.arrayBuffer()` 改為 `response.body.getReader()` 逐塊讀取：
```js
const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
const reader = response.body.getReader();
const chunks = [];
let loaded = 0;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  chunks.push(value);
  loaded += value.length;
  // 更新進度
  item.fetchProgress = {
    loaded,
    total: contentLength,
    percent: contentLength > 0 ? Math.round((loaded / contentLength) * 100) : -1
  };
  updateFetchProgress(item); // 只更新進度 DOM，不重建整個 li
}

// 合併 chunks 為 ArrayBuffer
const blob = new Blob(chunks);
const arrayBuffer = await blob.arrayBuffer();
```

### DOM 更新策略

新增 `updateFetchProgress(item)` 函式，**只更新** SVG stroke-dashoffset 和百分比文字，不重建整個 `<li>` 元素：
```js
function updateFetchProgress(item) {
  const el = fileList.querySelector(`[data-id="${item.id}"]`);
  if (!el) return;
  const ring = el.querySelector('.progress-ring__bar');
  const pct = el.querySelector('.progress-ring__pct');
  if (!ring || !pct) return;

  const { percent } = item.fetchProgress;
  if (percent >= 0) {
    const circumference = 2 * Math.PI * 11; // r=11
    ring.style.strokeDashoffset = circumference * (1 - percent / 100);
    pct.textContent = `${percent}%`;
  }
}
```

### 完成過渡（0.5s 停留）

在 fetching 完成後、狀態切換為 waiting 之前，加入延遲：
```js
// 設定 100% 並等待
item.fetchProgress.percent = 100;
updateFetchProgress(item);
await new Promise(r => setTimeout(r, 500));
// 然後切換狀態
item.status = 'waiting';
updateFileItem(item);
```

### CSS 新增（css/style.css）

```css
.progress-ring { position: relative; display: inline-flex; width: 28px; height: 28px; flex-shrink: 0; }
.progress-ring svg { transform: rotate(-90deg); }
.progress-ring__track { fill: none; stroke: var(--color-border); stroke-width: 2.5; }
.progress-ring__bar { fill: none; stroke: var(--color-highlight); stroke-width: 2.5; stroke-linecap: round; transition: stroke-dashoffset 0.3s ease; }
.progress-ring__pct { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 600; }
/* 不定進度動畫 */
.progress-ring--indeterminate svg { animation: spin 1.2s linear infinite; }
.progress-ring--indeterminate .progress-ring__bar { stroke-dasharray: 25 44; }
```

### HTML 結構（在 createFileItemEl 中）

fetching 狀態時在 metaText 後追加：
```html
<span class="progress-ring${percent < 0 ? ' progress-ring--indeterminate' : ''}">
  <svg width="28" height="28" viewBox="0 0 28 28">
    <circle class="progress-ring__track" cx="14" cy="14" r="11"/>
    <circle class="progress-ring__bar" cx="14" cy="14" r="11"
      stroke-dasharray="69.12" stroke-dashoffset="..."/>
  </svg>
  <span class="progress-ring__pct">${percent >= 0 ? percent + '%' : ''}</span>
</span>
```

## 不需要修改的部分

- 後端 `server/fetch-url.js`：已有 streaming 和 Content-Length 傳遞
- 轉換階段：不加進度條
- Spinner：保持不變
- 其他狀態（queued、waiting、done、error）：不受影響

## 邊界情況

- Content-Length 為 0 或缺失：走不定進度動畫
- 下載中斷/錯誤：進度條隨狀態切換為 error 而消失
- 批次取消（abort）：進度條隨 DOM 重建而消失
