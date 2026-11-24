# Page Translator Lit UI, Original-Page Studio & Minimalist Settings Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Studio Mode always present the untouched original webpage by default (preserving all Studio tools), migrate `page-translator` UI views to `lit`, and replace external `simple.min.css` with a hand-crafted minimalist Settings UI where saving reloads only the settings page.

**Architecture:** Extract a testable Studio translation coordinator in `packages/page-translator/src/platform/studio-session.ts` wired into `main.ts` so entering Studio suspends/restores active translations while retaining manual preview toggle and resume-on-exit. Install `lit` in `packages/page-translator` and render Shadow DOM views (`basic/view.ts`, `studio/workspace/view.ts`, `studio/workspace/overlay.ts`) via `lit` `html` + `render` (without global `customElements.define`), preserving all `data-*` selectors, scroll position, controlled input behavior, and `superellipse(2)` styling. Generate `settings/shared/tokens.css` from `@userscripts/shared` (`getSettingsTokensCss()`), style settings pages with hand-crafted `settings/shared/minimal.css`, and reload only the settings page on Save.

**Tech Stack:** TypeScript, Lit (`lit` `^3.3.0`), Bun (`bun test`, `happy-dom`), Biome/Ultracite (`bun run check`), Vite (`vite-plugin-monkey`), `@userscripts/shared` hex-led 0-error OkLch tokens.

**Spec:** `docs/superpowers/specs/2026-11-24-ptr-lit-studio-original-and-minimal-settings-design.md`

## Global Constraints

- UTF-8 without BOM, LF line endings (`\n`), ISC license, no edits to `dist/`.
- Every git commit must include `-s` (`Signed-off-by:`) trailer per user preference.
- Do NOT register global `customElements.define(...)` tags; use `lit` `html`, `render`, `nothing` into `ShadowRoot` mount containers with `{ creationScope: doc }`.
- Preserve `#ptr-basic-ui` and `#ptr-studio-shell` host IDs, `markUiRoot(host, "ptr")`, `superellipse(2)` button geometry (`--rho: 0.5; border-radius: calc(var(--rho) * min(240px, 60px)); corner-shape: superellipse(2);`), zero `1px` box borders, and zero `scale()` on buttons.
- Preserve all `data-basic-*`, `data-studio-*`, `data-studio-dict`, and `data-studio-conflict-*` attributes and 100% i18n key parity across `MESSAGES_EN` and `locales.json`.
- Settings pages must NOT load `simple.min.css`, must have zero `<style>` tags and zero inline `style="..."` attributes, and must NOT reload or force-retranslate other open tabs on Save.
- Verify with `bun test ./packages`, `bun run --filter '*' typecheck`, `bun run check`, and `bun run --filter '*' build`.

## Review Focus

- Entering Studio when `autoTranslate` or `ptr:tab-active` is enabled (or while translation is already active) must restore `[data-tr-block]` to the original DOM and keep `ptr:tab-active` intact so exiting Studio can resume cleanly.
- Calling `lit` `render(...)` inside per-test `happy-dom` `Window` instances (where `globalThis.document` may be `undefined`) must work reliably without cross-document `DOMException` or missing `document` errors.
- Typing into `#ptr-studio-shell` controlled `<input>` / `<textarea>` fields (`selectorInput`, `deltaTextarea`, `scopeInput`, `transInput`, `importTextarea`, `searchInput`) must not be overwritten by unrelated state updates (such as selecting a bottom tab or toggling record).
- Saving invalid JSON in `siteDeltas` on `settings/translate/index.html` must display the error in `#note` and abort WITHOUT calling `dispatchSettings` or `location.reload()`.
- Explicit `data-theme-mode="light"` or `"dark"` on `settings/translate/index.html` must override OS `prefers-color-scheme` cleanly in generated `settings/shared/tokens.css` + `minimal.css`.

---

### Task 1: Studio Original-Page Session Coordinator & `main.ts` Integration

**Files:**

- Create: `packages/page-translator/src/platform/studio-session.ts`
- Modify: `packages/page-translator/src/main.ts`
- Test: `packages/page-translator/tests/v4/studio-session.test.ts`

**Interfaces:**

