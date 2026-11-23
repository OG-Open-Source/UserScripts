# Hex-Led 0-Error OkLch Core & Simple.css Settings Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hex-led 0-error (`<= 2` decimals) OkLch color core in `@userscripts/shared` anchored on `#D71 / #677 / #334`, programmatically generate `settings/shared/tokens.css`, and migrate all three settings pages to external `https://cdn.simplecss.org/simple.min.css` with native `<select>` controls and no Simple.css layout overrides.

**Architecture:** `packages/shared/src/color.ts` owns hex normalization, 0-error `<= 2`-decimal OkLch conversion/verification, and `US_PALETTE_HEX` / `US_PALETTE_OKLCH`. `packages/shared/src/theme-mode.ts` and `ui-tokens.ts` derive both Shadow DOM tokens (`getUiTokensCss`) and Simple.css variable sheets (`getSimpleCssThemeVarsCss`) programmatically from `US_PALETTE_OKLCH`, while `tools/sync-settings-tokens.mjs` writes `settings/shared/tokens.css` and a test prevents drift. The three static HTML pages (`index.html`, `settings/language/index.html`, `settings/translate/index.html`) load `https://cdn.simplecss.org/simple.min.css` plus `settings/shared/tokens.css` and use native semantic HTML (`<header>`, `<nav>`, `<main>`, `<section>`, `<select>`, `<table>`).

**Tech Stack:** TypeScript, Bun (`bun test`), Biome/Ultracite (`bun run check`), Vite (`vite-plugin-monkey`), Simple.css (`https://cdn.simplecss.org/simple.min.css`).

**Spec:** `docs/superpowers/specs/2026-11-23-hex-oklch-simplecss-settings-design.md`

## Global Constraints

- UTF-8 without BOM, LF line endings (`\n`), no edits to `dist/`.
- Every hex anchor in `US_PALETTE_HEX` must round-trip through `oklch()` with `maxChannelError === 0` and at most 2 decimal places (`L%` `<= 2` dec, `C <= 2` dec, `H` `<= 2` dec).
- `settings/shared/tokens.css` must ONLY define CSS custom properties (`--bg`, `--accent-bg`, `--text`, `--text-light`, `--border`, `--accent`, `--accent-hover`, `--accent-text`, `--code`, `--preformatted`, `--marked`, `--disabled`, `color-scheme`) for light/dark/`[data-theme-mode]` — never override Simple.css element layout, borders, padding, or typography.
- `getUiTokensCss()` must retain Borderless Shadow DOM rules (`--us-radius-lg: 12px`, `--us-radius-md: 8px`, `--us-radius-sm: 6px`, no `border: 1px`, no `scale()`, `--nk-*`, `--us-overlay-*`, `.us-*`) so `packages/hanime1-download-manager` and `packages/page-translator` remain fully functional.
- Preserve all userscript storage keys, custom events (`userscript:settings`, `userscript:presence`, `userscript:ptr-*`), and 3-language settings i18n (`en-US`, `zh-Hant-TW`, `zh-Hans-CN`).
- Verify every change with `bun test ./packages`, `bun run --filter '*' typecheck`, `bun run check`, and `bun run --filter '*' build`.

## Review Focus

- Shorthand `#RGB` vs full `#RRGGBB` input (with or without leading `#`, mixed case) passed to `normalizeHex` / `hexToOklab` / `hexToZeroErrorOklch` must normalize identically without failing on `#D71`, `#677`, `#334`.
- Non-0-error or malformed hex input passed to `formatZeroErrorOklch` must throw `RangeError` rather than silently emitting drifted colors.
- Explicit `:root[data-theme-mode="light"]` under OS dark mode (`prefers-color-scheme: dark`) must stay light in `settings/shared/tokens.css`, and explicit `:root[data-theme-mode="dark"]` under OS light mode must switch dark.
- On `settings/translate/index.html`, Basic Mode (`#studioMode` unchecked) must keep Typography/Presentation, CJK Spacing & Conversion, and the `#apply` button visible and functional, while keeping `#studioMode`-gated Studio sections (`defaultInspect`, `defaultVolunteer`, `siteDeltas`, dictionary table) hidden until checked.
- `settings/language/index.html` and `settings/translate/index.html` must retain selected values cleanly on native `<select>` elements when options are populated asynchronously from `userscript:ptr-config` or `localeUrl` fetches.

