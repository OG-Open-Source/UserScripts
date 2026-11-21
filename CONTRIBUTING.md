# Contributing to UserScripts

歡迎參與本倉庫的開發。本文件涵蓋環境建置、開發流程、新增腳本、UI/UX 規範與發布流程。

---

## Table of Contents

- [環境需求](#環境需求)
- [快速開始](#快速開始)
- [目錄結構](#目錄結構)
- [新增腳本](#新增腳本)
- [設計規範](#設計規範)
- [多語言（i18n）](#多語言i18n)
- [設定頁面（Settings）](#設定頁面settings)
- [發布流程](#發布流程)
- [框架選擇指引](#框架選擇指引)
- [貢獻與提交規範](#貢獻與提交規範)
- [參考文件](#參考文件)

---

## 環境需求

- [Bun](https://bun.sh/) `>= 1.2.0`（安裝：`powershell -c "irm bun.sh/install.ps1 | iex"` 或 `npm install -g bun`）

## 快速開始

```shell
git clone --recurse-submodules https://github.com/OG-Open-Source/UserScripts.git
cd UserScripts

# 安裝依賴（建立 workspace 連結並啟用 .githooks）
bun install

# 開發單一腳本（HMR + 自動安裝至瀏覽器腳本管理器）
bun run --filter '@userscripts/hanime1-download-manager' dev
bun run --filter '@userscripts/page-translator' dev

# 開發所有腳本
bun run --filter '*' dev

# 本機建置測試（輸出至 packages/<name>/.dist-dev/，不會污染 dist/）
bun run --filter '*' build

# 檢查與測試
bun run check                    # Ultracite / Biome lint + format 檢查
bun run fix                      # 自動修正格式與安全 lint 問題
bun run --filter '*' typecheck   # TypeScript 型別檢查
bun test ./packages              # 執行 packages/ 單元測試
```

## 目錄結構

```text
UserScripts/
├── .github/
│   ├── ISSUE_TEMPLATE/bug_report.yml  # 結構化 Issue 表單
│   └── workflows/release.yml          # 發布工作流（tag 觸發）
├── .githooks/pre-commit               # 禁止誤提交 .dist-dev/ 或 0.0.0-dev 產物
├── docs/                              # 技術規格與架構文件
│   ├── monorepo-architecture.md       # Monorepo 架構規劃
│   ├── vite-plugin-monkey.md          # vite-plugin-monkey 設定參考
│   ├── violentmonkey.md               # Violentmonkey Metadata 與 GM API 參考
│   ├── chrome-language-detector.md    # Chrome Language Detector API 參考
│   ├── chrome-translator-api.md       # Chrome Translator API 參考
│   └── mdn-local-font-access-api.md   # Local Font Access API 參考
├── packages/
│   ├── shared/                        # @userscripts/shared：共用工具、UI token 與型別
│   ├── hanime1-download-manager/      # hanime1 下載管理器（id: h1dl）
│   └── page-translator/               # 網頁翻譯器（id: ptr）
├── settings/                          # GitHub Pages 靜態設定頁面
│   ├── shared/                        # tokens.css 與 bridge.js
│   ├── language/                      # 共用語言設定頁
│   └── translate/                     # Page Translator 設定與站點詞典管理頁
├── tools/new-script.mjs               # 新腳本套件範本產生工具（Scaffold）
├── index.html                         # 設定站入口頁
├── biome.json                         # Biome lint / format 設定
├── tsconfig.base.json                 # 共用 TypeScript 設定
└── package.json                       # Bun workspaces 設定
```

## 新增腳本

```shell
bun run new my-script
# 或指定框架
bun run new my-script --framework solid
```

依腳本性質選擇框架（Vanilla TS / SolidJS / Svelte），產生工具會在 `packages/my-script/` 建立完整套件結構，並以 `vite.config.ts` 中的 `USERSCRIPT_ID` 作為唯一識別碼來源。

## 設計規範

### 圖示（Icon）

優先順序：

1. **網站原生圖示** — 優先沿用目標網站已載入的圖示字體（例如 Material Icons）或 SVG sprite
2. **行內幾何 SVG（Inline SVG）** — 網站未提供可用圖示，或為獨立浮層／設定頁時，使用輕量手寫幾何 SVG（不引入外部圖示套件或 vendor submodule）

```ts
const icon = document.createElement("i");
icon.className = "material-icons"; // 網站原生圖示字體
icon.textContent = "download";
```

### 樣式與主題（Styles & NovaKit Borderless）

優先順序：

1. **網站原生樣式** — 接管網站既有互動元件（如 `.more-horiz-panel`、`.video-show-action-btn`）時，直接沿用原生 class 與行為
2. **NovaKit Borderless 設計系統（Oklab / Oklch）** — 所有非原生元件、Shadow DOM 浮層面板與 `settings/` 設定頁，統一採用 `@userscripts/shared` 定義的 **NovaKit Borderless** 規範（無 `1px` 盒框、以 tonal surface 階層與柔和陰影區隔、圓角比例 `12/8/6px`、`oklch()`/`oklab()` 語意色票、無變形脈衝回饋、跨腳本 `data-us-ui` 防衝突標記）

主題規則須支援四種模式：

- **`dark`** — 強制深色
- **`light`** — 強制淺色
- **`system`** — 跟隨作業系統 `prefers-color-scheme`
- **`host`（宿主網頁／父頁面）** — 透過 `@userscripts/shared` 的 `probeHostColors()` 與 Oklab 色階引擎推導宿主色票，永不硬編碼固定顏色

詳見 [oklch() 規範](docs/mdn-css-oklch.md) 與 [oklab() 規範](docs/mdn-css-oklab.md)。

## 多語言（i18n）

腳本程式碼本體只內建英文。`==UserScript==` Metadata 註解不受此限。語言顯示名稱保留該語言原文，讓使用者能辨識自己的語言。

語言代碼一律使用 BCP 47，英文以美式為準：`en-US`、`zh-Hant-TW`、`zh-Hans-CN`。未手動設定時依頁面 `<html lang>` 判斷（不依瀏覽器語系）：`zh-Hant`／`zh-TW`／`zh-HK`／`zh-MO` 對應 `zh-Hant-TW`，`zh-Hans`／`zh-CN` 對應 `zh-Hans-CN`，其餘對應 `en-US`。

所有翻譯集中在套件根目錄的單一檔案 `locales.json`。新增語系是新增一筆條目，不是新增檔案：

1. 預設英文文案寫在 `src/i18n.ts` 作為回退（Fallback），不重複寫入 `locales.json`
2. `locales.json` 的 `languages` 列出各語系，非預設語系附帶 `messages`
3. 抓取後的檔案快取於 GM 儲存空間；後續執行優先讀取快取並於背景更新，內容有變動才重載
4. 缺漏的翻譯鍵自動回退英文；檔案無法讀取時維持英文並於下次執行重試

腳本管理器選單僅顯示狀態（例如 `Language: 臺灣繁體中文 (zh-Hant-TW)`），點擊開啟 `settings/language/` 統一設定。

> 注意：新增或修正翻譯只需更新 `locales.json`，Release 工作流會一併將 `dist/locales.json` 發布至 `main`，已安裝腳本會在下次執行時自動取得。

## 設定頁面（Settings）

每項設定功能為 `settings/<name>/` 下的獨立靜態頁面，根目錄 `index.html` 僅負責導覽入口。

腳本透過 `publishPresence()` 在頁面 DOM 宣告自己（`id`、`name`、`description`、`localeUrl`），設定頁讀取後呈現；套用設定時透過 `userscript:settings` 自訂事件廣播，各腳本自行寫入專屬的 GM 儲存空間。

## 發布流程

版本號與腳本 ID 皆由 **Git Tag 統一管理**，`vite.config.ts` 為唯一真實來源（Single Source of Truth）：

- **ID** — `vite.config.ts` 匯出的 `USERSCRIPT_ID` 常數（小寫字母、數字與連字號）
- **版本** — CI 從 Tag 解析版本，以 `USERSCRIPT_VERSION` 環境變數注入建置；本機無此變數時回退為 `0.0.0-dev` 並輸出至 `.dist-dev/`
- **`package.json` 不含 `version` 或 `userscript.id`** — 避免多處維護不同步

發布時推送符合 `<id>-v<version>` 格式的 Tag（Semantic Versioning 2.0.0），GitHub Actions 會自動建置並建立 GitHub Release：

```shell
# 例：發布 hanime1-download-manager（id: h1dl）v1.1.0
git tag h1dl-v1.1.0
git push origin h1dl-v1.1.0
```

> 注意：Git ref 不可包含 `:`，因此採用 `<id>-v<version>` 格式。

工作流步驟：

1. 解析 Tag 取得 `id` 與 `version`
2. 比對匯出相同 `USERSCRIPT_ID` 的 `vite.config.ts` 所在套件
3. 注入 `USERSCRIPT_VERSION` 執行 `bun install --frozen-lockfile` → `typecheck` → `build`
4. 將 `dist/*.user.js` 與 `dist/*.meta.js` 作為 GitHub Release 附件發布
5. 將成品與 `dist/locales.json` 以 `git add -f` 提交至 `main` 分支的 `dist/`，確保 `@updateURL`／`@downloadURL` 與翻譯檔可透過 `raw.githubusercontent.com` 解析

> 注意：`dist/` 與 `.dist-dev/` 皆列於 `.gitignore`，僅 CI 發布流程會提交正式成品；本機 `bun run build` 產物一律隔離在 `.dist-dev/`，且 `.githooks/pre-commit` 會阻擋誤提交。

## 框架選擇指引

| 腳本性質                               | 推薦框架       |
| -------------------------------------- | -------------- |
| DOM 操作型：改寫既有按鈕、監聽頁面事件 | **Vanilla TS** |
| 完整應用型：浮層面板、複雜狀態管理     | **SolidJS**    |
| 內容聚合型：提取頁面資料重新渲染       | **Svelte**     |

詳見 [docs/monorepo-architecture.md](docs/monorepo-architecture.md)。

## 貢獻與提交規範

1. 從 `main` 分支切出功能分支，完成變更後確認 `bun run check`、`bun run --filter '*' typecheck` 與 `bun test ./packages` 全數通過。
2. 所有 Commit 須加上 `Signed-off-by`（`git commit -s`），以符合 [Developer Certificate of Origin (DCO)](https://developercertificate.org/)。
3. Commit 訊息建議遵循 [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)。
4. 提交 Pull Request 時，若包含大量 LLM／Coding Agent 產生的程式碼，請於 PR 說明中揭露，並確認已親自審閱與測試。
5. 發現安全漏洞請透過 [GitHub Private Vulnerability Reporting](https://github.com/OG-Open-Source/UserScripts/security/advisories/new) 或依 [SECURITY.md](SECURITY.md) 私下通報，切勿公開建立 Issue。

## 參考文件

- [Monorepo 架構規劃](docs/monorepo-architecture.md)
- [vite-plugin-monkey 設定參考](docs/vite-plugin-monkey.md)
- [Violentmonkey 參考文件](docs/violentmonkey.md)