- Consumes: `startTranslation`, `stopTranslation`, `rescan`, `syncAllStyles`, `spaRescan` callbacks injected via options
- Produces (`packages/page-translator/src/platform/studio-session.ts`):
  - `export interface StudioSessionCoordinatorOptions { getAutoTranslate: () => boolean; getTabActive: () => boolean; isStudioActive: () => boolean; isTranslated: () => boolean; onClearCacheAndRestart: () => void; onRescanStudio: () => void; onRestoreForStudio: () => void; onSpaNavigate: () => void; onStartTranslation: () => void; onStopTranslation: () => void; }`
  - `export interface StudioSessionCoordinator { onBoot: () => void; onConfigUpdated: (shouldRetranslate: boolean) => void; onDeltaSaved: () => void; onDictUpdated: (skipStudioRescan?: boolean) => void; onSpaSettled: () => void; onStudioMount: () => void; onStudioUnmount: () => void; onToggleTranslate: () => void; readonly suspendedForStudio: boolean; }`
  - `export function createStudioSessionCoordinator(options: StudioSessionCoordinatorOptions): StudioSessionCoordinator`

- [ ] **Step 1: Write failing tests in `packages/page-translator/tests/v4/studio-session.test.ts`**

Cover all original-page Studio scenarios:

1. `onBoot()`: when `isStudioActive()` is `true` and `autoTranslate` or `tabActive` is `true`, sets `suspendedForStudio === true` and does NOT call `onStartTranslation()`; when `isStudioActive()` is `false`, calls `onStartTranslation()`.
2. `onStudioMount()`: when `isTranslated()` is `true`, sets `suspendedForStudio = true` and calls `onRestoreForStudio()`; `onStudioUnmount()` resumes via `onStartTranslation()` and clears `suspendedForStudio`.
3. `onSpaSettled()`, `onDeltaSaved()`, `onDictUpdated()`, and `onConfigUpdated(true)`: when `isStudioActive()` is `true`, calls `onRescanStudio()` (except when `skipStudioRescan` is `true`) and NEVER calls `onStartTranslation()`, `onSpaNavigate()`, or `onClearCacheAndRestart()`.
4. Manual preview toggle inside Studio (`onToggleTranslate()`): starts translation when untranslated (`suspendedForStudio = false`); if user exits Studio while still translated, stays translated; if user restores back to original inside Studio and exits, `autoTranslate` (or non-restored suspension) governs resume cleanly.

- [ ] **Step 2: Run test to verify RED**

Run: `bun test packages/page-translator/tests/v4/studio-session.test.ts`
Expected: FAIL (module `studio-session.ts` does not exist).

- [ ] **Step 3: Implement `studio-session.ts` and wire it into `packages/page-translator/src/main.ts`**

In `packages/page-translator/src/main.ts`:

- Add `suspendTranslationForStudio()` that sets `translationActive = false`, `activeConfigSnapshot = null`, calls `basicController.setTranslated(false)`, and calls `stopTranslation(false)` (leaving `ptr:tab-active` intact in `sessionStorage`, restoring `[data-tr-block]` to original DOM, and cancelling runner/observer + releasing breakpoint gate).
- Route `boot()` auto-start, `basicController.onStudioMount` / `onStudioUnmount`, `studioController.onSaveHostDelta` / `onToggleTranslate`, `onSiteDictUpdated`, `onConfigUpdated`, and `watchSpaNavigation.onSettled` through `studioSession`.
- Also in `studioController.onToggleTranslate` and `basicController.onToggleTranslate`, call `studioSession.onToggleTranslate()`.

- [ ] **Step 4: Run tests, typecheck, and lint**

Run: `bun test packages/page-translator/tests/v4/studio-session.test.ts && bun test ./packages && bun run --filter '*' typecheck && bunx ultracite check packages/page-translator/src/platform/studio-session.ts packages/page-translator/src/main.ts packages/page-translator/tests/v4/studio-session.test.ts`
Expected: PASS (0 failures, 0 errors).

- [ ] **Step 5: Commit**

```bash
git add packages/page-translator/src/platform/studio-session.ts packages/page-translator/src/main.ts packages/page-translator/tests/v4/studio-session.test.ts
git commit -s -m "feat(ptr): keep Studio Mode on original webpage and suspend active translations"
```

---

### Task 2: Hand-Crafted Minimalist Settings UI, `@userscripts/shared` Tokens & Self-Refresh on Save

**Files:**

