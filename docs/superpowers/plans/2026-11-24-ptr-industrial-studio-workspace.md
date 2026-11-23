# Page Translator Minimalist Basic Mode & Industrial Studio Workspace Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify `ptr` Basic Mode to a minimalist translate toggle pill and replace the floating Studio HUD/Volunteer cards with an Industrial Studio Workspace featuring a scaled top-center live webpage stage, live text-node bounding boxes, Left Raw Nodes Explorer, Right `+/-/*` Rules & Site Dict Inspector, and collapsible Bottom Diagnostics/Record/Breakpoint Dock.

**Architecture:** `src/capture/export.ts` adds `collectLiveCaptureCandidates` alongside `exportCaptureCandidates`, and `src/structure/site-rules.ts` adds rule serialization/mutation/selector suggestion helpers. `src/ui/basic/` shrinks to a compact pill, while `src/ui/studio/workspace/` (`stage.ts`, `overlay.ts`, `logic.ts`, `view.ts`, `index.ts`) orchestrates the scaled `body` stage, Shadow DOM shell on `document.documentElement`, live bounding-box projection, raw-node auditing/export, live `+/-/*` rule editing, site dictionary editing (reusing `inspect/logic.ts` and `volunteer/logic.ts`), mutation recording, and API breakpoint gating.

**Tech Stack:** TypeScript, Bun (`bun test`, `happy-dom`), Biome/Ultracite (`bun run check`), Vite (`vite-plugin-monkey`), `@userscripts/shared` hex-led 0-error OkLch tokens.

**Spec:** `docs/superpowers/specs/2026-11-24-ptr-industrial-studio-workspace-design.md`

## Global Constraints

- UTF-8 without BOM, LF line endings (`\n`), no edits to `dist/`.
- Preserve `ptr` userscript identity, storage keys (`ptr:config`, `ptr:site-tr-*`, `ptr:tab-active`), and `exportCaptureCandidates()` plain JSON serializability (`JSON.parse(JSON.stringify(x))`).
- Mount `#ptr-studio-shell` on `document.documentElement` (sibling of `document.body`) with `markUiRoot(host, "ptr")` (`data-us-ui="ptr"`, `translate="no"`), never inside `document.body`.
- Use Borderless NovaKit CSS from `getSharedPanelCss()` (hex-led 0-error OkLch tokens, `12/8/6px` radii, no `border: 1px`, no `transform: scale()` on buttons/controls; `transform: scale(...)` is allowed ONLY on `html[data-ptr-studio-active="1"] > body` in `stage.ts`).
- Every visible UI label in `basic/view.ts` and `studio/workspace/view.ts` must come from `t(...)` with 100% key parity across `MESSAGES_EN` (`src/platform/i18n.ts`) and `locales.json` (`zh-Hant-TW`, `zh-Hans-CN`).
- Verify with `bun test ./packages`, `bun run --filter '*' typecheck`, `bun run check`, and `bun run --filter '*' build`.

## Review Focus

- Exiting Studio Mode (`stop()` or switching `uiTier` back to `"basic"`) must cleanly remove `data-ptr-studio-active`, `#ptr-studio-stage-css`, `#ptr-studio-shell`, document click/scroll/resize listeners, and MutationObserver so the host page returns to its exact original layout.
- Clicking inside `#ptr-studio-shell` while Select Mode (click-lock) is active must NOT be swallowed by the capture-phase click guard (`isUsUiEvent(e, shellHost)` must pass through).
- Appending/removing `+/-/*` rules for the current host must preserve comments and unrelated host entries in `cfg.siteDeltas` and survive invalid CSS selectors without throwing.
- Bounding-box overlay projection must skip zero-area or off-stage elements (`rect.width <= 0 || rect.height <= 0` or outside the stage rectangle) and clamp boxes cleanly to the center-top stage bounds.
- Enabling the `Pause before API` breakpoint in Studio Mode must pause API batch dispatch cleanly without hanging `cancelAll()` or leaking unresolved promises when Studio exits or translation stops.

---

