# Page Translator: Lit UI, Original-Page Studio Stage, and Minimalist Hand-Crafted Settings

Date: 2026-11-24
Package scope: `@userscripts/page-translator`, `@userscripts/shared`, `settings/*`, `index.html`, `tools/sync-settings-tokens.mjs`

## 1. Intent & Why

1. **Studio Mode must present the original webpage**: Studio Mode exists to inspect raw page DOM candidates, edit per-site `+` / `-` / `*` capture rules, and curate host dictionaries against authentic source text. Showing already-translated `[data-tr-block]` nodes or auto-translating on load/navigation defeats selector inspection and makes the stage noisy.
2. **Google Lit architecture (without Tweakpane)**: Adopting `lit` (`~15.5 kB` min / `~6.0 kB` gzip) replaces ~1,200 lines of imperative `document.createElement` / `replaceChildren` / `addEventListener` DOM assembly in `page-translator` UI views with declarative templates while avoiding `tweakpane` (`~148.4 kB` min / `~30.4 kB` gzip), which would increase bundle size and conflict with Studio tables/editors.
3. **Hand-crafted minimalist Settings UI & self-refresh on Save**: Replacing external `simple.min.css` with zero-dependency, hand-crafted minimalist HTML/CSS backed by `@userscripts/shared` OkLch tokens cuts external CDN coupling and gives clean visual hierarchy. Pressing Save persists settings via the userscript bridge and reloads only the settings page itself to verify persisted state, without reloading or force-retranslating other open browser tabs.

## 2. Goals, Non-Goals, and Anti-Goals

### Goals

- **G1 (Original Webpage in Studio)**: Entering Studio Mode automatically restores any active page translations to the untouched original DOM, suppresses automatic translation (`autoTranslate`, `ptr:tab-active`, SPA auto-rescan, dict/delta auto-retranslate) while Studio is active, and keeps all existing Studio features (including explicit manual `Translate / Restore` preview toggle, Inspect/Node Explorer, `+`/`-`/`*` Rule Editor, Site Dict Workbench, Diagnostics, Record & Log, API Breakpoint, Export/Import, Zoom, Box Mode, Select/Interact mode, Settings, Exit) intact.
- **G2 (Lit UI Rendering)**: Migrate `packages/page-translator/src/ui/basic/view.ts` and `packages/page-translator/src/ui/studio/workspace/view.ts` (and overlay rendering if cleaner) to `lit` (`html`, `render`, `nothing`), preserving existing Shadow DOM host IDs, `data-us-ui="ptr"`, `translate="no"`, `superellipse(2)` button styling, and all DOM hook attributes.
- **G3 (Hand-Crafted Minimalist Settings)**: Remove `cdn.simplecss.org/simple.min.css` from `index.html`, `settings/language/index.html`, and `settings/translate/index.html`; introduce a lean, hand-crafted stylesheet (`settings/shared/minimal.css`) paired with `@userscripts/shared`-generated OkLch tokens (`settings/shared/tokens.css`).
- **G4 (Save Refreshes Only Settings Page)**: On `settings/translate/index.html` and `settings/language/index.html`, clicking Apply/Save synchronously persists to `GM_setValue` via `dispatchSettings(...)`, stores a brief `sessionStorage` notice so feedback survives reload, and executes `window.location.reload()` on the settings page only. Other open tabs are never reloaded or forced to re-translate.

### Non-Goals

- Modifying `packages/hanime1-download-manager` UI or adding `lit` to it.
- Stripping or removing any existing Studio Workspace tabs, tools, or controls.
- Introducing Tweakpane or any heavy CSS/component library.
- Modifying `dist/` release artifacts (only local `.dist-dev/` dev builds are produced during verification).

### Anti-Goals

- Registering global `customElements.define(...)` tags on host pages where Tampermonkey/Violentmonkey sandboxes, CSP, or multi-window `happy-dom` tests can collide or fail.
- Adding `GM_addValueChangeListener` or cross-tab broadcast reloads that interrupt other active webpages when settings are saved.
- Using `transform: scale()` on UI buttons/controls or `1px solid` borders inside panels (preserve borderless tonal surfaces and `superellipse(2)` button geometry).

## 3. Approaches Considered