- Modify: `packages/shared/src/theme-mode.ts`
- Modify: `packages/shared/src/ui-tokens.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `tools/sync-settings-tokens.mjs`
- Create: `settings/shared/minimal.css`
- Replace: `settings/shared/tokens.css` (via `bun run sync:tokens`)
- Modify: `index.html`
- Modify: `settings/language/index.html`
- Modify: `settings/translate/index.html`
- Modify: `packages/shared/tests/theme-mode.test.ts`
- Modify: `packages/shared/tests/ui-tokens.test.ts`
- Modify: `packages/page-translator/tests/v4/ui-tier.test.ts`

**Interfaces:**

- Consumes: `US_PALETTE_OKLCH`, `resolveThemeTokens`, `getUiTokensCss` internals in `packages/shared/src/ui-tokens.ts`
- Produces:
  - `export function getSettingsTokensCss(): string` in `packages/shared/src/ui-tokens.ts` (re-exported from `packages/shared/src/index.ts`), emitting `--us-*` tokens (`--us-bg`, `--us-surface`, `--us-surface-2`, `--us-surface-3`, `--us-fg`, `--us-muted`, `--us-accent-bg`, `--us-accent-fg`, `--us-accent-hover`, `--us-focus`, `--us-radius-*`, `--us-shadow*`, `--us-sans`, `--us-mono`, `--us-ease`) for `:root`, `@media (prefers-color-scheme: dark)` (`:root:not([data-theme-mode="light"])`), `:root[data-theme-mode="light"]`, and `:root[data-theme-mode="dark"]`.
  - Clean removal of `SimpleCssThemeTokens`, `SIMPLE_CSS_LIGHT_TOKENS`, `SIMPLE_CSS_DARK_TOKENS`, and `getSimpleCssThemeVarsCss`.
  - `settings/shared/minimal.css`: hand-crafted minimalist borderless stylesheet using `--us-*` tokens, `superellipse(2)` buttons, tonal cards, clean form/table alignment, responsive mobile spacing, zero `scale()`.
  - `settings/translate/index.html` and `settings/language/index.html`: link `tokens.css` + `minimal.css` (no `simple.min.css`), zero `<style>` / `[style]`, and `#apply` persists settings + stores `sessionStorage` notice + calls `window.location.reload()` (only on valid input, never reloading other tabs).

- [ ] **Step 1: Write failing tests in `packages/shared/tests/{theme-mode,ui-tokens}.test.ts` and `packages/page-translator/tests/v4/ui-tier.test.ts`**

- In `packages/shared/tests/theme-mode.test.ts`: remove `SIMPLE_CSS_*` test and keep `resolveThemeTokens` tests verifying `US_PALETTE_OKLCH` mapping.
- In `packages/shared/tests/ui-tokens.test.ts`: replace `getSimpleCssThemeVarsCss` tests with `getSettingsTokensCss()` tests asserting `--us-bg`, `--us-surface`, `--us-accent-bg`, `--us-radius-lg: 12px`, `prefers-color-scheme: dark`, `[data-theme-mode="light"]`, `[data-theme-mode="dark"]`, and byte-for-byte parity with `settings/shared/tokens.css`.
- In `packages/page-translator/tests/v4/ui-tier.test.ts`: update the settings tests to assert:
  1. All 3 HTML pages link `tokens.css` BEFORE `minimal.css`, do NOT reference `simplecss.org` / `simple.min.css`, have zero `<style>` tags and zero `[style]` attributes.
  2. `settings/shared/minimal.css` exists, contains no `scale(` and no `border: 1px`, and defines `.btn` with `superellipse(2)`.
  3. `settings/translate/index.html` and `settings/language/index.html` reload only themselves on Save (`location.reload()`) after persisting `sessionStorage` notice + `dispatchSettings(...)`, while invalid `siteDeltas` JSON returns early before `dispatchSettings` / `location.reload()`.
  4. All native `<select>` controls, Studio tier gating, and decoupled `volunteerBlockClicks` remain intact.

- [ ] **Step 2: Run tests to verify RED**

Run: `bun test packages/shared/tests/ui-tokens.test.ts packages/page-translator/tests/v4/ui-tier.test.ts`
Expected: FAIL (`getSettingsTokensCss` missing, pages still reference `simple.min.css`, `minimal.css` missing).

- [ ] **Step 3: Implement `getSettingsTokensCss()`, `sync-settings-tokens.mjs`, `minimal.css`, and migrate all 3 settings HTML pages**

