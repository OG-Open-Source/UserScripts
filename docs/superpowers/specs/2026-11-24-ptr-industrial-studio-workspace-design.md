# Page Translator v5 UI Redesign: Minimalist Basic Mode & Industrial Studio Workspace (Project B)

**Date:** 2026-11-24
**Status:** Approved

## 1. Intent & Why

Two usability gaps remain in `packages/page-translator` after v4:

1. Basic Mode still exposes Target Language, Presentation CSS preset, and Font inputs directly on the floating panel, duplicating controls that now live cleanly on `settings/translate/index.html`.
2. Studio Mode consists of two disconnected floating cards (Inspect HUD and Volunteer Workbench), and `exportCaptureCandidates()` is not wired to any UI control. Auditing every captured and excluded raw DOM node on a site, testing `+/-/*` capture rules live, and editing per-site dictionaries require an integrated industrial workspace.

## 2. Goals, Non-Goals, Anti-Goals

**Goals:**

- Simplify **Basic Mode** (`#ptr-basic-ui`) into a compact bottom-right pill: one-click Translate/Restore toggle, Open Settings button, and Enter Studio button. Automatically hide `#ptr-basic-ui` while Studio Workspace is mounted.
- Build an **Industrial Studio Workspace** (`#ptr-studio-shell`, mounted as a sibling of `document.body` on `document.documentElement` with `data-us-ui="ptr"` and `translate="no"`):
  - Scales the live host `document.body` into a framed **top-center viewport stage** (`position: fixed` + `transform: scale(...)` + `overflow: auto` via `#ptr-studio-stage-css` and `html[data-ptr-studio-active="1"]`), trapping host `position: fixed` headers inside the scaled stage without scaling Studio panels.
  - Renders a live **bounding-box overlay** clipped to the stage over all visible captured/excluded text nodes (`all | included | excluded | off` modes) with industrial orange (`#D71`) active/hover highlighting and node tag labels.
  - **Top Toolbar (`40px`)**: adapter badge, node summary counts, Translate/Restore, Rescan, Select/Interact click-lock toggle, Box Overlay filter, Zoom selector (`Fit | 50% | 75% | 100%`), Download Raw Nodes JSON (`{host}-nodes.json`), Settings, Exit Studio.
  - **Left Dock (`300px`)**: Raw Nodes & Capture Explorer listing every `LiveCaptureCandidate` with search input, `All | Captured | Excluded | Manual` filter tabs, status/excludeReason pills, `domPath`, and click-to-select + scroll-into-view.
  - **Right Dock (`340px`)**: Dual-tab Inspector:
    - `Node & Rules`: full metadata (`domPath`, `region`, `classification`, `included`, `excludeReason`, `computedStyleSummary`, `textPreview`), editable suggested CSS selector, one-click `+ Include` / `- Exclude` / `* Modifier` buttons, and live `siteDeltas[host]` textarea with Apply & Rescan.
    - `Site Dict`: reuses `src/ui/studio/volunteer/logic.ts` for segment navigation, scope suggestion, draft translation editing & preview, AI Export/Import with inline conflict resolution, Copy Dict JSON, and Download `{host}.json`.
  - **Bottom Dock (`190px`, collapsible)**:
    - `Diagnostics & Export`: adapter/metrics tables, Copy Diagnostics JSON, Copy Raw Nodes JSON, Download Raw Nodes JSON.
    - `Record & Log`: Record toggle capturing live DOM mutations / rescans / rule edits with timestamps and node deltas, Clear button, and a `Pause before API` pipeline breakpoint toggle + Step/Resume action.
- Expose `collectLiveCaptureCandidates(doc, opts)` in `src/capture/export.ts` (preserving plain JSON-serializable `exportCaptureCandidates`) and `serializeSiteDelta` / `appendSiteDeltaRule` / `removeSiteDeltaRule` / `suggestSelectorForElement` in `src/structure/site-rules.ts`.
- Keep all UI strings localized across `en-US`, `zh-Hant-TW`, and `zh-Hans-CN` with 100% key parity.

**Non-Goals:**

- Replacing the translation pipeline, adapters, or storage keys (`ptr:config`, `ptr:site-tr-*`, `ptr:tab-active`).
- Modifying `packages/hanime1-download-manager`, `settings/`, or `dist/`.

**Anti-Goals:**

- Putting `#ptr-studio-shell` inside `document.body` (would distort Studio panels when `body` is scaled).
- Leaving dead floating `inspect/view.ts` or `volunteer/view.ts` files behind after migration.
- Mutating `CaptureCandidate` with non-serializable DOM references.

## 3. Architecture & Key Decisions

1. **Stage scaling via `html[data-ptr-studio-active="1"] > body` (`stage.ts`)**: Transforming `body` while mounting `#ptr-studio-shell` on `document.documentElement` avoids iframe CORS/state loss, traps host `position: fixed` chrome inside the scaled canvas, preserves native scrolling inside the stage, and makes `Element.getBoundingClientRect()` return exact post-scale coordinates for the Shadow DOM bounding-box overlay.
2. **Side-channel live candidate binding (`collectLiveCaptureCandidates`)**: Returns `{ candidate, element, index }[]` so `exportCaptureCandidates()` remains a 1-line projection of plain JSON objects (`export.test.ts` unchanged).
3. **Domain logic reuse**: `src/ui/studio/inspect/logic.ts` and `src/ui/studio/volunteer/logic.ts` remain pure domain modules consumed by `src/ui/studio/workspace/`. Old floating panel views (`inspect/{view,index}.ts`, `volunteer/{view,index}.ts`) are removed.
4. **Visual system**: Uses `@userscripts/shared` hex-led 0-error OkLch tokens (`#111 / #222 / #334 / #D71 / #677 / #899 / #EEE`) via `getSharedPanelCss()`, Borderless NovaKit geometry (`12/8/6px` radii, zero `1px` box borders, zero `scale()` on buttons).

## 4. Constraints

- UTF-8 without BOM, LF line endings (`\n`), ISC license, `dist/` untouched.
- Every UI root carries `data-us-ui="ptr"` and `translate="no"`.
- Zero hardcoded English UI strings in `src/ui/basic/view.ts` and `src/ui/studio/workspace/view.ts`; exact key parity across `MESSAGES_EN` and `locales.json` (`zh-Hant-TW`, `zh-Hans-CN`).
- `bun test ./packages`, `bun run --filter '*' typecheck`, `bun run check`, and `bun run --filter '*' build` must all pass with 0 errors.