### Task 1: Live Capture Candidate Binding & Site-Rule Editing Helpers

**Files:**

- Modify: `packages/page-translator/src/capture/export.ts`
- Modify: `packages/page-translator/src/structure/site-rules.ts`
- Test: `packages/page-translator/tests/v4/export.test.ts`
- Test: `packages/page-translator/tests/v4/site-rules.test.ts`

**Interfaces:**

- Consumes: existing `exportCaptureCandidates`, `evaluateCaptureCandidate`, `parseSiteDelta`, `SiteModifier`, `CompiledSiteDelta`
- Produces:
  - In `packages/page-translator/src/capture/export.ts`:
    - `export interface LiveCaptureCandidate { candidate: CaptureCandidate; element: Element; index: number; }`
    - `export function collectLiveCaptureCandidates(doc: Document, opts?: ExportCaptureOptions): LiveCaptureCandidate[]`
  - In `packages/page-translator/src/structure/site-rules.ts`:
    - `export function serializeSiteDelta(delta: CompiledSiteDelta): string`
    - `export function appendSiteDeltaRule(source: string, ruleLine: string): string`
    - `export function removeSiteDeltaRule(source: string, ruleLine: string): string`
    - `export function suggestSelectorForElement(el: Element): string`

- [ ] **Step 1: Write failing tests in `packages/page-translator/tests/v4/export.test.ts` and `packages/page-translator/tests/v4/site-rules.test.ts`**

In `export.test.ts`:

- Test `collectLiveCaptureCandidates(doc)` returns `{ candidate, element, index }` entries where `entry.element` is the live DOM `Element` matching `entry.candidate.domPath`, `entry.index` is sequential `0..n-1`, and `exportCaptureCandidates(doc)` equals `live.map((e) => e.candidate)` (still plain JSON-serializable).

In `site-rules.test.ts`:

- Test `serializeSiteDelta(parseSiteDelta("+ .a\n- .b\n* .c : inline-atomic, no-spacing"))` outputs canonical lines `+ .a\n- .b\n* .c : inline-atomic, no-spacing`.
- Test `appendSiteDeltaRule` preserves existing comments/rules, trims whitespace, and deduplicates exact lines.
- Test `removeSiteDeltaRule` removes matching rule lines while preserving comments and other rules.
- Test `suggestSelectorForElement` prefers stable `#id`, `[aria-label]`, or `tag.class` over noisy utility/hash classes and always produces a selector that `safeMatches(el, sel)` matches.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/page-translator/tests/v4/export.test.ts packages/page-translator/tests/v4/site-rules.test.ts`
Expected: FAIL (missing exports).

- [ ] **Step 3: Implement `collectLiveCaptureCandidates` in `export.ts` and rule/selector helpers in `site-rules.ts`**

- Refactor `exportCaptureCandidates` to delegate to `collectLiveCaptureCandidates(doc, opts).map((entry) => entry.candidate)`.
- In `site-rules.ts`:
  - `serializeSiteDelta(delta)`: emit `+ ${s}`, `- ${s}`, `* ${r.selector} : ${r.modifiers.join(", ")}` joined by `\n`.
  - `appendSiteDeltaRule(source, ruleLine)`: normalize line endings, trim rule, avoid exact trimmed duplicate, preserve comments.
  - `removeSiteDeltaRule(source, ruleLine)`: drop exact trimmed matches, preserve comments and other lines.
  - `suggestSelectorForElement(el)`: prefer `#id` (when non-empty and not purely numeric/hash-like), then `tag[aria-label="..."]`, then `tag.class` (filtering CSS-module/random hash classes and `data-tr-*`), falling back to tag + `:nth-of-type(...)` path. Always escape via `CSS.escape` fallback so selector is valid CSS.

- [ ] **Step 4: Run tests and lint check**

Run: `bun test packages/page-translator/tests/v4/export.test.ts packages/page-translator/tests/v4/site-rules.test.ts && bunx ultracite check packages/page-translator/src/capture/export.ts packages/page-translator/src/structure/site-rules.ts packages/page-translator/tests/v4/export.test.ts packages/page-translator/tests/v4/site-rules.test.ts`
Expected: PASS (0 failures, 0 lint errors).