- Refactor `packages/shared/src/ui-tokens.ts` to share token-emission logic cleanly between `getUiTokensCss` and `getSettingsTokensCss`, and remove `SimpleCssThemeTokens` / `SIMPLE_CSS_*` / `getSimpleCssThemeVarsCss` from `theme-mode.ts` and `index.ts`.
- Update `tools/sync-settings-tokens.mjs` and run `bun run sync:tokens`.
- Create `settings/shared/minimal.css` with hand-crafted minimalist borderless layout and `superellipse(2)` `.btn` / `.btn-primary` controls.
- Update `index.html`, `settings/language/index.html`, and `settings/translate/index.html` to load `tokens.css` + `minimal.css`, apply semantic classless/lightweight structure with zero inline `style="..."` attributes, and reload only the settings page via `window.location.reload()` after valid Save (consuming a `sessionStorage` key on load to display confirmation in `#note`).

- [ ] **Step 4: Run tests, typecheck, and lint**

Run: `bun test ./packages && bun run --filter '*' typecheck && bun run check`
Expected: PASS (0 failures, 0 errors).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/theme-mode.ts packages/shared/src/ui-tokens.ts packages/shared/src/index.ts packages/shared/tests/theme-mode.test.ts packages/shared/tests/ui-tokens.test.ts tools/sync-settings-tokens.mjs settings/shared/tokens.css settings/shared/minimal.css index.html settings/language/index.html settings/translate/index.html packages/page-translator/tests/v4/ui-tier.test.ts
git commit -s -m "feat(settings,shared): hand-craft minimalist settings UI and self-refresh on save"
```

---

### Task 3: Add `lit` Dependency & Migrate Basic Mode View (`basic/view.ts`) to Lit

**Files:**

- Modify: `packages/page-translator/package.json` and `bun.lock` (via `bun add lit`)
- Modify: `packages/page-translator/src/ui/basic/view.ts`
- Test: `packages/page-translator/tests/v4/basic-ui.test.ts`

**Interfaces:**

- Consumes: `lit` (`html`, `render`), `applyPtrTheme`, `getSharedPanelCss`, `markUiRoot`
- Produces: Lit-rendered `mountBasicView(doc, handlers, t)` in `packages/page-translator/src/ui/basic/view.ts` keeping the exact `BasicView` / `BasicViewHandlers` signatures and `#ptr-basic-ui` Shadow DOM hooks.

- [ ] **Step 1: Install `lit` in `packages/page-translator` and verify `happy-dom` compatibility**

Run `bun add lit` inside `packages/page-translator` (updates `packages/page-translator/package.json` and `bun.lock`).
Verify how `lit` `html` + `render` behaves when `globalThis.document` is undefined in `bun test` with `happy-dom`: if `lit-html` binds `document` at module evaluation time, add a small `ensureLitDom(doc)` or `creationScope` pattern (or `packages/page-translator/src/ui/lit-render.ts` helper if shared across Task 3 & Task 4!) that safely renders into `container` owned by `doc` in both browser userscripts and `happy-dom` tests.

- [ ] **Step 2: Write/verify failing tests in `packages/page-translator/tests/v4/basic-ui.test.ts`**

Add assertions verifying:

- `src/ui/basic/view.ts` uses `lit` (`html` / `render`) rather than `createElement("button")` chains and does not call `customElements.define`.
- Existing Basic UI tests (`3` buttons, `data-basic-action`, `#ptr-basic-studio`, `host.hidden`, `t()`, `superellipse(2)` CSS) remain covered and re-rendering on `setTranslated` updates DOM cleanly in place.

- [ ] **Step 3: Run test to verify RED**

Run: `bun test packages/page-translator/tests/v4/basic-ui.test.ts`
Expected: FAIL (`basic/view.ts` still uses imperative `createElement`).

- [ ] **Step 4: Implement Lit-based `basic/view.ts` (and shared `src/ui/lit-host.ts` helper if needed for `happy-dom` + `ShadowRoot` CSS)**

Keep `#ptr-basic-ui` Shadow DOM clean (`<style>` element + `<div class="ptr-lit-root">` rendered via `lit` `render(template, mountEl, { creationScope: doc })`!).

- [ ] **Step 5: Run tests, typecheck, and lint**

Run: `bun test packages/page-translator/tests/v4/basic-ui.test.ts packages/page-translator/tests/v4/ui-tier.test.ts && bun run --filter '*' typecheck && bunx ultracite check packages/page-translator/src/ui/basic packages/page-translator/tests/v4/basic-ui.test.ts`
Expected: PASS (0 failures, 0 errors).

- [ ] **Step 6: Commit**

