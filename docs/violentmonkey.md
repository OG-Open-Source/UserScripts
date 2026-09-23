# Violentmonkey 文檔

> 開源使用者腳本管理器（Userscript Manager），支援 Chrome、Firefox、Edge 等所有 WebExtensions 相容瀏覽器。來源：[Context7 `/websites/violentmonkey_github_io`](https://violentmonkey.github.io/)（245 程式碼片段，評分 81.84，信譽 High）與 [`/violentmonkey/violentmonkey`](https://github.com/violentmonkey/violentmonkey)。

## 元數據區塊（Metadata Block）

腳本開頭必須包含 `==UserScript==` 註解區塊，宣告名稱、命名空間、URL 匹配與版本等資訊。

```javascript
// ==UserScript==
// @name        New script
// @namespace   Violentmonkey Scripts
// @match       *://*/*
// @grant       none
// @version     1.0
// @author      -
// @description 3/8/2020, 8:42:28 PM
// ==/UserScript==
```

> 注意：若未使用任何 GM 函數，`@grant` 應設為 `none`。

## @grant — 授權 API

使用 `@grant` 顯式宣告要使用的特殊 API。若完全沒有 `@grant`，腳本會在存取受限的沙箱（Sandbox）中執行；`@grant none` 則停用沙箱。

```javascript
// @grant none
```

```javascript
// @grant GM_getValue
// @grant GM_setValue
```

```javascript
// @grant GM.getValue
// @grant GM.setValue
```

```javascript
// @grant window.close
// @grant window.focus
```

兩種寫法差異：

- `GM_setValue`（短語式）：Violentmonkey 與 Tampermonkey 通用
- `GM.setValue`（點號式）：較新的規範寫法

## GM API

### GM.xmlHttpRequest / GM_xmlhttpRequest

跨域 HTTP 請求。`onload` 回調處理回應：

```javascript
// 相容多種腳本管理器
GM.xmlHttpRequest({
  url,
  onload: (res) => {
    /* ... */
  },
});
```

Violentmonkey 2.18.3+ 與 Tampermonkey 支援直接 `await`：

```javascript
// VM2.18.3+, TM
const res = await GM.xmlHttpRequest({ url });
```

> 注意：`onload` 回調內容可能是可變的（mutable）；如需保留回應內容請立即複製。

### GM_registerMenuCommand

在 Violentmonkey 彈出選單中註冊指令。

**方法簽名**

```javascript
GM_registerMenuCommand(caption, onClick, options?)
```

**參數**

- `caption`：`string` — 顯示於彈出選單的文字
- `onClick`：`(event) => void` — 點擊時觸發的回調
  - `event`：自 VM2.13.1 起，提供 `event.button`、`event.shiftKey`、`event.key` 等啟動指令的事件細節
- `options?`：`object` — 自 VM2.15.9 起的進階設定
  - `id?`：`string` — VM2.15.9 新增；預設自 VM2.16.2 起為 `caption` 文字（2.15.9–2.16.1 預設為隨機產生字串）
  - `icon?`：`string` — VM2.31.1 新增；顯示圖示的 URL
  - `title?`：`string` — 滑鼠停留時顯示於狀態列的提示
  - `autoClose?`：`boolean = true` — 觸發指令後是否自動關閉彈出選單

**回傳值**：自 VM2.12.5 起回傳指令的 `caption`；自 VM2.15.9 起回傳 `id`。

**範例**

```javascript
GM_registerMenuCommand("Text", onClick);
const id2 = GM_registerMenuCommand("Text2", onClick, { title: "Two" });
const id3 = GM_registerMenuCommand("Text3", onClick, { autoClose: false });
```

**原地更新指令**（複用同一 `id` 達成狀態切換）：

```javascript
const id = "status";
const inplace = id === GM_registerMenuCommand("Enabled", onClick, { id });

if (inplace) {
  // 同一 id 會原地取代原指令
  GM_registerMenuCommand("Disabled", onClick, { id, title: "Status" });
} else {
  // 不支援原地更新時的 fallback
  GM_unregisterMenuCommand("Enabled");
  GM_unregisterMenuCommand("Foo");
  GM_unregisterMenuCommand("Bar");
  GM_registerMenuCommand("Disabled", onClick);
  GM_registerMenuCommand("Foo", onClick2);
  GM_registerMenuCommand("Bar", onClick3);
}
```

> 注意：`hanime1-download-manager` 的語言切換選單正是利用此機制——每個語言註冊一個指令，當前語言標記 `✓`，點擊後 `GM_setValue('lang', code)` 並 `location.reload()`。

### GM_setValue / GM_getValue

鍵值對持久化儲存，跨頁面保留狀態：

```javascript
GM_setValue("lang", "zh-Hant-TW");
const lang = GM_getValue("lang", null); // 第二參數為預設值
```

### GM_download

觸發瀏覽器下載（需 `@grant GM_download`）：

```javascript
GM_download({
  url: "https://example.com/video.mp4",
  name: "video.mp4",
  onload: () => console.log("done"),
  onerror: (err) => console.error(err),
});
```

## URL 匹配與跨域

### @match / @include

```javascript
// @match *://hanime1.com/*
// @match *://hanime1.me/*
```

`@match` 採用 URL match pattern 語法（`<scheme>://<host>/<path>`），`@include` 則接受正則表達式或萬用字元。優先使用 `@match`。

### @connect

宣告 `GM_xmlhttpRequest` 允許跨域請求的目標域名白名單：

```javascript
// @connect hanime1.com
// @connect hanime1.me
// @connect vdownload.hembed.com
```

未在 `@connect` 宣告的域名會在首次請求時彈出確認提示。

### @run-at

控制腳本注入時機：

```javascript
// @run-at document-start   // DOM 開始建構前
// @run-at document-body    // body 元素出現時
// @run-at document-end     // DOMContentLoaded 後
// @run-at document-idle    // 頁面閒置時（預設）
```

> 注意：`hanime1-download-manager` 使用 `document-idle`，因為需要在完整渲染的 DOM 上做 DOM 手術（DOM Surgery）注入下載按鈕。

## 本專案實際使用的元數據

```javascript
// ==UserScript==
// @name         Hanime1 Download Manager
// @namespace    Violentmonkey Scripts
// @version      1.1
// @description  Replace download links with a native-style quality menu, batch download mode, and in-page downloads without leaving the page.
// @match        *://hanime1.com/*
// @match        *://hanime1.me/*
// @match        *://hanimeone.com/*
// @match        *://hanimeone.me/*
// @connect      hanime1.com
// @connect      hanime1.me
// @connect      hanimeone.com
// @connect      hanimeone.me
// @connect      vdownload.hembed.com
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==
```

## 參考

- 建立使用者腳本：<https://violentmonkey.github.io/guide/creating-a-userscript>
- 元數據區塊：<https://violentmonkey.github.io/api/metadata-block>
- GM API：<https://violentmonkey.github.io/api/gm>
- Context7 文檔查詢：`/websites/violentmonkey_github_io`、`/violentmonkey/violentmonkey`
