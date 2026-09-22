# Contributing to UserScripts

歡迎參與本倉庫的開發。本文件涵蓋環境建置、開發流程、新增腳本與發布規範。

---

## Table of Contents

- [環境需求](#環境需求)
- [快速開始](#快速開始)
- [目錄結構](#目錄結構)
- [新增腳本](#新增腳本)
- [設計規範](#設計規範)
- [發布](#發布)
- [框架選擇指引](#框架選擇指引)
- [文檔](#文檔)

---

## 環境需求

- [Bun](https://bun.sh/) >= 1.2（安裝：`powershell -c "irm bun.sh/install.ps1 | iex"` 或 `npm install -g bun`）

## 快速開始

```shell
git clone https://github.com/OG-Open-Source/UserScripts.git
cd UserScripts

# 安裝依賴（建立 workspace 連結）
bun install

# 開發單一腳本（HMR + 自動安裝至瀏覽器）
bun run dev:hanime1

# 開發所有腳本
bun run dev

# 建置單一腳本（產出 .user.js / .meta.js）
bun run build:hanime1

# 建置所有腳本
bun run build

# 型別檢查
bun run typecheck
```

## 目錄結構

```text
UserScripts/
├── .github/workflows/release.yml  # 發布工作流（tag 觸發）
├── docs/                          # 文檔
│   ├── vite-plugin-monkey.md      # vite-plugin-monkey 完整配置文檔
│   ├── violentmonkey.md           # Violentmonkey 元數據與 GM API 文檔
│   └── monorepo-architecture.md   # 本 Monorepo 架構規劃
├── packages/
│   ├── shared/                    # @userscripts/shared：共用工具與型別
│   └── hanime1-download-manager/  # hanime1 下載管理器（userscript.id: h1dl）
├── scripts/new-script.mjs         # 腳手架
└── package.json                   # workspaces 設定
```

## 新增腳本

```shell
bun run new-script my-script
# 或指定框架
bun run new-script my-script --framework solid
```

依腳本性質選擇框架（Vanilla / SolidJS / Svelte），腳手架會在 `packages/my-script/` 建立完整套件結構，並自動產生唯一的 `userscript.id`。

## 設計規範

注入網頁的 UI 應盡可能融入網站原生外觀，減少視覺突兀感並相容網站的主題切換。

### 圖示（Icon）

優先順序：

1. **網站原生圖示** — 使用網站已在頁面載入的圖示字體（如 Material Icons）或 SVG sprite，直接沿用既有 class 名稱
2. **Lucide** — 網站未提供可用圖示時，使用 [Lucide](https://lucide.dev/) 圖示

範例（優先使用網站原生 Material Icons class）：

```ts
const icon = document.createElement("i");
icon.className = "material-icons"; // 網站原生圖示字體
icon.textContent = "download";
```

### 樣式（Styles）

優先順序：

1. **網站原生樣式** — 直接沿用網站既有 class（如 `.more-horiz-panel`、`.video-show-action-btn`），外觀與互動行為自動與網站同步
2. **部分手搓** — 原生 class 無法涵蓋的部分（位置、進度條、checkbox 幾何）才自行撰寫 CSS，並從網站 CSS 變數讀取顏色
3. **其他** — 使用第三方 UI 庫（Tailwind / UnoCSS 等），僅在需要完整應用型介面時考慮
4. **全部手搓** — 僅在上述皆不適用時使用

> 注意：顏色**永不硬編碼**。透過 `@userscripts/shared` 的 `probeTheme()` 讀取網站 computed style，注入為 CSS 變數。

## 發布

版本號與腳本 id 皆由 **tag 統一管理**，`vite.config.ts` 是唯一真實來源（single source of truth）：

- **id** — `vite.config.ts` 匯出的 `USERSCRIPT_ID` 常數（小寫字母、數字與連字號）
- **版本** — 工作流從 tag 解析版本，以 `USERSCRIPT_VERSION` 環境變數注入建置，`vite.config.ts` 讀取它寫入 `@version`；本機建置（無 tag、無環境變數）回退為 `0.0.0-dev`
- **package.json 不含 `version` 或 `userscript.id`** — 避免多處管理不同步

發布時推送符合 `<id>-v<version>` 格式的 tag，GitHub Actions 會自動建置該套件並發布 Release：

```shell
# 例：發布 hanime1-download-manager（id: h1dl）v1.1.0
git tag h1dl-v1.1.0
git push origin h1dl-v1.1.0
```

> 注意：Git ref 名稱不可包含 `:`，因此使用 `<id>-v<version>` 而非 `<id>::v<version>`。

Tag 格式為 `<id>-v<version>`（如 `h1dl-v1.1.0`）。工作流會：

1. 解析 tag 取得 `id` 與版本
2. 找到 `USERSCRIPT_ID` 匹配的 `vite.config.ts` 所在套件
3. 以 `USERSCRIPT_VERSION` 環境變數執行 `bun install` → `typecheck` → `build`
4. 將 `dist/*.user.js` 與 `dist/*.meta.js` 作為 Release 附件發布

### 更新機制

建置產出的 `.user.js` 內含 `@updateURL`（指向 `.meta.js`）與 `@downloadURL`，安裝後的腳本可透過腳本管理器自動檢查更新。`@author` 統一為 `https://github.com/OG-Open-Source/UserScripts`。

## 框架選擇指引

| 腳本性質                               | 推薦框架       |
| -------------------------------------- | -------------- |
| DOM 手術型：改寫既有按鈕、監聽頁面事件 | **Vanilla TS** |
| 完整應用型：浮層面板、複雜狀態管理     | **SolidJS**    |
| 內容聚合型：提取頁面資料重新渲染       | **Svelte**     |

詳見 [docs/monorepo-architecture.md](docs/monorepo-architecture.md)。

## 文檔

- [vite-plugin-monkey 文檔](docs/vite-plugin-monkey.md)
- [Violentmonkey 文檔](docs/violentmonkey.md)
- [Monorepo 架構規劃](docs/monorepo-architecture.md)