---

### Task 1: Hex-Led 0-Error OkLch Color Engine in `@userscripts/shared`

**Files:**

- Modify: `packages/shared/src/color.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/color.test.ts`

**Interfaces:**

- Consumes: existing Oklab/Oklch math in `packages/shared/src/color.ts`
- Produces (exported from `packages/shared/src/color.ts` and re-exported from `packages/shared/src/index.ts`):
  - `export interface ZeroErrorOklchResult { C: number; css: string; h: number; hex: string; L: number; maxChannelError: number; }`
  - `export function normalizeHex(hex: string): string | null`
  - `export function oklchToHex(lch: Oklch): string`
  - `export function hexToZeroErrorOklch(hex: string): ZeroErrorOklchResult | null`
  - `export function formatZeroErrorOklch(hex: string): string`
  - `export const US_PALETTE_HEX` (readonly object with keys `accent`, `accentDeep`, `accentSoft`, `secondary`, `mutedDark`, `slate`, `inkDark`, `surfaceDark`, `surfaceDark3`, `surfaceLight3`, `borderLight`, `surfaceLight`, `canvasLight`)
  - `export const US_PALETTE_OKLCH: Readonly<Record<keyof typeof US_PALETTE_HEX, string>>`

- [ ] **Step 1: Write failing tests in `packages/shared/tests/color.test.ts`**

Add tests verifying:

1. `normalizeHex` handles `"#D71"` -> `"#DD7711"`, `"677"` -> `"#667777"`, `"#334"` -> `"#333344"`, `"#aabbcc"` -> `"#AABBCC"`, and rejects `"nope"` / `"#12"` as `null`.
2. `hexToOklab("#D71")` equals `hexToOklab("#DD7711")`.
3. `hexToZeroErrorOklch` returns exact 0-error `<= 2`-decimal CSS strings for the brand triad:
   - `"#D71"` -> `css: "oklch(67.15% 0.16 56)"`, `maxChannelError: 0`
   - `"#677"` -> `css: "oklch(55.54% 0.02 197)"`, `maxChannelError: 0`
   - `"#334"` -> `css: "oklch(32.84% 0.03 285)"`, `maxChannelError: 0`
4. Every entry in `US_PALETTE_HEX` produces `maxChannelError === 0`, has `<= 2` decimal places in every numeric token of `US_PALETTE_OKLCH[key]`, and round-trips via `oklchToHex` back to `normalizeHex(hex)`.
5. `formatZeroErrorOklch("nope")` throws `RangeError`, and `formatZeroErrorOklch("#112")` (which has no 0-error candidate at `C <= 2` decimals) throws `RangeError`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/shared/tests/color.test.ts`
Expected: FAIL (missing exports `normalizeHex`, `hexToZeroErrorOklch`, `formatZeroErrorOklch`, `US_PALETTE_HEX`, `US_PALETTE_OKLCH`).

- [ ] **Step 3: Implement hex-led 0-error OkLch conversion and palette in `packages/shared/src/color.ts` and export in `packages/shared/src/index.ts`**

Algorithm details:

- Support both `#RGB` and `#RRGGBB` in `normalizeHex` and `hexToOklab`.
- `oklchToHex(lch)` delegates to `oklabToHex(oklchToOklab(lch))`.
- `hexToZeroErrorOklch(hex)`:
  - Normalize hex to RGB bytes `[r, g, b]` and compute exact `oklabToOklch(lab)`.
  - Tier 1 (matching `NovaKit/tools/hex-oklch-explorer.html`): `L2 = roundTo(lch.L * 100, 2)`, `C2 = roundTo(lch.C, 2)`, `H0 = C2 === 0 ? 0 : Math.round(lch.h) % 360`. Check `maxChannelError` against `[r, g, b]`; if `0`, return immediately.
  - Tier 2 (bounded neighborhood search within `<= 2` decimals): scan `dC` in `[0, 0.01, -0.01]`, `dH` in `[0, 1, -1, 2, -2]` (integer hue), `dL` in `[-50..50]` (`0.01%` steps); if still not 0, scan `H` at `0.01` steps (`±1.00`) and `dL` `[-30..30]`. Return first exact 0-error match.
  - Otherwise return the best candidate from Tier 1 with its actual non-zero `maxChannelError`.
  - Format CSS cleanly without redundant trailing zeros (`Number(val.toFixed(2))`), e.g. `oklch(25.2% 0 0)` and `oklch(67.15% 0.16 56)`.
