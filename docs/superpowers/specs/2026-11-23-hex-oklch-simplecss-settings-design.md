# Hex-Led 0-Error OkLch Core & Simple.css Settings Migration Design (Project A)

**Date:** 2026-11-23
**Status:** Approved

## 1. Intent & Why

Two problems exist in the current UI layer across `@userscripts/shared` and `settings/`:

1. Color tokens in `packages/shared/src/color.ts`, `theme-mode.ts`, and `ui-tokens.ts` are hand-authored 4-decimal `oklch()` literals, and `settings/shared/tokens.css` duplicates 612 lines of CSS by hand.
2. `settings/` (`index.html`, `settings/language/`, `settings/translate/`) maintains custom form/dropdown CSS and inline spacing overrides instead of letting Simple.css handle semantic layout and form alignment. Additionally, `#apply` and Section 3 (CJK Spacing & Conversion) in `settings/translate/index.html` were hidden inside `data-tier="studio"`.

## 2. Goals, Non-Goals, Anti-Goals

**Goals:**
- Make `#RGB` / `#RRGGBB` hex anchors the single programmatic source of truth in `@userscripts/shared`, converting them to **0-error (`maxChannelError === 0`), `<= 2` decimal** `oklch()` CSS strings (matching `NovaKit/tools/hex-oklch-explorer.html`).
- Anchor the UserScripts UI palette on the user's 3-color brand spine (`#D71`, `#677`, `#334`) plus minimal 0-error `<= 2`-decimal `#RGB` neutral/accessible companions (`#111`, `#222`, `#444`, `#899`, `#CCC`, `#DDD`, `#EEE`, `#FFF`, `#952`, `#C72`).
- Programmatically generate `settings/shared/tokens.css` from `@userscripts/shared` with a sync script and a drift-detection unit test.
- Migrate `index.html`, `settings/language/index.html`, and `settings/translate/index.html` to load `https://cdn.simplecss.org/simple.min.css` directly with **zero overrides of Simple.css layout/component styles** (only CSS custom property theme mapping in `settings/shared/tokens.css`) and native `<select>` elements.
- Keep Typography/Presentation, CJK Spacing & Conversion, and the Apply action always visible on `settings/translate/index.html` (outside `data-tier="studio"`).

**Non-Goals:**
- Redesigning `packages/page-translator` in-page Basic Mode or Industrial Studio Mode (deferred to Project B).
- Breaking `packages/hanime1-download-manager`'s 4-mode `ThemeMode` (`dark | light | system | host`) or existing `--nk-*` / `--us-*` Shadow DOM token consumers.
- Modifying `dist/` release artifacts.

**Anti-Goals:**
- Hand-copying `oklch()` values across files or overriding Simple.css typography, borders, or form geometry in `settings/shared/tokens.css`.
- Introducing runtime network fetches to build color tokens or non-0-error palette anchors.

## 3. Approaches Considered

1. **Selected — Hex-led 0-error OkLch in `@userscripts/shared` + External `simple.min.css` URI + Generated variable-only `settings/shared/tokens.css` + Native `<select>`**
   - Pros: Zero duplication, zero Simple.css overrides, mathematically verified 0-error `<= 2` decimal `oklch()`, native form alignment, works cleanly on GitHub Pages.
   - Trade-offs: Depends on `cdn.simplecss.org` availability (explicitly requested by user).
2. **Rejected — Vendored `simple.min.css` + NovaKit Borderless CSS override layer**
   - Rejected because the user explicitly chose the external Simple.css URI without adjusting Simple.css.
3. **Rejected — Only 3 colors (`#D71`, `#677`, `#334`) with no neutral companions**
   - Rejected because `#677` on `#334` is `2.63:1` (fails readability) and neither dark canvas/light ink nor light canvas exists.

## 4. Palette & Token Mapping (All 0-Error, `<= 2` Decimals)

| Key | Hex | 0-Error `oklch()` (`<= 2` dec) | Role |
|---|---|---|---|
| `accent` | `#D71` | `oklch(67.15% 0.16 56)` | Primary accent (buttons, active highlights, dark code) |
| `accentDeep` | `#952` | `oklch(52.05% 0.11 54)` | Light accent hover & inline code (`5.71:1` on `#FFF`) |
| `accentSoft` | `#C72` | `oklch(64.96% 0.14 60)` | Dark accent hover (`5.60:1` with `#111`) |
| `secondary` | `#677` | `oklch(55.54% 0.02 197)` | Borders, light muted text (`4.70:1` on `#FFF`) |
| `mutedDark` | `#899` | `oklch(66.95% 0.02 197)` | Dark muted text (hue `197`, `6.35:1` on `#111`) |
| `slate` | `#334` | `oklch(32.84% 0.03 285)` | Light main text (`12.37:1` on `#FFF`), dark elevated surface |
| `inkDark` | `#111` | `oklch(17.76% 0 0)` | Dark canvas & text on `#D71` (`6.04:1`) |
| `surfaceDark` | `#222` | `oklch(25.2% 0 0)` | Dark surface / disabled fill |
| `surfaceDark3` | `#444` | `oklch(38.67% 0 0)` | Dark surface-3 hover layer |
| `surfaceLight3` | `#CCC` | `oklch(84.52% 0 0)` | Light surface-3 hover layer |
| `borderLight` | `#DDD` | `oklch(89.75% 0 0)` | Light surface-2 / disabled fill |
| `surfaceLight` | `#EEE` | `oklch(94.91% 0 0)` | Light `--accent-bg` surface & dark main text (`16.28:1` on `#111`) |
| `canvasLight` | `#FFF` | `oklch(100% 0 0)` | Light canvas background |

### Simple.css Variable Mapping (`settings/shared/tokens.css`, generated)

- **Light (`:root` and `:root[data-theme-mode="light"]`)**:
  - `--bg: canvasLight`, `--accent-bg: surfaceLight`, `--text: slate`, `--text-light: secondary`, `--border: secondary`, `--accent: accent`, `--accent-hover: accentDeep`, `--accent-text: inkDark`, `--code: accentDeep`, `--preformatted: slate`, `--marked: accent`, `--disabled: borderLight`, `color-scheme: light` (or `light dark` on `:root`).
- **Dark (`@media (prefers-color-scheme: dark)` for `:root:not([data-theme-mode="light"])` and `:root[data-theme-mode="dark"]`)**:
  - `--bg: inkDark`, `--accent-bg: slate`, `--text: surfaceLight`, `--text-light: mutedDark`, `--border: secondary`, `--accent: accent`, `--accent-hover: accentSoft`, `--accent-text: inkDark`, `--code: accent`, `--preformatted: surfaceLight`, `--marked: accent`, `--disabled: surfaceDark`, `color-scheme: dark`.

### Userscript Shadow DOM Tokens (`@userscripts/shared`)

- `resolveThemeTokens("light")` / `resolveThemeTokens("dark")` resolve programmatically from `US_PALETTE_OKLCH`.
- `getUiTokensCss(scopeSelector, hostTokens)` continues to provide Borderless Shadow DOM tokens (`--us-*`, `--nk-*`, `12/8/6px` radii, no `1px` borders, no `scale()`) for `ptr` and `h1dl`.

## 5. Constraints

- UTF-8 without BOM, LF line endings, ISC license preserved.
- `dist/` must remain untouched; local builds only output to `.dist-dev/`.
- `bun test ./packages`, `bun run --filter '*' typecheck`, `bun run check`, and `bun run --filter '*' build` must all pass with 0 errors.
