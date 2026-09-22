# vite-plugin-monkey 文檔

> 前端工程化使用者腳本（Userscript）的 Vite 插件。來源：[Context7 `/lisonge/vite-plugin-monkey`](https://github.com/lisonge/vite-plugin-monkey)（71 程式碼片段，信譽 High）。

支援 Tampermonkey、Violentmonkey、Greasemonkey 等所有主流腳本引擎，提供完整 TypeScript 支援與現代化開發體驗（HMR、自動安裝、meta.js 更新檔）。

## 安裝

```shell
pnpm add -D vite-plugin-monkey
```

## 核心配置：`vite.config.ts`

```typescript
// packages/hanime1-download-manager/vite.config.ts
import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

export default defineConfig({
  plugins: [
    monkey({
      // 腳本入口檔案（相對於此 vite.config.ts）
      entry: "./src/main.ts",

      // 使用者腳本元數據（對應 ==UserScript== 區塊）
      userscript: {
        name: "Hanime1 Download Manager",
        namespace: "Violentmonkey Scripts",
        version: "1.1",
        description:
          "Replace download links with a native-style quality menu, batch download mode, and in-page downloads.",
        match: [
          "*://hanime1.com/*",
          "*://hanime1.me/*",
          "*://hanimeone.com/*",
          "*://hanimeone.me/*",
        ],
        connect: [
          "hanime1.com",
          "hanime1.me",
          "hanimeone.com",
          "hanimeone.me",
          "vdownload.hembed.com",
        ],
        grant: [
          "GM_xmlhttpRequest",
          "GM_download",
          "GM_setValue",
          "GM_getValue",
          "GM_registerMenuCommand",
        ],
        "run-at": "document-idle",
      },

      // 建置輸出檔名（必須以 .user.js 結尾）
      build: {
        // 預設為 (package.json.name ?? 'monkey') + '.user.js'
        fileName: "hanime1-download-manager.user.js",

        // 只含元數據註解的小檔案，可供 @updateURL 使用；
        // 檢查更新時只需下載此檔案而非整個腳本
        metaFileName: true, // → hanime1-download-manager.meta.js
      },

      // 開發伺服器設定
      server: {
        // 元數據變更時自動在預設瀏覽器開啟安裝 URL
        // 預設在 Win/Mac 平台為 true
        open: true,

        // 安裝列表中的名稱前綴，用於區分 server.user.js 與 build.user.js
        // 設為 false 則不加前綴
        prefix: "server:",

        // 將 GM_api 掛載到 unsafeWindow（不推薦）
        // 應透過 ESM import 使用，或使用 unplugin-auto-import
        mountGmApi: false,
      },

      // 客戶端 alias：vite-plugin-monkey/dist/client 的導入別名
      // 預設為 '$'
      clientAlias: "$",

      // 將 CSS import 處理為 HTMLStyleElement 節點
      // 使用 Shadow DOM 做樣式隔離時非常有用
      // 支援 .css?style、.less?style、.scss?style 等
      styleImport: true,

      // 對齊元數據註解的空格數
      align: 2,
    }),
  ],
});
```

### 配置介面重點

| 選項                 | 說明                                                                                          | 預設值                  |
| -------------------- | --------------------------------------------------------------------------------------------- | ----------------------- |
| `entry`              | 腳本入口路徑（必填）                                                                          | —                       |
| `userscript`         | 元數據物件，對應 `==UserScript==` 區塊                                                        | —                       |
| `userscript.version` | 未設定時自動回退（fallback）讀取 `package.json` 的 `version`                                  | `pkg.version`           |
| `build.fileName`     | 建置輸出檔名，須以 `.user.js` 結尾                                                            | `pkg.name + '.user.js'` |
| `build.metaFileName` | 元數據小檔案，供 `@updateURL` 用；`true` 時等同 `fileName.replace(/\.user\.js$/, '.meta.js')` | `false`                 |
| `server.open`        | 元數據變更時自動開啟安裝 URL                                                                  | Win/Mac 為 `true`       |
| `server.prefix`      | 區分開發/建置產物的前綴                                                                       | `'server:'`             |
| `server.mountGmApi`  | 將 GM_api 掛載至 `unsafeWindow`（不推薦）                                                     | `false`                 |
| `clientAlias`        | `vite-plugin-monkey/dist/client` 的 alias                                                     | `'$'`                   |
| `styleImport`        | CSS import 轉為 `<style>` 節點（Shadow DOM 隔離必備）                                         | `true`                  |
| `align`              | 元數據註解對齊空格數                                                                          | `2`                     |

## GM_api 的 ESM 用法

透過客戶端 alias（預設 `$`）以 ESM 方式導入，無論 `serve` 或 `build` 模式皆可用：

```typescript
// src/main.ts
import {
  GM_xmlhttpRequest,
  GM_download,
  GM_setValue,
  GM_getValue,
  GM_registerMenuCommand,
  unsafeWindow,
  monkeyWindow,
} from "$";

// monkeyWindow 永遠是「使用者腳本作用域」的 window
// unsafeWindow 永遠是宿主頁面的 window
if (unsafeWindow === window) {
  console.log("scope->host, host esm scope");
} else {
  console.log("scope->monkey, userscript scope");
}
```

> 注意：與 `mountGmApi: true` 相比，ESM import 是官方推薦作法，具備完整類型提示且不會污染宿主全域。

### 搭配 unplugin-auto-import 自動導入

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import monkey, { util } from "vite-plugin-monkey";
import AutoImport from "unplugin-auto-import/vite";

export default defineConfig({
  plugins: [
    AutoImport({
      imports: [util.unimportPreset],
    }),
    monkey({/* ... */}),
  ],
});
```

```typescript
// src/main.ts — 無需 import，直接使用
console.log({ GM_getValue, GM_setValue, unsafeWindow });
```

## 型別提示（vite-env.d.ts）

```typescript
/// <reference types="vite-plugin-monkey/client" />
/// <reference types="vite-plugin-monkey/style" />
```

若使用自訂 alias（如 `clientAlias: 'monkeyApi'`）：

```typescript
declare module "monkeyApi" {
  export * from "vite-plugin-monkey/dist/client";
}
```

## 進階配置

### 搭配 @vitejs/plugin-legacy

必須設定 `renderLegacyChunks: false` 以避免 polyfill 問題：

```typescript
import legacy from "@vitejs/plugin-legacy";
import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

export default defineConfig({
  plugins: [
    legacy({
      renderLegacyChunks: false,
      modernPolyfills: true,
    }),
    monkey({ entry: "./src/main.ts" }),
  ],
});
```

### 自訂元數據註解產生器

```typescript
monkey({
  entry: "./src/main.ts",
  // 完全自訂註解區塊的產生邏輯
  generate: ({ userscript, mode }) => {
    // mode: 'serve' | 'build' | 'meta'
    return Promise.resolve(`// ==UserScript==\n${userscript}\n// ==/UserScript==`);
  },
});
```

### Shadow DOM 樣式隔離

```typescript
import style1 from "./style1.css?style";

const container = document.createElement("div").attachShadow({ mode: "open" });
container.append(style1); // 變更 style1.css 時具備 HMR
const style3 = style1.cloneNode(true); // 複製品仍保留 HMR
```

## 開發與建置指令

```jsonc
// package.json
{
  "scripts": {
    "dev": "vite", // 啟動開發伺服器，HMR + 自動安裝
    "build": "vite build", // 產出 .user.js 與 .meta.js
    "preview": "vite preview",
  },
}
```

- `pnpm dev`：啟動後自動在瀏覽器開啟安裝 URL；元數據變更時會重新觸發安裝，安裝列表中以 `server:` 前綴區分。
- `pnpm build`：輸出獨立的 `.user.js`，可直接發布至 GitHub Raw / Greasy Fork。

## 參考

- 完整 README：<https://github.com/lisonge/vite-plugin-monkey>
- Context7 文檔查詢：`/lisonge/vite-plugin-monkey`