- `formatZeroErrorOklch(hex)`: call `hexToZeroErrorOklch(hex)`; throw `RangeError` if `null` or `result.maxChannelError !== 0`; return `result.css`.
- Define `US_PALETTE_HEX` with the exact 13 hex anchors from the spec (`#D71`, `#952`, `#C72`, `#677`, `#899`, `#334`, `#111`, `#222`, `#444`, `#CCC`, `#DDD`, `#EEE`, `#FFF`) and derive `US_PALETTE_OKLCH` via `formatZeroErrorOklch` for every key.
- Preserve existing `NOVAKIT`, `formatOklch`, `getAccessibleTextOklch`, `oklabToHex`, `oklabToOklch`, `oklchToOklab` exports unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/shared/tests/color.test.ts`
Expected: PASS (0 failures).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/color.ts packages/shared/src/index.ts packages/shared/tests/color.test.ts
git commit -m "feat(shared): add hex-led 0-error OkLch engine and brand palette"
```

---

### Task 2: Programmatic Theme Tokens, Simple.css Variable Sheet & Sync Script

**Files:**

- Modify: `packages/shared/src/theme-mode.ts`
- Modify: `packages/shared/src/ui-tokens.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `tools/sync-settings-tokens.mjs`
- Modify: `package.json`
- Replace: `settings/shared/tokens.css` (generated via `tools/sync-settings-tokens.mjs`)
- Test: `packages/shared/tests/theme-mode.test.ts`
- Test: `packages/shared/tests/ui-tokens.test.ts`

**Interfaces:**

- Consumes: `US_PALETTE_OKLCH`, `US_PALETTE_HEX`, `formatZeroErrorOklch` from `packages/shared/src/color.ts`
- Produces:
  - `export interface SimpleCssThemeTokens { accent: string; accentBg: string; accentHover: string; accentText: string; bg: string; border: string; code: string; disabled: string; marked: string; preformatted: string; text: string; textLight: string; }` in `packages/shared/src/theme-mode.ts`
  - `export const SIMPLE_CSS_LIGHT_TOKENS: SimpleCssThemeTokens` and `export const SIMPLE_CSS_DARK_TOKENS: SimpleCssThemeTokens` in `packages/shared/src/theme-mode.ts`
  - `export function getSimpleCssThemeVarsCss(): string` in `packages/shared/src/ui-tokens.ts` (re-exported from `packages/shared/src/index.ts`)
  - CLI script `tools/sync-settings-tokens.mjs` and root script `"sync:tokens": "bun run tools/sync-settings-tokens.mjs"`

- [ ] **Step 1: Write failing tests in `packages/shared/tests/theme-mode.test.ts` and `packages/shared/tests/ui-tokens.test.ts`**

In `theme-mode.test.ts`:

- Assert `resolveThemeTokens("dark")` uses `US_PALETTE_OKLCH` values (`bg === US_PALETTE_OKLCH.inkDark`, `surface === US_PALETTE_OKLCH.surfaceDark`, `surface2 === US_PALETTE_OKLCH.slate`, `surface3 === US_PALETTE_OKLCH.surfaceDark3`, `fg === US_PALETTE_OKLCH.surfaceLight`, `muted === US_PALETTE_OKLCH.mutedDark`, `accentBg === US_PALETTE_OKLCH.accent`, `accentFg === US_PALETTE_OKLCH.inkDark`).
- Assert `resolveThemeTokens("light")` uses `US_PALETTE_OKLCH` values (`bg === US_PALETTE_OKLCH.canvasLight`, `surface === US_PALETTE_OKLCH.surfaceLight`, `surface2 === US_PALETTE_OKLCH.borderLight`, `surface3 === US_PALETTE_OKLCH.surfaceLight3`, `fg === US_PALETTE_OKLCH.slate`, `muted === US_PALETTE_OKLCH.secondary`, `accentBg === US_PALETTE_OKLCH.accent`, `accentFg === US_PALETTE_OKLCH.inkDark`).
- Assert `SIMPLE_CSS_LIGHT_TOKENS` and `SIMPLE_CSS_DARK_TOKENS` match the spec mapping.

In `ui-tokens.test.ts`:

- Assert `getSimpleCssThemeVarsCss()` contains `:root`, `@media (prefers-color-scheme: dark)`, `:root:not([data-theme-mode="light"])`, `:root[data-theme-mode="light"]`, `:root[data-theme-mode="dark"]`, `--accent: ${US_PALETTE_OKLCH.accent}`, `--border: ${US_PALETTE_OKLCH.secondary}`, and contains NO element/class selectors (`body`, `header`, `.us-`, `border:`, `padding:`, `margin:`).
- Assert `settings/shared/tokens.css` read from disk equals `${getSimpleCssThemeVarsCss()}\n` (exact drift check!).

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/shared/tests/theme-mode.test.ts packages/shared/tests/ui-tokens.test.ts`
Expected: FAIL (old tokens & missing `getSimpleCssThemeVarsCss` / stale 612-line `settings/shared/tokens.css`).