- [ ] **Step 5: Commit**

```bash
git add packages/page-translator/src/capture/export.ts packages/page-translator/src/structure/site-rules.ts packages/page-translator/tests/v4/export.test.ts packages/page-translator/tests/v4/site-rules.test.ts
git commit -m "feat(ptr): add live capture candidate binding and site-rule editing helpers"
```

---

### Task 2: Minimalist Basic Mode & Studio Workspace i18n Keys

**Files:**

- Modify: `packages/page-translator/src/platform/i18n.ts`
- Modify: `packages/page-translator/locales.json`
- Modify: `packages/page-translator/src/ui/basic/logic.ts`
- Modify: `packages/page-translator/src/ui/basic/view.ts`
- Modify: `packages/page-translator/src/ui/basic/index.ts`
- Create: `packages/page-translator/tests/v4/basic-ui.test.ts`

**Interfaces:**

- Consumes: `PtrThemeMode`, `TranslatorConfig`, `UiTier` from `src/platform/config.ts`; `applyPtrTheme`, `getSharedPanelCss` from `src/ui/theme.ts`; `markUiRoot` from `@userscripts/shared`
- Produces:
  - Updated `MESSAGES_EN` + `locales.json` (`zh-Hant-TW`, `zh-Hans-CN`) with exact key parity, adding Studio Workspace keys (`studioTitle`, `studioExit`, `studioZoomFit`, `studioModeSelect`, `studioModeInteract`, `studioBoxesAll`, `studioBoxesIncluded`, `studioBoxesExcluded`, `studioBoxesOff`, `studioExportNodes`, `studioCopyNodes`, `studioTabAll`, `studioTabCaptured`, `studioTabExcluded`, `studioTabManual`, `studioSearchPlaceholder`, `studioNoNodes`, `studioInspectorNode`, `studioInspectorDict`, `studioSelectPrompt`, `studioRuleSelector`, `studioRuleAdd`, `studioRuleRemove`, `studioRuleMod`, `studioRuleApply`, `studioRuleApplied`, `studioSiteDeltas`, `studioBottomDiag`, `studioBottomRecord`, `studioCollapse`, `studioExpand`, `studioRecordStart`, `studioRecordStop`, `studioRecordClear`, `studioRecordEmpty`, `studioBpPauseApi`, `studioBpResume`, `studioBpWaiting`, `studioCopiedNodes`, `studioDownloadedNodes`, `basicOpenSettings`).
  - Minimalist `BasicUiState = { themeMode: PtrThemeMode; translated: boolean; uiTier: UiTier; }`, `toggleUiTier`, `diffStudioTier`, `computeBasicUiState` in `src/ui/basic/logic.ts`.
  - Minimalist `BasicView` / `BasicController` (`createBasicController`) rendering ONLY `#ptr-basic-ui` bottom-right pill with `[data-basic-action="translate"]`, `[data-basic-action="settings"]`, and `#ptr-basic-studio` — hidden (`hidden = true`) while `uiTier === "studio"` so Studio Shell takes over cleanly.

- [ ] **Step 1: Write failing tests in `packages/page-translator/tests/v4/basic-ui.test.ts`**

Test:

