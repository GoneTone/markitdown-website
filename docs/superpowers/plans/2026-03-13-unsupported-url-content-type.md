# 不支援的 URL 內容類型攔截 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在後端攔截不支援的 URL 內容類型（如圖片），避免 Puppeteer 將其渲染為 HTML 後被前端誤轉換。

**Architecture:** 在 `server/fetch-url.js` 新增 `isSupportedContentType` 白名單函式，於 Puppeteer 路徑和 `streamDownload` 路徑兩處檢查原始 Content-Type，不支援的類型回傳 HTTP 415。

**Tech Stack:** Node.js, node:test

---

## Chunk 1: 實作與測試

### Task 1: 新增 isSupportedContentType 測試

**Files:**
- Modify: `server/__tests__/fetch-url.test.js`
- Reference: `server/fetch-url.js:314` (module.exports)

- [ ] **Step 1: 在測試檔底部新增 isSupportedContentType 測試區塊**

在 `server/__tests__/fetch-url.test.js` 頂部的 require 更新為引入 `isSupportedContentType`，並在檔案底部新增測試：

```javascript
// 更新頂部 require（第 3 行）：
const { validateUrl, isPrivateIP, isSupportedContentType } = require('../fetch-url');

// 在檔案底部新增：
describe('isSupportedContentType', () => {
  it('允許 text/html', () => {
    assert.equal(isSupportedContentType('text/html'), true);
  });

  it('允許帶 charset 的 text/html', () => {
    assert.equal(isSupportedContentType('text/html; charset=utf-8'), true);
  });

  it('允許 application/xhtml+xml', () => {
    assert.equal(isSupportedContentType('application/xhtml+xml'), true);
  });

  it('允許 application/pdf', () => {
    assert.equal(isSupportedContentType('application/pdf'), true);
  });

  it('允許 DOCX MIME type', () => {
    assert.equal(isSupportedContentType('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), true);
  });

  it('允許 XLSX MIME type', () => {
    assert.equal(isSupportedContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), true);
  });

  it('允許 PPTX MIME type', () => {
    assert.equal(isSupportedContentType('application/vnd.openxmlformats-officedocument.presentationml.presentation'), true);
  });

  it('允許 text/csv', () => {
    assert.equal(isSupportedContentType('text/csv'), true);
  });

  it('允許 application/epub+zip', () => {
    assert.equal(isSupportedContentType('application/epub+zip'), true);
  });

  it('拒絕 image/png', () => {
    assert.equal(isSupportedContentType('image/png'), false);
  });

  it('拒絕 image/jpeg', () => {
    assert.equal(isSupportedContentType('image/jpeg'), false);
  });

  it('拒絕 application/json', () => {
    assert.equal(isSupportedContentType('application/json'), false);
  });

  it('拒絕 application/octet-stream', () => {
    assert.equal(isSupportedContentType('application/octet-stream'), false);
  });

  it('拒絕 video/mp4', () => {
    assert.equal(isSupportedContentType('video/mp4'), false);
  });

  it('拒絕 text/plain', () => {
    assert.equal(isSupportedContentType('text/plain'), false);
  });

  it('大小寫不敏感', () => {
    assert.equal(isSupportedContentType('TEXT/HTML'), true);
    assert.equal(isSupportedContentType('Application/PDF'), true);
  });

  it('拒絕空字串', () => {
    assert.equal(isSupportedContentType(''), false);
  });

  it('拒絕 undefined', () => {
    assert.equal(isSupportedContentType(undefined), false);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npm test`
Expected: FAIL — `isSupportedContentType is not a function`

### Task 2: 實作 isSupportedContentType 並整合至兩個路徑

**Files:**
- Modify: `server/fetch-url.js:14` (新增常數)
- Modify: `server/fetch-url.js:155` (streamDownload 白名單檢查)
- Modify: `server/fetch-url.js:278` (Puppeteer 路徑白名單檢查)
- Modify: `server/fetch-url.js:314` (exports)

- [ ] **Step 3: 在 fetch-url.js 新增白名單常數與函式**

在 `const USER_AGENT = ...` 之後（約第 18 行）新增：

```javascript
// 支援轉換的 MIME type 白名單
const SUPPORTED_CONTENT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'application/epub+zip',
]);

/**
 * 檢查 Content-Type 是否為支援轉換的類型
 * @param {string} contentType - 原始 Content-Type header（可能含 charset 等參數）
 * @returns {boolean}
 */
function isSupportedContentType(contentType) {
  if (!contentType) return false;
  const mime = contentType.split(';')[0].trim().toLowerCase();
  return SUPPORTED_CONTENT_TYPES.has(mime);
}
```

- [ ] **Step 4: 在 streamDownload 加入白名單檢查**

在 `server/fetch-url.js` 的 `streamDownload` 函式中，`const contentType = response.headers.get('content-type') || 'application/octet-stream';` 之後（第 155 行後）插入：

```javascript
  if (!isSupportedContentType(contentType)) {
    const mime = contentType.split(';')[0].trim().toLowerCase();
    return res.status(415).json({ error: `不支援的內容類型：${mime || '未知'}` });
  }
```

- [ ] **Step 5: 在 Puppeteer 路徑的步驟 8 加入白名單檢查**

在 `server/fetch-url.js` 的 `fetchUrlHandler` 中，`const responseContentType = response.headers()['content-type'] || '';`（第 278 行）之後、`if (isDirectDownloadType(responseContentType))` 之前插入：

```javascript
    if (!isSupportedContentType(responseContentType)) {
      const mime = responseContentType.split(';')[0].trim().toLowerCase();
      return res.status(415).json({ error: `不支援的內容類型：${mime || '未知'}` });
    }
```

- [ ] **Step 6: 更新 module.exports**

在 `server/fetch-url.js` 最後一行，將 `isSupportedContentType` 加入 exports：

```javascript
module.exports = { fetchUrlHandler, validateUrl, isPrivateIP, resolveAndCheck, isSupportedContentType };
```

- [ ] **Step 7: 執行測試確認全部通過**

Run: `cd server && npm test`
Expected: 所有測試 PASS

- [ ] **Step 8: Commit**

```bash
git add server/fetch-url.js server/__tests__/fetch-url.test.js
git commit -m "feat: 攔截不支援的 URL 內容類型（如圖片），回傳 HTTP 415"
```