- [ ] **Step 3: Update `theme-mode.ts`, `ui-tokens.ts`, `index.ts`, add `tools/sync-settings-tokens.mjs`, add `"sync:tokens"` to `package.json`, and run sync**

- In `packages/shared/src/theme-mode.ts`: derive `DARK_TOKENS`, `LIGHT_TOKENS`, `SIMPLE_CSS_DARK_TOKENS`, and `SIMPLE_CSS_LIGHT_TOKENS` from `US_PALETTE_OKLCH`.
- In `packages/shared/src/ui-tokens.ts`:
  - Update `--us-accent-hover` and `--us-focus` in `getUiTokensCss` to use `US_PALETTE_OKLCH.accentDeep` (light), `US_PALETTE_OKLCH.accentSoft` (dark), and `US_PALETTE_OKLCH.accent` (focus), preserving all existing Shadow DOM rules (`--nk-*`, `--us-radius-*`, `--us-overlay-*`, `.us-*`, `@keyframes us-pulse-ring`).
  - Implement `getSimpleCssThemeVarsCss()` emitting a generated header comment plus ONLY `:root`, `@media (prefers-color-scheme: dark)` (`:root:not([data-theme-mode="light"])`), `:root[data-theme-mode="light"]`, and `:root[data-theme-mode="dark"]` blocks setting Simple.css's 12 custom properties + `color-scheme`. Ensure Biome/Ultracite formatting compatibility (2-space indent, double quotes in attribute selectors, LF endings).
- Re-export `SimpleCssThemeTokens`, `SIMPLE_CSS_DARK_TOKENS`, `SIMPLE_CSS_LIGHT_TOKENS`, and `getSimpleCssThemeVarsCss` from `packages/shared/src/index.ts`.
- Create `tools/sync-settings-tokens.mjs` that writes `${getSimpleCssThemeVarsCss()}\n` (UTF-8, LF) to `settings/shared/tokens.css` and add `"sync:tokens": "bun run tools/sync-settings-tokens.mjs"` to root `package.json`.
- Run `bun run sync:tokens`.