1. `createBasicController` mounts `#ptr-basic-ui` with `data-us-ui="ptr"` and `translate="no"`, containing ONLY 3 action buttons (`[data-basic-action="translate"]`, `[data-basic-action="settings"]`, `#ptr-basic-studio`) and NO targetLang/presentation/font inputs (`[data-basic-field]` count is 0).
2. Clicking translate calls `onToggleTranslate`; clicking settings calls `onOpenSettings`; clicking `#ptr-basic-studio` toggles `uiTier` (`basic` -> `studio`), fires `onStudioMount`, and hides `#ptr-basic-ui` (`host.hidden === true`); switching back to `basic` fires `onStudioUnmount` and unhides `#ptr-basic-ui`.
3. `MESSAGES_EN` and `locales.json` (`zh-Hant-TW`, `zh-Hans-CN`) have exact sorted key parity and non-empty values for all keys including the new Studio Workspace keys.
4. `src/ui/basic/view.ts` contains no hardcoded English button labels when a `t()` translator is supplied.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/page-translator/tests/v4/basic-ui.test.ts`
Expected: FAIL (old Basic UI still renders `[data-basic-field]` inputs and lacks new i18n keys).

- [ ] **Step 3: Add Studio Workspace i18n keys to `i18n.ts` + `locales.json`, and simplify `src/ui/basic/{logic,view,index}.ts`**

- Keep `BasicControllerOptions` clean (`doc`, `getConfig`, `isTranslated`, `onOpenSettings`, `onStudioMount`, `onStudioUnmount`, `onToggleTranslate`, `setUiTier`, `t`).
- Keep `src/ui/basic/view.ts` compact, Borderless NovaKit pill using `getSharedPanelCss()`, with `host.hidden = state.uiTier === "studio"`.
- Ensure all new keys in `MESSAGES_EN` have accurate Traditional Chinese (`zh-Hant-TW`) and Simplified Chinese (`zh-Hans-CN`) translations in `locales.json`.

- [ ] **Step 4: Run tests and lint check**

Run: `bun test packages/page-translator/tests/v4/basic-ui.test.ts packages/page-translator/tests/v4/i18n-ui.test.ts && bunx ultracite check packages/page-translator/src/platform/i18n.ts packages/page-translator/locales.json packages/page-translator/src/ui/basic packages/page-translator/tests/v4/basic-ui.test.ts`
Expected: PASS (0 failures, 0 lint errors). Note: `tests/v4/ui-tier.test.ts` and `src/main.ts` will be updated in Task 5 once Studio Workspace is ready; keep `BasicControllerOptions` backward-compatible with optional unused fields (`onToggleInspect?`, `onToggleVolunteer?`, `setTargetLang?`, `setCustomCss?`, `setCustomFont?`) during Tasks 2–4 so `typecheck` stays green at every commit!

- [ ] **Step 5: Commit**

```bash
git add packages/page-translator/src/platform/i18n.ts packages/page-translator/locales.json packages/page-translator/src/ui/basic packages/page-translator/tests/v4/basic-ui.test.ts
git commit -m "feat(ptr): simplify Basic Mode to minimalist toggle pill and add Studio Workspace i18n keys"
```

---

### Task 3: Industrial Studio Stage, Bounding-Box Overlay & Pure Workspace Logic

**Files:**

- Create: `packages/page-translator/src/ui/studio/workspace/stage.ts`
- Create: `packages/page-translator/src/ui/studio/workspace/overlay.ts`
- Create: `packages/page-translator/src/ui/studio/workspace/logic.ts`
- Create: `packages/page-translator/tests/v4/studio-workspace-logic.test.ts`

**Interfaces:**

- Consumes: `LiveCaptureCandidate`, `CaptureCandidate` from `src/capture/export.ts`; `CapturedVolunteerEntry` from `src/ui/studio/volunteer/logic.ts`; `US_PALETTE_OKLCH` from `@userscripts/shared`
- Produces:
  - `stage.ts`:
    - `export type StudioZoomPreset = "fit" | "50" | "75" | "100";`
    - `export interface StudioStageGeometry { bottomHeight: number; leftWidth: number; rightWidth: number; scale: number; stageHeight: number; stageLeft: number; stageTop: number; stageWidth: number; topHeight: number; }`
    - `export function computeStudioStageGeometry(viewportWidth: number, viewportHeight: number, options?: { bottomCollapsed?: boolean; zoom?: StudioZoomPreset }): StudioStageGeometry`
    - `export function buildStudioStageCss(geom: StudioStageGeometry): string`
    - `export interface StudioStageHandle { getGeometry: () => StudioStageGeometry; unmount: () => void; update: (options?: { bottomCollapsed?: boolean; zoom?: StudioZoomPreset }) => StudioStageGeometry; }`
    - `export function mountStudioStage(doc: Document, options?: { bottomCollapsed?: boolean; zoom?: StudioZoomPreset }): StudioStageHandle`
  - `overlay.ts`:
    - `export type StudioBoxMode = "all" | "included" | "excluded" | "off";`
    - `export interface ProjectedBox { classification: string; excludeReason: string | null; height: number; included: boolean; index: number; label: string; left: number; region: string; selected: boolean; hovered: boolean; top: number; width: number; }`
    - `export function projectCandidateBoxes(entries: readonly LiveCaptureCandidate[], stage: StudioStageGeometry, options: { boxMode: StudioBoxMode; hoveredIndex: number | null; maxBoxes?: number; selectedIndex: number | null }): ProjectedBox[]`
    - `export function renderOverlayBoxes(layer: HTMLElement, doc: Document, boxes: readonly ProjectedBox[]): void`
  - `logic.ts`:
    - `export type StudioNodeFilterTab = "all" | "captured" | "excluded" | "manual";`
    - `export interface StudioActivityEntry { id: number; kind: "scan" | "mutation" | "rule" | "dict" | "breakpoint"; summary: string; timestamp: string; }`
    - `export interface StudioRecordState { entries: StudioActivityEntry[]; nextId: number; recording: boolean; }`
    - `export function filterStudioCandidates(entries: readonly LiveCaptureCandidate[], options: { manualElements?: ReadonlySet<Element>; query: string; tab: StudioNodeFilterTab }): LiveCaptureCandidate[]`
    - `export function findCandidateIndexForElement(entries: readonly LiveCaptureCandidate[], target: Element | null): number | null`
    - `export function buildRawNodesExportJson(params: { adapterId: string; candidates: readonly CaptureCandidate[]; host: string; url: string }): string`
    - `export function createStudioBreakpointGate(): { isPaused: () => boolean; isWaiting: () => boolean; onStateChange: (cb: () => void) => () => void; releaseAll: () => void; setPaused: (paused: boolean) => void; step: () => void; waitIfPaused: () => Promise<void>; }`

- [ ] **Step 1: Write failing tests in `packages/page-translator/tests/v4/studio-workspace-logic.test.ts`**

Test:

1. `computeStudioStageGeometry(1440, 900, { zoom: "fit" })` computes exact top-center stage rect (`stageLeft: 300`, `stageTop: 40`, `stageWidth: 800`, `stageHeight: 670`, `scale` clamped in `[0.35, 0.92]`), collapses bottom dock (`bottomHeight: 36`) when `bottomCollapsed: true`, and honors explicit `50` / `75` / `100` zoom presets.
2. `mountStudioStage(doc)` sets `html[data-ptr-studio-active="1"]`, injects `#ptr-studio-stage-css` containing `html[data-ptr-studio-active="1"] > body` and `transform: scale(`, and `unmount()` removes both cleanly.
3. `projectCandidateBoxes` filters by `boxMode` (`all`, `included`, `excluded`, `off`), skips zero-size or out-of-stage rects, clamps overlapping rects to the stage bounds, and marks `selected` / `hovered` accurately.
4. `filterStudioCandidates` filters by `all` / `captured` / `excluded` / `manual` and case-insensitive substring query across `textPreview`, `domPath`, `region`, and `excludeReason`.
5. `findCandidateIndexForElement` walks up ancestors to match the nearest `LiveCaptureCandidate`.
6. `buildRawNodesExportJson` emits valid JSON with `{ host, url, adapterId, count, candidates }`.
7. `createStudioBreakpointGate` resolves immediately when unpaused, blocks `waitIfPaused()` when paused until `step()` or `setPaused(false)` is called, and resolves cleanly on `releaseAll()` without hanging.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/page-translator/tests/v4/studio-workspace-logic.test.ts`
Expected: FAIL (modules do not exist yet).

- [ ] **Step 3: Implement `stage.ts`, `overlay.ts`, and `logic.ts`**

- Keep every function small, pure, and strongly typed with zero Biome/Ultracite issues.
- In `stage.ts`, use `US_PALETTE_OKLCH.inkDark` (`#111`) for the industrial studio surround backdrop.
- In `overlay.ts`, cap rendered boxes at `maxBoxes = 300` (always prioritizing `selectedIndex` and `hoveredIndex`) to stay silky smooth on huge DOMs.