1. **Zero-dependency slim hand-crafted TS + stripped Studio UI**: Lowest runtime overhead (`0 kB` added), but keeps verbose imperative DOM construction in `view.ts` and removes Studio features the user wants to keep.
2. **`lit` (`~6 kB` gzip) + `tweakpane` (`~30 kB` gzip)**: Adds `+148 kB` minified JS for Tweakpane alone, increasing total bundle size rather than reducing it, and forces custom tables/editors into an incompatible param-pane schema.
3. **`lit` declarative templates (`html` + `render`) in Shadow DOM + full-feature Original-Page Studio + zero-dep hand-crafted Settings UI (Selected)**: Eliminates imperative DOM boilerplate in `page-translator` UI using `lit` (`~6 kB` gzip), keeps all Studio tools while locking Studio's default stage to the original DOM, and makes static settings pages completely dependency-free.

## 4. Detailed Architecture & Design

### 4.1 Studio Mode: Original Webpage Stage (`packages/page-translator/src/main.ts`, `src/ui/studio/workspace/*`)

- **Entering Studio (`uiTier: "studio"`)**:
  - Introduce `suspendedTranslationForStudio` state in `main.ts`.
  - When Studio activates (either at `boot()` when `loadConfig().uiTier === "studio"`, or when `onStudioMount` fires from Basic pill / GM menu / `onConfigUpdated`):
    - If `translationActive` is `true`, record `suspendedTranslationForStudio = true`, call `stopTranslation(false)` (cancels runner/observer, releases breakpoint gate, restores `[data-tr-block]` to original text in `document` and `knownShadowRoots`), set `translationActive = false`, and update `basicController.setTranslated(false)` without clearing `ptr:tab-active` in `sessionStorage`.
    - At `boot()`, guard auto-start with `!studioController.isActive()`: if `uiTier === "studio"` and `(loadConfig().autoTranslate || readTabActive())`, set `suspendedTranslationForStudio = true` instead of calling `startTranslation()`, keeping the initial Studio stage untranslated.
- **While Studio is active**:
  - `watchSpaNavigation.onSettled()`: if `studioController.isActive()`, prune shadow roots, `syncAllStyles()`, and call `studioController.rescan()` — never call `spaRescan.onSpaNavigate(...)` / `startTranslation()`.
  - `onSaveHostDelta()` and `onSiteDictUpdated()`: if `studioController.isActive()`, do **not** call `startTranslation()`; call `studioController.rescan()` (if not already triggered) so selectors and dictionary hit badges update cleanly against the original DOM.
  - `onConfigUpdated()`: while `studioController.isActive()`, sync styles and studio state, but do **not** auto-start translation.
  - **Retained manual preview toggle**: Clicking the Studio toolbar's `Translate` / `Restore` button (`onToggleTranslate`) remains functional for explicit on-demand preview testing inside Studio; toggling it off (or exiting and re-entering Studio) restores the original DOM. If the user explicitly runs `Translate` inside Studio and then clicks `Exit Studio`, `translationActive` stays `true`; if `translationActive` is `false` on exit and `suspendedTranslationForStudio || loadConfig().autoTranslate` is `true`, exiting Studio resumes translation.