- [ ] **Step 4: Run tests and lint check to verify they pass**

Run: `bun test packages/shared/tests packages/hanime1-download-manager/tests packages/page-translator/tests/v4/metrics.test.ts packages/page-translator/tests/v4/ui-tier.test.ts && bun run check`
Expected: PASS (0 failures, 0 lint errors).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/theme-mode.ts packages/shared/src/ui-tokens.ts packages/shared/src/index.ts packages/shared/tests/theme-mode.test.ts packages/shared/tests/ui-tokens.test.ts tools/sync-settings-tokens.mjs package.json settings/shared/tokens.css
git commit -m "feat(shared,settings): bind hex-led 0-error OkLch tokens and generate simple.css theme vars"
```

---

### Task 3: Migrate `settings/` Pages & `bridge.js` to External Simple.css URI and Native `<select>`

**Files:**

- Modify: `settings/shared/bridge.js`
- Modify: `index.html`
- Modify: `settings/language/index.html`
- Modify: `settings/translate/index.html`
- Modify: `packages/page-translator/tests/v4/ui-tier.test.ts`

**Interfaces:**

- Consumes: `https://cdn.simplecss.org/simple.min.css`, `settings/shared/tokens.css`, `settings/shared/i18n.js`, `settings/shared/bridge.js`
- Produces:
  - Lean `settings/shared/bridge.js` exporting `readScripts`, `collectScripts`, `hasScript`, `waitForScripts`, `onPresence`, `dispatchSettings` (removes `createCustomSelect` and custom dropdown SVG code).
  - Semantic Simple.css markup across `index.html`, `settings/language/index.html`, and `settings/translate/index.html` with native `<select>` elements and zero inline `style=""` attributes.

- [ ] **Step 1: Write failing tests in `packages/page-translator/tests/v4/ui-tier.test.ts`**

Add / update tests verifying:

1. All three settings pages (`index.html`, `settings/language/index.html`, `settings/translate/index.html`) include `<link href="https://cdn.simplecss.org/simple.min.css" rel="stylesheet">` (or attribute order agnostic match on `https://cdn.simplecss.org/simple.min.css`), include `tokens.css`, do NOT import `createCustomSelect`, and have zero `style="` inline attributes.
2. `settings/shared/bridge.js` no longer defines `createCustomSelect`.
3. `settings/translate/index.html`:
   - Uses native `<select>` controls (`<select id="providerSelect">`, `<select id="themeSelect">`, `<select id="spacingSelect">`, `<select id="punctSelect">`, `<select id="openccSelect">`, `<select id="localFontSelect">`).
   - Still preserves all v4 controls (`id="studioMode"`, `value="human-only"`, `id="defaultInspect"`, `id="defaultVolunteer"`, `volunteerBlockClicks: lockInput.checked`, `providerHumanOnly`, no `spaceSkippedCjk`, no `themeHost`).
   - Keeps Section 2 (Typography/Presentation), Section 3 (CJK Spacing & Conversion), and `#apply` OUTSIDE any `[data-tier="studio"]` section (parse with `happy-dom` `Window` so DOM ancestry is tested directly, not fragile regex!).
   - Keeps Studio-only sections (`#defaultInspect`, `#defaultVolunteer`, `#siteDeltas`, `#dictBody`) inside `[data-tier="studio"]` sections with `hidden`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/page-translator/tests/v4/ui-tier.test.ts`
Expected: FAIL (pages still use `createCustomSelect`, lack external `simple.min.css`, have inline `style=""`, and `#apply` / CJK section are inside `[data-tier="studio"]`).

- [ ] **Step 3: Refactor `bridge.js` and migrate all 3 HTML pages to Simple.css semantic markup**