- [ ] **Step 4: Run tests and lint check**

Run: `bun test packages/page-translator/tests/v4/studio-workspace-logic.test.ts && bun run --filter '@userscripts/page-translator' typecheck && bunx ultracite check packages/page-translator/src/ui/studio/workspace packages/page-translator/tests/v4/studio-workspace-logic.test.ts`
Expected: PASS (0 failures, 0 typecheck/lint errors).

- [ ] **Step 5: Commit**

```bash
git add packages/page-translator/src/ui/studio/workspace/stage.ts packages/page-translator/src/ui/studio/workspace/overlay.ts packages/page-translator/src/ui/studio/workspace/logic.ts packages/page-translator/tests/v4/studio-workspace-logic.test.ts
git commit -m "feat(ptr): add Industrial Studio stage, bounding-box overlay, and pure workspace logic"
```

---

### Task 4: Industrial Studio Workspace View & Controller

**Files:**

- Create: `packages/page-translator/src/ui/studio/workspace/view.ts`
- Create: `packages/page-translator/src/ui/studio/workspace/index.ts`
- Create: `packages/page-translator/tests/v4/studio-workspace.test.ts`

**Interfaces:**

- Consumes: `stage.ts`, `overlay.ts`, `logic.ts`, `collectLiveCaptureCandidates`, `appendSiteDeltaRule`, `removeSiteDeltaRule`, `suggestSelectorForElement`, `scanInspectSegments`, `buildInspectDiagnostics`, `scanVolunteerEntries`, `suggestEntryScope`, `resolveInitialEntryValue`, `buildDraftPatch`, `diffImportConflicts`, `buildConflictResolutionPatch`, `buildVolunteerExportJson`, `buildAiTranslationExport`, `parseAiTranslationImport`, `applyPtrTheme`, `getSharedPanelCss`, `markUiRoot`, `isUsUiEvent`
- Produces:
  - `export interface StudioWorkspaceControllerOptions { breakpointGate?: ReturnType<typeof createStudioBreakpointGate>; doc: Document; getAdapter: () => SiteStructureAdapter; getConfig: () => TranslatorConfig; getDelta: () => CompiledSiteDelta; getHostRawDelta: () => string; getLocalLocaleTable: () => SiteLocaleTable | null; getMetrics: () => PtrMetrics; getSiteLocaleTable: () => SiteLocaleTable | null; getTargetLang: () => string; hostname: string; isTranslated: () => boolean; onExitStudio: () => void; onOpenSettings: () => void; onSaveHostDelta: (rawDelta: string) => void; onSiteDictUpdated?: () => void; onSyncLocalTable: (patch: SiteLocaleTable) => void; onToggleTranslate: () => void; t?: (key: string) => string; }`
  - `export interface StudioWorkspaceController { getDiagnostics: () => string; getRawNodesJson: () => string; isActive: () => boolean; rescan: () => void; stop: () => void; syncFromConfig: () => void; }`
  - `export function createStudioWorkspaceController(options: StudioWorkspaceControllerOptions): StudioWorkspaceController`

