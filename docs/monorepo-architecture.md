# Monorepo 架構規劃

> 多個 UserScripts 的統一開發倉庫。基於 **Bun workspaces** + **Vite** + **vite-plugin-monkey** + **Biome**，每個腳本為獨立套件，共用工具、UI token 與型別透過 `@userscripts/shared` 統一管理。

## 技術選型理由

| 決策       | 選擇                          | 理由                                                             |
| ---------- | ----------------------------- | ---------------------------------------------------------------- |
| 套件管理器 | Bun workspaces                | 單一高效執行環境，原生支援 TypeScript 與內建 Test Runner         |
| 建置工具   | Vite + vite-plugin-monkey     | 支援 HMR 自動安裝、ESM 匯入 GM API、TypeScript 全程型別支援      |
| 程式碼檢查 | Biome (`biome.json`)          | 統一執行 Lint、Formatting 與 Import 排序                         |
| 框架偏好   | Vanilla TS > SolidJS > Svelte | 依腳本性質決定（見下節）                                         |
| 語言       | TypeScript                    | 跨腳本共用型別；`@userscripts/shared` 提供統一介面               |
| CI / 發布  | GitHub Actions                | 由 `<id>-v<version>` Tag 觸發，自動建置並發布 Release 與 `dist/` |

## 框架選擇決策矩陣

| 腳本性質                                            | 推薦框架       | 範例                                               |
| --------------------------------------------------- | -------------- | -------------------------------------------------- |
| DOM 操作型：改寫既有按鈕、監聽頁面事件、注入精簡 UI | **Vanilla TS** | `hanime1-download-manager`（原生元件沿用網站樣式） |
| 完整應用型：浮層面板、複雜狀態管理                  | **SolidJS**    | 需要高頻響應式狀態與元件化的工具面板               |
| 內容聚合型：提取頁面資料做展示層渲染                | **Svelte**     | 資訊聚合與重排版                                   |

> 注意：使用者腳本執行於網頁上下文中，體積越精簡越好。Vanilla TS 與 Shadow DOM 搭配 zero-innerHTML-rebuild 可在極低開銷下維持良好體驗。

## 目錄結構

```text
UserScripts/
├── .github/
│   ├── ISSUE_TEMPLATE/bug_report.yml
│   └── workflows/
│       └── release.yml                # CI：Tag 觸發建置並發布 Release
├── .githooks/
│   └── pre-commit                     # 阻擋提交 .dist-dev/ 或 0.0.0-dev 建置產物
├── docs/                              # 專案技術與架構文件
│   ├── monorepo-architecture.md       # 本文件
│   ├── vite-plugin-monkey.md
│   ├── violentmonkey.md
│   ├── chrome-language-detector.md
│   ├── chrome-translator-api.md
│   └── mdn-local-font-access-api.md
├── packages/
│   ├── shared/                        # @userscripts/shared：共用工具與 UI token
│   │   ├── src/
│   │   │   ├── gm.ts                  # GM API 封裝（依賴注入）
│   │   │   ├── gm-types.ts            # GM 型別宣告
│   │   │   ├── i18n.ts                # 多語系載入、快取與選單狀態
│   │   │   ├── presence.ts            # 設定頁腳本偵測（publishPresence / isManagerPage）
│   │   │   ├── theme.ts               # 宿主網頁主題探測（probeTheme）
│   │   │   ├── ui-tokens.ts           # Monochrome Hairline 設計系統 CSS token
│   │   │   ├── types.ts               # 共用型別
│   │   │   └── index.ts
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── hanime1-download-manager/      # 腳本套件（USERSCRIPT_ID: h1dl）
│   │   ├── src/
│   │   ├── locales.json
│   │   ├── dist/                      # CI 發布成品（由 release.yml 更新）
│   │   ├── .dist-dev/                 # 本機 0.0.0-dev 建置隔離目錄（gitignored）
│   │   ├── vite.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── page-translator/               # 腳本套件（USERSCRIPT_ID: ptr）
│       ├── src/
│       ├── translations/              # 站點翻譯詞典（<host>.json，支援 scoped 選擇器）
│       ├── deltas.json                # 站點 +-* 擷取差異規則
│       ├── locales.json
│       ├── .dist-dev/
│       ├── vite.config.ts
│       ├── package.json
│       └── tsconfig.json
├── settings/                          # GitHub Pages 靜態設定站
│   ├── shared/                        # tokens.css & bridge.js
│   ├── language/
│   └── translate/
├── tools/
│   └── new-script.mjs                 # 新腳本套件範本產生工具（Scaffold）
├── index.html                         # 設定站首頁
├── biome.json
├── package.json                       # 根套件：workspaces 與腳本指令
├── bun.lock
└── tsconfig.base.json
```