1. **`settings/shared/bridge.js`**: remove `CHEVRON_SVG`, `CHECK_SVG`, `openDropdownClose`, and `createCustomSelect`. Keep all presence/settings bridge exports unchanged.
2. **`index.html`**:
   - Load `https://cdn.simplecss.org/simple.min.css` followed by `./settings/shared/tokens.css`.
   - Use `<header>` (heading, lead paragraph, `<nav>` with links to `./settings/language/` and `./settings/translate/`, status `<p id="statusChip">`) and `<main>` with `<section>` for settings cards (`<article>` or `<ul>`) and `<section>` for installed scripts (`<table>`). Zero custom `.us-*` layout classes or inline `style=""`.
3. **`settings/language/index.html`**:
   - Load `https://cdn.simplecss.org/simple.min.css` followed by `../shared/tokens.css`.
   - Use `<header>` (`<nav>` back to `../../`, heading, lead, `#statusChip`) and `<main><section>` containing `<label for="langSelect">` + native `<select id="langSelect">` + `<p><button id="apply" type="button">` + `<p id="note">`.
   - Preserve async `localeUrl` discovery and current-value selection on the native `<select>` (using `populateSelect(selectEl, options, desiredValue)` helper so value is never lost when options refresh).
4. **`settings/translate/index.html`**:
   - Load `https://cdn.simplecss.org/simple.min.css` followed by `../shared/tokens.css`.
   - Use `<header>` (`<nav>` back to `../../`, heading, lead, `#ptrStatus`) and `<main>`:
     - Section 1 (`Core & Routing`, always visible): `#targetLang`, native `<select id="providerSelect">` (options `translate-pa`, `inspect`, `human-only`), native `<select id="themeSelect">` (options `system`, `light`, `dark`, updating `data-theme-mode` on `change`), `#apiKey` + `#clearApiKey`, `#studioMode` checkbox.
     - Section 2 (`Presentation & Typography`, always visible): `#customFont` + `#loadFonts`, `<p id="localFontSelectWrap" hidden><select id="localFontSelect"></select></p>`, `<datalist id="localFontsList">`, `#fontNote`, `#customCss` + 3 preset buttons.
     - Section 3 (`CJK Spacing & Conversion`, **always visible** — remove `data-tier="studio" hidden`): native `<select id="spacingSelect">`, `<select id="punctSelect">`, `<select id="openccSelect">`, spacing note.
     - Section 4 (`Studio Defaults`, `data-tier="studio" hidden`): `#autoTranslate`, `#debugSpacingMarks`, `#defaultInspect`, `#defaultVolunteer`, `#volunteerBlockClicks`.
     - Section 5 (`Per-Site Delta Rules`, `data-tier="studio" hidden`): `#siteDeltas`.
     - Section 6 (`Cached Site Dictionaries`, `data-tier="studio" hidden`): native `<table>` with `#dictBody`, `#importDictFile[hidden]`, `#importDictBtn`, `#refreshDictBtn`.
     - Dedicated always-visible **Actions** block (`<p>` / `<section>` outside `data-tier="studio"`): `<button id="apply" type="button">` and `<p id="note">` so Basic Mode users can always save settings!
   - Keep `fillForm`, `localStorage` fallback, `userscript:ptr-config`, `userscript:ptr-dicts`, `userscript:ptr-save-dict`, `userscript:ptr-delete-dict`, and 3-language `DICT` intact. Remove all `createCustomSelect` calls and all inline `style=""` attributes.

- [ ] **Step 4: Run full repo verification suite**

Run:

```bash
bun test ./packages
bun run --filter '*' typecheck
bun run check
bun run --filter '*' build
```
Expected:

- `bun test ./packages`: 0 failures across all packages.
- `bun run --filter '*' typecheck`: exit 0 for all 3 packages.
- `bun run check`: 0 errors.
- `bun run --filter '*' build`: exit 0, only `.dist-dev/` updated, `dist/` untouched (`git status --short`).

- [ ] **Step 5: Commit**

```bash
git add settings/shared/bridge.js index.html settings/language/index.html settings/translate/index.html packages/page-translator/tests/v4/ui-tier.test.ts
git commit -m "feat(settings): migrate settings pages to external simple.css and native select controls"
```