- [ ] **Step 1: Write failing tests in `packages/page-translator/tests/v4/studio-workspace.test.ts`**

Test:

1. Mounting when `cfg.uiTier === "studio"` attaches `#ptr-studio-shell` directly to `doc.documentElement` (NOT `doc.body`) with `data-us-ui="ptr"`, `translate="no"`, activates `html[data-ptr-studio-active="1"]` + `#ptr-studio-stage-css`, and renders Top Toolbar, Left Raw Nodes Explorer, Right Inspector (`Node & Rules` + `Site Dict`), Bottom Dock (`Diagnostics & Export` + `Record & Log`), and Bounding-Box Overlay layer.
2. Left Explorer lists both captured and excluded raw nodes (`exportCaptureCandidates`), filters cleanly by tab (`All`, `Captured`, `Excluded`, `Manual`) and search input, and clicking a node populates the Right Inspector with its `domPath`, `region`, `classification`, `excludeReason`, `computedStyleSummary`, and suggested CSS selector.
3. Clicking `+ Include`, `- Exclude`, or `* Modifier` + `Apply` in the Right Inspector updates the host delta textarea, invokes `onSaveHostDelta(rawDelta)`, rescans live, and updates node inclusion status.
4. Clicking `Download Raw Nodes` invokes download/export cleanly and `getRawNodesJson()` returns valid JSON with `{ host, url, adapterId, count, candidates }`.
5. `Site Dict` tab navigates translatable segments, suggests scoped selectors, saves drafts via `onSyncLocalTable`, exports AI bundle, and renders inline conflict resolution cards on AI JSON import conflicts.
6. Select Mode (click-lock) blocks host `<a href>` clicks while allowing clicks inside `#ptr-studio-shell` (`isUsUiEvent`), and clicking a host text element selects its matching candidate in the workspace.
7. Bottom Dock `Record` toggle logs DOM mutations / rule edits and clears cleanly; `Pause before API` toggles `breakpointGate` and `Resume` / `Step` releases waiting batches.
8. `stop()` or transitioning `cfg.uiTier` back to `"basic"` removes `#ptr-studio-shell`, `#ptr-studio-stage-css`, `data-ptr-studio-active`, and all event listeners/observers cleanly.
9. Localization: injecting `t()` from `zh-Hant-TW` localizes visible labels across toolbar/docks with zero untranslated English labels leaking in `studio/workspace/view.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/page-translator/tests/v4/studio-workspace.test.ts`
Expected: FAIL (missing `view.ts` and `index.ts`).

