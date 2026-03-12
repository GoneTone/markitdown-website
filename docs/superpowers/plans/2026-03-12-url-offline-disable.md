# URL 輸入離線禁用 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 離線時禁用網址輸入區塊並顯示行內提示，上線後自動恢復。

**Architecture:** 擴展現有 `checkConnectivity()` 函式，在偵測離線/上線時同步控制 URL 輸入的 disabled 狀態與行內提示的顯示。新增 `isOnline` 狀態變數，所有啟用 URL 輸入的位置都需同時檢查 `isOnline && isEngineReady`。

**Tech Stack:** 純前端 HTML/CSS/JS，無新依賴。

**Spec:** `docs/superpowers/specs/2026-03-12-url-offline-disable-design.md`

---

## Chunk 1: 實作

### Task 1: HTML — 新增行內提示元素與 aria 屬性

**Files:**
- Modify: `index.html:123-134`

- [ ] **Step 1: 為 url-input 加上 aria-describedby**

在 `index.html:123-128` 的 `<input>` 加上 `aria-describedby="url-offline-hint"`：

```html
          <input
            type="url"
            id="url-input"
            class="url-input"
            placeholder="輸入網頁網址，例如 https://example.com"
            aria-describedby="url-offline-hint"
            disabled
          />
```

- [ ] **Step 2: 在 .url-input-group 之後新增提示元素**

在 `index.html` 的 `</div><!-- .url-input-group -->` 之後、`</div><!-- .url-input-area -->` 之前插入：

```html
        <p id="url-offline-hint" class="url-input-hint" hidden>
          目前無網路連線，無法使用網址轉換。
        </p>
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: 新增網址離線提示 HTML 元素與 aria 屬性"
```

---

### Task 2: CSS — 新增行內提示樣式

**Files:**
- Modify: `css/style.css:696-700`（在 `.url-input__btn:disabled` 規則之後）

- [ ] **Step 1: 新增 .url-input-hint 樣式**

在 `css/style.css` 的 `.url-input__btn:disabled { ... }` 規則之後加入：

```css
.url-input-hint {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: #f0a500;
}

.url-input-hint[hidden] {
  display: none;
}
```

- [ ] **Step 2: Commit**

```bash
git add css/style.css
git commit -m "feat: 新增網址離線提示樣式"
```

---

### Task 3: JS — 新增 isOnline 狀態與元素參考

**Files:**
- Modify: `js/main.js:30-31`（DOM 參考區）
- Modify: `js/main.js:53`（狀態變數區）

- [ ] **Step 1: 新增 urlOfflineHint 元素參考**

在 `js/main.js:31`（`const btnFetchUrl = ...` 之後）加入：

```js
const urlOfflineHint   = document.getElementById('url-offline-hint');
```

- [ ] **Step 2: 新增 isOnline 狀態變數**

在 `js/main.js:53`（`let isEngineReady = false;` 之後）加入：

```js
let isOnline      = false;
```

- [ ] **Step 3: Commit**

```bash
git add js/main.js
git commit -m "feat: 新增離線狀態變數與 DOM 參考"
```

---

### Task 4: JS — 擴展 checkConnectivity 控制 URL 輸入

**Files:**
- Modify: `js/main.js:639-648`（`checkConnectivity` 函式）

- [ ] **Step 1: 修改 checkConnectivity 的 try 區塊**

將 `js/main.js:644-645` 的：

```js
    offlineBanner.setAttribute('hidden', '');
```

改為：

```js
    isOnline = true;
    offlineBanner.setAttribute('hidden', '');
    urlOfflineHint.setAttribute('hidden', '');
    if (isEngineReady) {
      urlInput.disabled = false;
      btnFetchUrl.disabled = false;
    }
```

- [ ] **Step 2: 修改 checkConnectivity 的 catch 區塊**

將 `js/main.js:646-647` 的：

```js
    offlineBanner.removeAttribute('hidden');
```