## 工作區設定

根目錄 `package.json` 透過 `"workspaces": ["packages/*"]` 管理所有套件。Bun workspaces 使用 `"*"` 版本範圍解析本地 workspace 套件（不使用 `workspace:` 協議）：

```jsonc
// packages/hanime1-download-manager/package.json
{
  "name": "@userscripts/hanime1-download-manager",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "@userscripts/shared": "*" }
}
```

> 注意：`package.json` 不包含 `version` 與 `userscript.id` 欄位，避免與 Git Tag 或 `vite.config.ts` 產生不同步。

## 唯一 ID、版本與建置隔離

`vite.config.ts` 是腳本中繼資料的唯一真實來源（Single Source of Truth）：

- **`USERSCRIPT_ID`** — 小寫字母、數字與連字號（須匹配 release workflow 的 `^([a-z0-9][a-z0-9-]*)-v([0-9].*)$`）
- **`VERSION`** — 讀取 `process.env.USERSCRIPT_VERSION`，本機開發建置回退為 `0.0.0-dev`
- **`OUT_DIR` 隔離機制** — `VERSION !== "0.0.0-dev"` 時輸出至 `dist/`（僅限 CI 發布）；本機一律輸出至 `.dist-dev/`（已列入 `.gitignore`），避免蓋寫 `main` 上已追蹤的正式 `dist/` 更新來源

```ts
export const USERSCRIPT_ID = "h1dl";
const VERSION = process.env.USERSCRIPT_VERSION ?? pkg.version ?? "0.0.0-dev";
const IS_RELEASE = VERSION !== "0.0.0-dev";
const OUT_DIR = IS_RELEASE ? "dist" : ".dist-dev";
```

| 套件                                    | `USERSCRIPT_ID` | 發布 Tag 範例 |
| --------------------------------------- | --------------- | ------------- |
| `@userscripts/hanime1-download-manager` | `h1dl`          | `h1dl-v1.1.0` |
| `@userscripts/page-translator`          | `ptr`           | `ptr-v1.0.0`  |

## UI/UX 設計與主題系統

- **原生優先**：網站已有成熟元件時沿用其 class 與樣式
- **NovaKit Borderless（Oklab / Oklch）**：所有自訂浮層面板（Shadow DOM）、設定頁面（`settings/`）與非原生互動元件統一採用 `@userscripts/shared` 的 `color.ts`、`theme-mode.ts`、`ui-tokens.ts` 與 `settings/shared/tokens.css`（無邊框 tonal 階層、圓角 `12/8/6px`、`tabular-nums` 數字、無 `scale()` 變形、跨腳本 `[data-us-ui]` 隔離標記）
- **四種主題規則**：`dark`（強制深色）、`light`（強制淺色）、`system`（跟隨 `prefers-color-scheme`）與 `host`（宿主網頁／父頁面，透過 Oklab 引擎讀取目標網頁色票推導對比層級）

## 多語言（i18n）

腳本本體僅保留英文回退字串（`src/i18n.ts`），其餘翻譯集中於套件根目錄的單一 `locales.json`。首次執行抓取後快取於 GM 儲存空間，後續先讀快取再於背景更新，內容變更才重載頁面。語言代碼採用 BCP 47（`en-US`、`zh-Hant-TW`、`zh-Hans-CN`），未指定時依頁面 `<html lang>` 判斷。

## 設定站（Settings）

根目錄 `index.html` 與 `settings/<name>/` 透過 GitHub Pages 部署為靜態設定頁。腳本透過 `publishPresence()` 注入 DOM 宣告，頁面透過 `userscript:settings` 自訂事件廣播設定變更，各腳本監聽後寫入各自的 GM 儲存空間。

## CI / CD 發布流程

推送 `<id>-v<version>` Tag（或在 GitHub Actions 手動觸發 `workflow_dispatch`）後，`.github/workflows/release.yml` 會：

1. 解析 Tag 取得 `id` 與 `version`，比對所有 `packages/*/vite.config.ts` 匯出的 `USERSCRIPT_ID`
2. 注入 `USERSCRIPT_VERSION` 執行 `bun install --frozen-lockfile` → `bun run typecheck` → `bun run build`
3. 將 `dist/*.user.js` 與 `dist/*.meta.js` 上傳為 GitHub Release 附件
4. 將 `dist/*.user.js`、`dist/*.meta.js` 與 `dist/locales.json`（若有）以 `git add -f` 提交至 `main` 分支，供 `@updateURL`／`@downloadURL` 及執行期 `locales.json` 抓取使用

## 參考

- vite-plugin-monkey 設定參考：[docs/vite-plugin-monkey.md](vite-plugin-monkey.md)
- Violentmonkey 參考文件：[docs/violentmonkey.md](violentmonkey.md)