```bash
git add packages/page-translator/package.json bun.lock packages/page-translator/src/ui/basic/view.ts packages/page-translator/tests/v4/basic-ui.test.ts
# plus packages/page-translator/src/ui/lit-host.ts if created
git commit -s -m "refactor(ptr): migrate Basic Mode view to Lit"
```

---

### Task 4: Migrate Studio Workspace & Overlay (`studio/workspace/{view,overlay}.ts`) to Lit

**Files:**

- Modify: `packages/page-translator/src/ui/studio/workspace/overlay.ts`
- Modify: `packages/page-translator/src/ui/studio/workspace/view.ts`
- Test: `packages/page-translator/tests/v4/studio-workspace.test.ts`
- Test: `packages/page-translator/tests/v4/studio-workspace-logic.test.ts`

**Interfaces:**

- Consumes: `lit` (`html`, `render`, `nothing`), `lit/directives/live.js` (or explicit controlled `.value` refs), `StudioWorkspaceViewHandlers`, `StudioWorkspaceView`, `ProjectedBox`
- Produces: Lit-rendered `renderOverlayBoxes` in `overlay.ts` and declarative Lit templates in `view.ts` preserving all `StudioWorkspaceView` methods, `data-studio-*` attributes, `scrollTop` preservation, controlled inputs (never clobbering user typing), and `t()` localization.

- [ ] **Step 1: Write failing tests in `packages/page-translator/tests/v4/studio-workspace.test.ts`**

Add assertions verifying:

1. `src/ui/studio/workspace/view.ts` imports `lit` and does not call `customElements.define`.
2. Typing in `deltaTextarea` / `selectorInput` / `transInput` / `scopeInput` / `searchInput` is NOT overwritten when unrelated view updates run (e.g. toggling `bottomCollapsed` or `renderBreakpoint`).
3. All existing 12 scenarios (mounts on `documentElement`, left explorer filtering, `+`/`-`/`*` rule actions, raw nodes export, site dict navigation/draft/import/conflicts, select mode click-lock, record & breakpoint gate, cleanup on exit/stop, `zh-Hant-TW` localization, `draftPatch` sync, `scrollTop` preservation, `superellipse(2)` top-right toolbar) pass unchanged.

- [ ] **Step 2: Run test to verify RED**

Run: `bun test packages/page-translator/tests/v4/studio-workspace.test.ts`
Expected: FAIL (currently imperative DOM, no `lit` import).

- [ ] **Step 3: Refactor `overlay.ts` and `view.ts` to declarative Lit templates**

- Decompose `view.ts` cleanly into focused template helpers: `renderTopToolbar`, `renderLeftDock`, `renderNodePanel`, `renderDictPanel`, `renderConflicts`, `renderBottomDock`.
- Use `lit` `render(..., mountEl, { creationScope: doc })` inside `#ptr-studio-shell` Shadow DOM (keeping `<style>` outside `mountEl` and `overlayLayer` either Lit-rendered or cleanly mounted inside `shell`).
- Preserve `nodeList.scrollTop` across `renderNodes` updates.
- Ensure `selectorInput`, `deltaTextarea`, `scopeInput`, `transInput`, `importTextarea`, and `searchInput` update `.value` when programmatic APIs (`setDeltaText`, `renderSelectedNode`, `renderDictEntry`, `onSuggestScope`) explicitly change them, and sync state on `input` events so typing is never clobbered by unrelated renders.
- Check `ultracite check` / Biome complexity and style rules so `view.ts` stays concise and passes with 0 lint errors.

- [ ] **Step 4: Run full verification suite**

Run:

```bash
bun test ./packages
bun run --filter '*' typecheck
bun run check
bun run --filter '*' build
git status --short
```
Expected:

- `bun test ./packages`: 0 failures across all packages.
- `bun run --filter '*' typecheck`: exit 0.
- `bun run check`: 0 errors across the entire repo.
- `bun run --filter '*' build`: exit 0, `.dist-dev/` built cleanly, `dist/` untouched.

- [ ] **Step 5: Commit**

```bash
git add packages/page-translator/src/ui/studio/workspace/overlay.ts packages/page-translator/src/ui/studio/workspace/view.ts packages/page-translator/tests/v4/studio-workspace.test.ts packages/page-translator/tests/v4/studio-workspace-logic.test.ts
git commit -s -m "refactor(ptr): migrate Studio Workspace and overlay rendering to Lit"
```