改為：

```js
    isOnline = false;
    offlineBanner.removeAttribute('hidden');
    urlOfflineHint.removeAttribute('hidden');
    urlInput.disabled = true;
    btnFetchUrl.disabled = true;
```

- [ ] **Step 3: Commit**

```bash
git add js/main.js
git commit -m "feat: checkConnectivity 同步控制 URL 輸入禁用狀態"
```

---

### Task 5: JS — Engine 就緒時加入 isOnline 檢查

**Files:**
- Modify: `js/main.js:69-71`（engine ready handler）

- [ ] **Step 1: 加入 isOnline 條件**

將 `js/main.js:69-71` 的：

```js
          dropZone.classList.remove('drop-zone--disabled');
          urlInput.disabled = false;
          btnFetchUrl.disabled = false;
```

改為：

```js
          dropZone.classList.remove('drop-zone--disabled');
          if (isOnline) {
            urlInput.disabled = false;
            btnFetchUrl.disabled = false;
          }
```

- [ ] **Step 2: Commit**

```bash
git add js/main.js
git commit -m "feat: engine 就緒時檢查網路狀態才啟用 URL 輸入"
```

---

### Task 6: JS — 修正 fetchAndConvert finally 區塊

**Files:**
- Modify: `js/main.js:303-304`（fetchAndConvert finally）

- [ ] **Step 1: 加入 isOnline 條件**

將 `js/main.js:303-304` 的：

```js
    urlInput.disabled = !isEngineReady;
    btnFetchUrl.disabled = !isEngineReady;
```

改為：

```js
    urlInput.disabled = !(isEngineReady && isOnline);
    btnFetchUrl.disabled = !(isEngineReady && isOnline);
```

- [ ] **Step 2: Commit**

```bash
git add js/main.js
git commit -m "fix: fetchAndConvert finally 檢查離線狀態避免誤啟用"
```

---

### Task 7: JS — 修正 resetToUpload 設定 disabled 狀態

**Files:**
- Modify: `js/main.js:580-588`（resetToUpload 函式）

- [ ] **Step 1: 新增 URL 輸入 disabled 狀態設定**

在 `js/main.js` 的 `resetToUpload()` 函式中，`showState(STATES.UPLOAD);` 之前加入：

```js
  urlInput.disabled = !(isOnline && isEngineReady);
  btnFetchUrl.disabled = !(isOnline && isEngineReady);
```

- [ ] **Step 2: Commit**

```bash
git add js/main.js
git commit -m "fix: resetToUpload 根據離線狀態設定 URL 輸入"
```

---

### Task 8: 手動驗證

- [ ] **Step 1: 啟動開發伺服器**

```bash
docker compose -f docker-compose-dev.yml up
```

開啟 http://localhost:3000

- [ ] **Step 2: 驗證上線狀態**

確認：URL 輸入與按鈕在 engine 就緒後可用、行內提示隱藏、頂部無離線橫幅。

- [ ] **Step 3: 驗證離線狀態**

在瀏覽器 DevTools → Network 切換為 Offline。等待約 5 秒（輪詢週期）。

確認：
- 頂部出現離線橫幅
- URL 輸入與按鈕變為 disabled（opacity 0.5）
- 輸入區下方出現橙黃色提示「目前無網路連線，無法使用網址轉換。」
- placeholder 文字不變

- [ ] **Step 4: 驗證自動恢復**

取消 Offline 模式。等待約 5 秒。

確認：
- 離線橫幅消失
- 行內提示消失
- URL 輸入與按鈕恢復可用

- [ ] **Step 5: 驗證重置回上傳頁**

在離線狀態下，若已在結果頁，點擊「重新上傳」。

確認：URL 輸入維持 disabled，行內提示可見。

- [ ] **Step 6: 最終 commit（如有微調）**

```bash
git add -A
git commit -m "feat: 網址輸入離線禁用完成"
```