- **Stage layout (`src/ui/studio/workspace/stage.ts`)**:
  - Keep `mountStudioStage` framing `html[data-ptr-studio-active="1"] > body` inside the top-center stage, and verify `syncAllStyles()` continues applying `debugInspect` outlines only when appropriate (note: original untranslated nodes do not carry `[data-tr-block]`, so Studio's `overlayLayer` boxes project candidate rects cleanly over the original DOM).

### 4.2 Google Lit Migration (`packages/page-translator`)

- **Dependency**: Add `"lit": "^3.3.0"` to `packages/page-translator/package.json` `dependencies`.
- **Rendering pattern (`lit` `html`, `render`, `nothing` into `ShadowRoot`)**:
  - Keep host elements as `<div>` with existing IDs (`#ptr-basic-ui` and `#ptr-studio-shell`), `markUiRoot(host, "ptr")`, and `host.attachShadow({ mode: "open" })`. Adopt `lit` `html` / `render` inside a `<style>` + Lit-managed content container (or adopt stylesheet once and call `render(template, mountTarget)` on a `<div class="ptr-root">` inside `shadowRoot` so `<style>` stays untouched).
  - Why `render(html\`...\`, container)`instead of`customElements.define`: avoids host-page `customElements`registry pollution/CSP issues in Tampermonkey/Violentmonkey and works identically across per-test`happy-dom` `Window` instances.
- **Basic View (`packages/page-translator/src/ui/basic/view.ts`)**:
  - Replace manual `createElement` button construction with a concise Lit template rendering the 3 buttons (`data-basic-action="translate"`, `data-basic-action="settings"`, `#ptr-basic-studio`) with reactive `aria-pressed`, label text, and `host.hidden` updates.
- **Studio Workspace View (`packages/page-translator/src/ui/studio/workspace/view.ts` and `overlay.ts`)**:
  - Replace the ~900 lines of imperative DOM construction and `replaceChildren(frag)` loops with composable Lit template functions (`renderTopToolbar`, `renderLeftDock`, `renderRightDock`, `renderBottomDock`, `renderOverlayBoxes`) backed by a single reactive view-state object inside `mountStudioWorkspaceView`.
  - Preserve `nodeList.scrollTop` across `renderNodes` updates and preserve all `data-studio-*` attributes, CSS classes, input/textarea controlled bindings (only syncing input/textarea `.value` when programmatic props like `setDeltaText`, `renderSelectedNode`, `renderDictEntry` update so typing is never clobbered), and `superellipse(2)` styling.
  - Also keep `view.ts` clean and idiomatic for `@biomejs/biome` / `ultracite check`.

### 4.3 Hand-Crafted Minimalist Settings UI & Refresh Behavior (`settings/*`, `index.html`, `packages/shared`)

- **Tokens (`packages/shared/src/ui-tokens.ts` & `tools/sync-settings-tokens.mjs` & `settings/shared/tokens.css`)**:
  - Replace `getSimpleCssThemeVarsCss()` (or add `getSettingsThemeTokensCss()` and update `sync-settings-tokens.mjs`) so `settings/shared/tokens.css` emits `@userscripts/shared` OkLch `--us-*` tokens (`--us-bg`, `--us-surface`, `--us-surface-2`, `--us-surface-3`, `--us-fg`, `--us-muted`, `--us-accent-bg`, `--us-accent-fg`, `--us-accent-hover`, `--us-focus`, `--us-radius-*`, `--us-shadow*`, `--us-sans`, `--us-mono`, `--us-ease`) for `system`, `[data-theme-mode="light"]`, and `[data-theme-mode="dark"]`.
- **Hand-crafted Minimalist CSS (`settings/shared/minimal.css`)**:
  - Zero external CSS dependencies (`simple.min.css` removed from all HTML files).
  - Single-column centered container (`max-width: 720px`, clean spacing), subtle header + navigation + status chip, tonal surface cards (`--us-surface`) without `1px` borders, crisp form rows with native `<select>`/`<input>`/`<textarea>`, `superellipse(2)` buttons (`.btn`, `.btn-primary`), clean monospace table for cached dictionaries / installed scripts, and responsive mobile padding.
  - Zero inline `<style>` tags and zero inline `style="..."` attributes in HTML (`ui-tier.test.ts` clean).
- **Save -> Reload Settings Page Only**:
  - In `settings/translate/index.html`: `#apply` validates `siteDeltas` JSON (if invalid, displays error in `#note` and returns without saving or reloading), saves `localStorage`, synchronously calls `dispatchSettings({ ptr })` (which writes `GM_setValue`), writes a short status key in `sessionStorage` (e.g. `userscripts:ptr:saved-note`), and calls `window.location.reload()`. On page load, if that `sessionStorage` key is present, consume it and display `#note` (`appliedPtr` / `savedLocalPtr`).
  - In `settings/language/index.html`: `#apply` persists `localStorage`, synchronously calls `dispatchSettings({ lang })`, records a `sessionStorage` saved flag, and calls `window.location.reload()`, displaying the confirmation notice in the newly selected UI language after reload.
  - In `packages/page-translator/src/platform/bridge.ts` and `main.ts`: do NOT add `GM_addValueChangeListener` or cross-tab page reloads; saving on the settings page refreshes only the settings page itself.

## 5. Verification Plan

- Update `packages/shared/tests/ui-tokens.test.ts` and `packages/page-translator/tests/v4/ui-tier.test.ts` for the new `tokens.css` + `minimal.css` contract (no `simple.min.css`, no inline styles, native `<select>` and tier visibility preserved).
- Add tests verifying:
  1. Studio Mode restores active translation to original webpage on mount, keeps original webpage during `boot()` / SPA navigation / delta save when `uiTier === "studio"`, and resumes cleanly on exit if suspended.
  2. Lit-rendered `BasicView` and `StudioWorkspaceView` preserve all `data-basic-*`, `data-studio-*`, scroll preservation, dict prev/next/save reset behavior, and i18n keys.
  3. Settings `#apply` triggers `location.reload()` after `dispatchSettings` (and does not reload on invalid JSON).
- Run `bun test ./packages`, `bun run --filter '*' typecheck`, `bun run check` (`ultracite check`), and `bun run --filter '*' build` (verifying `.dist-dev/page-translator.user.js` bundle size stays lean and `dist/` remains untouched).