- [ ] **Step 3: Implement `packages/page-translator/src/ui/studio/workspace/view.ts` and `index.ts`**

- Keep `view.ts` modular and readable (split CSS template string cleanly, avoid `innerHTML` with untrusted host text — always use `textContent` / DOM creation, zero `border: 1px`, zero `transform: scale()` inside Shadow DOM, Borderless NovaKit surfaces using `--us-bg`, `--us-surface`, `--us-surface-2`, `--us-surface-3`, `--us-accent-bg` `#D71`, `--us-fg`, `--us-muted`).
- Ensure `stop()` / `unmount()` always disconnects `MutationObserver`, removes `window`/`doc`/`body` listeners, unmounts `stage`, releases `breakpointGate`, and removes `#ptr-studio-shell`.

- [ ] **Step 4: Run tests and lint check**

Run: `bun test packages/page-translator/tests/v4/studio-workspace.test.ts && bun run --filter '@userscripts/page-translator' typecheck && bunx ultracite check packages/page-translator/src/ui/studio/workspace packages/page-translator/tests/v4/studio-workspace.test.ts`
Expected: PASS (0 failures, 0 typecheck/lint errors).

- [ ] **Step 5: Commit**

```bash
git add packages/page-translator/src/ui/studio/workspace/view.ts packages/page-translator/src/ui/studio/workspace/index.ts packages/page-translator/tests/v4/studio-workspace.test.ts
git commit -m "feat(ptr): implement Industrial Studio Workspace view and controller"
```

---

### Task 5: Wire `main.ts`, Pipeline Breakpoint Hook, Remove Obsolete Floating Studio Panels & Update Suite

**Files:**

- Modify: `packages/page-translator/src/core/runner.ts`
- Modify: `packages/page-translator/src/main.ts`
- Modify: `packages/page-translator/src/ui/basic/index.ts` (drop temporary legacy optional props if unused)
- Delete: `packages/page-translator/src/ui/studio/inspect/index.ts`
- Delete: `packages/page-translator/src/ui/studio/inspect/view.ts`
- Delete: `packages/page-translator/src/ui/studio/volunteer/index.ts`
- Delete: `packages/page-translator/src/ui/studio/volunteer/view.ts`
- Modify: `packages/page-translator/tests/v4/ui-tier.test.ts`
- Modify: `packages/page-translator/tests/v4/inspect-hud.test.ts`
- Modify: `packages/page-translator/tests/v4/volunteer.test.ts`
- Modify: `packages/page-translator/tests/v4/i18n-ui.test.ts`
- Modify: `packages/page-translator/tests/v4/runner.test.ts`

**Interfaces:**

- Consumes: `createBasicController`, `createStudioWorkspaceController`, `createStudioBreakpointGate`
- Produces:
  - Optional `beforeApiDispatch?: () => Promise<void>` hook on `BatchRunnerOptions` in `packages/page-translator/src/core/runner.ts` (awaited before `translateUniquePayloads`, re-checking `gen === generation` after wake so `cancelAll()` cleanly aborts paused batches).
  - Updated `packages/page-translator/src/main.ts` mounting minimalist `createBasicController` + `createStudioWorkspaceController`, saving per-host `siteDeltas` live, syncing on SPA settle / config update, and keeping GM menu commands (`Translate Page`, `Restore Page`, `Studio Mode`, `Open Settings`).

- [ ] **Step 1: Write failing tests in `packages/page-translator/tests/v4/runner.test.ts` and update `ui-tier.test.ts`, `inspect-hud.test.ts`, `volunteer.test.ts`, `i18n-ui.test.ts`**

- In `runner.test.ts`: test `beforeApiDispatch` pauses API batch dispatch until resolved, and if `cancelAll()` is called while paused, no provider call is made after resolution.
- Update `ui-tier.test.ts`, `inspect-hud.test.ts`, `volunteer.test.ts`, and `i18n-ui.test.ts` so they test the new minimalist Basic UI, the Industrial Studio Workspace (`#ptr-studio-shell`), pure `inspect/logic.ts` + `volunteer/logic.ts`, and `studio/workspace/view.ts` localization (no hardcoded English strings) instead of the deleted floating `#ptr-inspect-hud` / `#ptr-volunteer-workbench` panels.

- [ ] **Step 2: Run targeted tests to verify RED**

Run: `bun test packages/page-translator/tests/v4/runner.test.ts packages/page-translator/tests/v4/ui-tier.test.ts`
Expected: FAIL (`beforeApiDispatch` not yet implemented; `main.ts` / tests referencing new Studio Workspace integration).

- [ ] **Step 3: Wire `runner.ts`, `main.ts`, clean up `basic/index.ts`, and delete obsolete floating views**

- In `packages/page-translator/src/core/runner.ts`: add optional `beforeApiDispatch?: () => Promise<void>` to `BatchRunnerOptions`; invoke before `translateUniquePayloads` in `runFlushEntries`, returning early if `gen !== generation` after awaiting.
- In `packages/page-translator/src/main.ts`:
  - Replace `createInspectController` + `createVolunteerController` with `createStudioBreakpointGate` + `createStudioWorkspaceController`.
  - Wire `onSaveHostDelta` to update `saveConfig({ siteDeltas: { ...cfg.siteDeltas, [host]: rawDelta } })` (deleting the key when `rawDelta.trim() === ""`) and re-run translation if active.
  - Ensure `stopTranslation()` and `watchSpaNavigation.onBeforeLeave()` call `breakpointGate.releaseAll()` so paused batches never wedge.
  - Keep GM menu commands clean (`translatePage`, `restorePage`, `studioMode`, `openSettings`).
- Delete `src/ui/studio/inspect/{index,view}.ts` and `src/ui/studio/volunteer/{index,view}.ts`.
- Remove unused legacy optional callbacks from `src/ui/basic/index.ts`.

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
- `bun run --filter '*' typecheck`: exit 0 for all 3 packages.
- `bun run check`: 0 errors across entire repo.
- `bun run --filter '*' build`: exit 0, `.dist-dev/` updated, `dist/` untouched.

- [ ] **Step 5: Commit**

```bash
git add -A packages/page-translator/src packages/page-translator/tests
git commit -m "feat(ptr): wire Industrial Studio Workspace, API breakpoint hook, and remove legacy floating studio panels"
```
