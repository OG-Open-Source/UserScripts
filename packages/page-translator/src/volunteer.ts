import type { GMMenuHandle, ThemeMode } from "@userscripts/shared";
import {
  applyThemeModeToElement,
  createDragController,
  gmMenuCommand,
  gmUnregisterMenuCommand,
  isUsUiEvent,
  markUiRoot,
  probeHostColors,
  resolveThemeTokens,
} from "@userscripts/shared";
import type { StyleReader } from "./capture/display-role";
import { encodeInlineNodes } from "./capture/inline-codec";
import type { TranslationSegment } from "./capture/segmenter";
import { collectSegments } from "./capture/segmenter";
import {
  buildAiTranslationExport,
  parseAiTranslationImport,
} from "./export-ai";
import type { PtrMessageKey } from "./i18n";
import { formatPtrMsg, MESSAGES_EN } from "./i18n";
import type { CompiledSiteDelta } from "./site-rules";
import type { SiteLocaleScope, SiteLocaleTable } from "./transform/template";
import {
  extractTemplate,
  interpolateTemplate,
  matchSiteTranslation,
  suggestScopeSelector,
} from "./transform/template";
import { mergeLocaleTables } from "./translations-remote";
import { getSharedPanelCss } from "./ui-theme";

const VOLUNTEER_MENU_ID = "ptr-volunteer";
const VOLUNTEER_CLICK_MENU_ID = "ptr-volunteer-block-clicks";
const VOLUNTEER_STYLE_ID = "ptr-vol-style";
const INLINE_PLACEHOLDER_RE = /<x\s+id="\d+"/u;

function triggerPulse(btn: HTMLElement): void {
  btn.classList.remove("flash-done");
  void btn.offsetWidth;
  btn.classList.add("flash-done");
}

export interface VolunteerConflict {
  existing: string;
  id: string;
  imported: string;
  key: string;
  kind: "static" | "dynamic";
  scope?: string;
}

export interface VolunteerControllerOptions {
  doc: Document;
  formatClickBlockLabel?: (blocked: boolean) => string;
  formatLabel?: (enabled: boolean) => string;
  getDelta: () => CompiledSiteDelta;
  getLocalLocaleTable?: () => SiteLocaleTable | null;
  getSiteLocaleTable: () => SiteLocaleTable | null;
  getStyle?: StyleReader;
  getTargetLang: () => string;
  getThemeMode?: () => ThemeMode;
  hostname: string;
  isClickBlocked?: () => boolean;
  isEnabled: () => boolean;
  onSiteDictUpdated?: () => void;
  onSyncLocalTable?: (patch: SiteLocaleTable) => void;
  /** Ignored legacy field: volunteer exports never include a pathname. */
  pathname?: string;
  setClickBlocked?: (next: boolean) => void;
  setEnabled: (next: boolean) => void;
  t?: (key: PtrMessageKey) => string;
}

interface CapturedEntry {
  hit: boolean;
  key: string;
  kind: "static" | "dynamic";
  matchedScope: string | null;
  seg: TranslationSegment;
  values: string[];
}

interface VolunteerRefs {
  asideEl: HTMLElement;
  badgeDotEl: HTMLElement;
  badgeTextEl: HTMLElement;
  blockClicksBtn: HTMLButtonElement;
  conflictHeaderEl: HTMLElement;
  conflictKeepAllBtn: HTMLButtonElement;
  conflictListEl: HTMLElement;
  conflictOverwriteAllBtn: HTMLButtonElement;
  conflictsEl: HTMLElement;
  copyBtn: HTMLButtonElement;
  dlBtn: HTMLButtonElement;
  editorEl: HTMLElement;
  emptyEl: HTMLElement;
  exportAiBtn: HTMLButtonElement;
  headEl: HTMLElement;
  importApplyBtn: HTMLButtonElement;
  importBoxEl: HTMLElement;
  importCancelBtn: HTMLButtonElement;
  importInput: HTMLTextAreaElement;
  importToggleBtn: HTMLButtonElement;
  keyEl: HTMLElement;
  msgEl: HTMLElement;
  nextBtn: HTMLButtonElement;
  posEl: HTMLElement;
  prevBtn: HTMLButtonElement;
  rescanBtn: HTMLButtonElement;
  saveBtn: HTMLButtonElement;
  scopeInput: HTMLInputElement;
  statDynEl: HTMLElement;
  statHitsEl: HTMLElement;
  statStaticEl: HTMLElement;
  suggestBtn: HTMLButtonElement;
  titleEl: HTMLElement;
  valInput: HTMLInputElement;
  valuesEl: HTMLElement;
}

const volSheetCache = new WeakMap<ShadowRoot, CSSStyleSheet>();

function applyVolCss(sr: ShadowRoot, doc: Document, css: string): void {
  if (
    typeof CSSStyleSheet !== "undefined" &&
    Array.isArray(sr.adoptedStyleSheets)
  ) {
    try {
      let sheet = volSheetCache.get(sr);
      if (!sheet) {
        sheet = new CSSStyleSheet();
        volSheetCache.set(sr, sheet);
      }
      sheet.replaceSync(css);
      if (!sr.adoptedStyleSheets.includes(sheet)) {
        sr.adoptedStyleSheets = [...sr.adoptedStyleSheets, sheet];
      }
      return;
    } catch {
      // Fall back to <style> node
    }
  }
  let styleEl = sr.querySelector(
    `#${VOLUNTEER_STYLE_ID}`
  ) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = doc.createElement("style");
    styleEl.id = VOLUNTEER_STYLE_ID;
    sr.prepend(styleEl);
  }
  styleEl.textContent = css;
}

function isNonEmptyScopedValue(value: string): boolean {
  return value.trim() !== "";
}

function filterNonEmptyDict(
  dict?: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!dict) {
    return out;
  }
  for (const [k, v] of Object.entries(dict)) {
    if (isNonEmptyScopedValue(v)) {
      out[k] = v;
    }
  }
  return out;
}

function buildCleanScoped(
  scoped?: Record<string, SiteLocaleScope>
): Record<string, SiteLocaleScope> {
  const out: Record<string, SiteLocaleScope> = {};
  if (!scoped) {
    return out;
  }
  for (const [selector, scope] of Object.entries(scoped)) {
    const clean: SiteLocaleScope = {};
    const scopedStatic = filterNonEmptyDict(scope.static);
    const scopedDynamic = filterNonEmptyDict(scope.dynamic);
    if (Object.keys(scopedStatic).length > 0) {
      clean.static = scopedStatic;
    }
    if (Object.keys(scopedDynamic).length > 0) {
      clean.dynamic = scopedDynamic;
    }
    if (clean.static || clean.dynamic) {
      out[selector] = clean;
    }
  }
  return out;
}

function addPatchEntry(
  patch: SiteLocaleTable,
  kind: "static" | "dynamic",
  key: string,
  value: string,
  scope?: string
): void {
  if (scope) {
    patch.scoped ??= {};
    const curScope = patch.scoped[scope] ?? {};
    if (kind === "static") {
      curScope.static = { ...(curScope.static ?? {}), [key]: value };
    } else {
      curScope.dynamic = { ...(curScope.dynamic ?? {}), [key]: value };
    }
    patch.scoped[scope] = curScope;
    return;
  }
  if (kind === "static") {
    patch.static = { ...(patch.static ?? {}), [key]: value };
  } else {
    patch.dynamic = { ...(patch.dynamic ?? {}), [key]: value };
  }
}

function buildConflictId(
  kind: "static" | "dynamic",
  key: string,
  scope?: string
): string {
  return `${kind}::${scope ?? ""}::${key}`;
}

function resolveSavedTranslation(
  cur: CapturedEntry,
  activeScope: string,
  localTable: SiteLocaleTable,
  table: SiteLocaleTable | null
): string | undefined {
  if (activeScope) {
    const scopedSaved =
      cur.kind === "static"
        ? (localTable.scoped?.[activeScope]?.static?.[cur.key] ??
          table?.scoped?.[activeScope]?.static?.[cur.key])
        : (localTable.scoped?.[activeScope]?.dynamic?.[cur.key] ??
          table?.scoped?.[activeScope]?.dynamic?.[cur.key]);
    if (scopedSaved !== undefined) {
      return scopedSaved;
    }
  }
  return cur.kind === "static"
    ? (localTable.static?.[cur.key] ?? table?.static?.[cur.key])
    : (localTable.dynamic?.[cur.key] ?? table?.dynamic?.[cur.key]);
}

interface ImportCandidate {
  imported: string;
  key: string;
  kind: "static" | "dynamic";
  scope?: string;
}

function collectImportCandidates(
  parsed: ReturnType<typeof parseAiTranslationImport>,
  entryByKey: Map<string, CapturedEntry>
): ImportCandidate[] {
  const out: ImportCandidate[] = [];
  for (const [k, v] of Object.entries(parsed.static)) {
    const matched = entryByKey.get(k);
    const kind: "static" | "dynamic" =
      matched && matched.kind === "dynamic" ? "dynamic" : "static";
    out.push({ kind, key: k, imported: v });
  }
  for (const [k, v] of Object.entries(parsed.dynamic)) {
    out.push({ kind: "dynamic", key: k, imported: v });
  }
  for (const [selector, sc] of Object.entries(parsed.scoped)) {
    for (const [k, v] of Object.entries(sc.static ?? {})) {
      out.push({ kind: "static", key: k, imported: v, scope: selector });
    }
    for (const [k, v] of Object.entries(sc.dynamic ?? {})) {
      out.push({ kind: "dynamic", key: k, imported: v, scope: selector });
    }
  }
  return out;
}

export function createVolunteerController(options: VolunteerControllerOptions) {
  let hostEl: HTMLElement | null = null;
  let refs: VolunteerRefs | null = null;
  let dragController: { destroy: () => void } | null = null;
  let registeredHandle: GMMenuHandle | undefined;
  let registeredClickHandle: GMMenuHandle | undefined;
  let menuRegistered = false;
  let internalClickBlocked = false;
  let localOverrides: SiteLocaleTable =
    mergeLocaleTables(null, options.getLocalLocaleTable?.()) ?? {};
  let pendingConflicts: VolunteerConflict[] = [];
  let capturedEntries: CapturedEntry[] = [];
  let containerToIndex = new WeakMap<Element, number>();
  let staticCount = 0;
  let dynamicCount = 0;
  let hitCount = 0;
  let selectedIdx = 0;
  let lastRenderedIdx = -1;
  let lastRenderedKey = "";
  const prevTexts = new Map<HTMLElement, string>();

  function tr(
    key: PtrMessageKey,
    vars?: Record<string, string | number>
  ): string {
    const raw = options.t ? options.t(key) : MESSAGES_EN[key];
    return formatPtrMsg(raw, vars);
  }

  function setTextFast(el: HTMLElement | null | undefined, text: string): void {
    if (!el) {
      return;
    }
    if (prevTexts.get(el) === text) {
      return;
    }
    prevTexts.set(el, text);
    el.textContent = text;
  }

  function isClickBlocked(): boolean {
    if (!options.isEnabled()) {
      return false;
    }
    return options.isClickBlocked
      ? options.isClickBlocked()
      : internalClickBlocked;
  }

  function setClickBlockedState(next: boolean): void {
    const resolved = options.isEnabled() ? next : false;
    internalClickBlocked = resolved;
    options.setClickBlocked?.(resolved);
  }

  function getEventCaptureRoot(): EventTarget {
    return options.doc.defaultView ?? options.doc;
  }

  function getEffectiveLocalTable(): SiteLocaleTable {
    const external = options.getLocalLocaleTable?.() ?? null;
    if (options.onSyncLocalTable && options.getLocalLocaleTable) {
      return external ?? {};
    }
    return mergeLocaleTables(external, localOverrides) ?? {};
  }

  function syncLocalPatch(patch: SiteLocaleTable): void {
    if (!(patch.static || patch.dynamic || patch.scoped)) {
      return;
    }
    localOverrides = mergeLocaleTables(localOverrides, patch) ?? {};
    options.onSyncLocalTable?.(patch);
  }

  function upsertConflict(conflict: VolunteerConflict): void {
    const existingIdx = pendingConflicts.findIndex(
      (item) => item.id === conflict.id
    );
    if (existingIdx >= 0) {
      pendingConflicts[existingIdx] = conflict;
    } else {
      pendingConflicts.push(conflict);
    }
  }

  function scanPage(): void {
    const root = options.doc.body ?? options.doc.documentElement;
    if (!root) {
      return;
    }
    const delta = options.getDelta();
    const table = mergeLocaleTables(
      options.getSiteLocaleTable(),
      getEffectiveLocalTable()
    );
    const segs = collectSegments(
      root,
      delta,
      options.getStyle ? { getStyle: options.getStyle } : undefined
    );

    const nextIndex = new WeakMap<Element, number>();
    let nextStatic = 0;
    let nextDyn = 0;
    let nextHits = 0;

    capturedEntries = segs.map((seg, idx) => {
      nextIndex.set(seg.container, idx);
      const encoded = encodeInlineNodes(seg.nodes, delta);
      const ext = extractTemplate(encoded.payloadHtml);
      const matchHit = matchSiteTranslation(
        encoded.payloadHtml,
        table,
        seg.container
      );
      const hit = Boolean(matchHit);
      if (ext.kind === "static") {
        nextStatic += 1;
      } else {
        nextDyn += 1;
      }
      if (hit) {
        nextHits += 1;
      }
      return {
        seg,
        kind: ext.kind,
        key: ext.template,
        values: ext.values,
        hit,
        matchedScope: matchHit?.scope ?? null,
      };
    });

    containerToIndex = nextIndex;
    staticCount = nextStatic;
    dynamicCount = nextDyn;
    hitCount = nextHits;
    if (selectedIdx >= capturedEntries.length) {
      selectedIdx = 0;
    }
  }

  function getExportJson(): string {
    const localTable = getEffectiveLocalTable();
    const staticOut = filterNonEmptyDict(localTable.static);
    const dynamicOut = filterNonEmptyDict(localTable.dynamic);
    const scopedOut = buildCleanScoped(localTable.scoped);
    return JSON.stringify(
      {
        version: 1,
        host: options.hostname,
        locales: {
          [options.getTargetLang()]: {
            static: staticOut,
            dynamic: dynamicOut,
            ...(Object.keys(scopedOut).length > 0 ? { scoped: scopedOut } : {}),
          },
        },
      },
      null,
      2
    );
  }

  function exportForAi() {
    return buildAiTranslationExport(options.doc, options.getDelta(), {
      hostname: options.hostname,
      targetLang: options.getTargetLang(),
      getStyle: options.getStyle,
      siteTable: mergeLocaleTables(
        options.getSiteLocaleTable(),
        getEffectiveLocalTable()
      ),
    });
  }

  function processImportCandidate(
    candidate: ImportCandidate,
    existingTable: SiteLocaleTable | null,
    localPatch: SiteLocaleTable
  ): boolean {
    const { kind, key, imported, scope } = candidate;
    if (typeof imported !== "string" || imported.trim() === "") {
      return false;
    }
    const existing = scope
      ? existingTable?.scoped?.[scope]?.[kind]?.[key]
      : existingTable?.[kind]?.[key];
    const existingTrimmed = typeof existing === "string" ? existing.trim() : "";
    if (existingTrimmed === "") {
      addPatchEntry(localPatch, kind, key, imported, scope);
      return true;
    }
    if (existing === imported) {
      return false;
    }
    upsertConflict({
      id: buildConflictId(kind, key, scope),
      kind,
      key,
      ...(scope ? { scope } : {}),
      existing: existing as string,
      imported,
    });
    return false;
  }

  function importAiJson(raw: string): {
    applied: number;
    conflicts: number;
    synced: number;
  } {
    const parsed = parseAiTranslationImport(raw, options.getTargetLang());
    const existingTable = mergeLocaleTables(
      options.getSiteLocaleTable(),
      getEffectiveLocalTable()
    );
    const localPatch: SiteLocaleTable = {};
    let synced = 0;

    const entryByKey = new Map<string, CapturedEntry>();
    for (const entry of capturedEntries) {
      if (!entryByKey.has(entry.key)) {
        entryByKey.set(entry.key, entry);
      }
    }

    for (const candidate of collectImportCandidates(parsed, entryByKey)) {
      if (processImportCandidate(candidate, existingTable, localPatch)) {
        synced += 1;
      }
    }

    if (synced > 0) {
      syncLocalPatch(localPatch);
      options.onSiteDictUpdated?.();
      scanPage();
    }

    lastRenderedIdx = -1;
    lastRenderedKey = "";
    patchPanel();
    return { synced, conflicts: pendingConflicts.length, applied: synced };
  }

  function getPendingConflicts(): readonly VolunteerConflict[] {
    return [...pendingConflicts];
  }

  function resolveConflict(id: string, choice: "existing" | "imported"): void {
    const idx = pendingConflicts.findIndex((c) => c.id === id);
    if (idx < 0) {
      return;
    }
    const [conflict] = pendingConflicts.splice(idx, 1);
    if (conflict && choice === "imported") {
      const patch: SiteLocaleTable = {};
      addPatchEntry(
        patch,
        conflict.kind,
        conflict.key,
        conflict.imported,
        conflict.scope
      );
      syncLocalPatch(patch);
    }
    options.onSiteDictUpdated?.();
    scanPage();
    lastRenderedIdx = -1;
    lastRenderedKey = "";
    patchPanel();
    setTextFast(refs?.msgEl, tr("volConflictResolved"));
  }

  function resolveAllConflicts(choice: "existing" | "imported"): void {
    if (pendingConflicts.length === 0) {
      return;
    }
    const items = pendingConflicts;
    pendingConflicts = [];
    if (choice === "imported") {
      const patch: SiteLocaleTable = {};
      for (const conflict of items) {
        addPatchEntry(
          patch,
          conflict.kind,
          conflict.key,
          conflict.imported,
          conflict.scope
        );
      }
      syncLocalPatch(patch);
    }
    options.onSiteDictUpdated?.();
    scanPage();
    lastRenderedIdx = -1;
    lastRenderedKey = "";
    patchPanel();
    setTextFast(refs?.msgEl, tr("volConflictResolved"));
  }

  function syncClickBlockButton(): void {
    if (!refs) {
      return;
    }
    const blocked = isClickBlocked();
    setTextFast(refs.blockClicksBtn, tr(blocked ? "volLockOn" : "volLockOff"));
    refs.blockClicksBtn.setAttribute(
      "aria-pressed",
      blocked ? "true" : "false"
    );
    refs.blockClicksBtn.disabled = !options.isEnabled();
  }

  function updateStats(): void {
    if (!refs) {
      return;
    }
    setTextFast(refs.statStaticEl, String(staticCount));
    setTextFast(refs.statDynEl, String(dynamicCount));
    setTextFast(refs.statHitsEl, String(hitCount));
  }

  function patchEditorFields(cur: CapturedEntry, sr: ShadowRoot): void {
    if (!refs) {
      return;
    }
    const selectionChanged =
      selectedIdx !== lastRenderedIdx || cur.key !== lastRenderedKey;
    const table = options.getSiteLocaleTable();
    const suggestedScope =
      cur.matchedScope ?? suggestScopeSelector(cur.seg.container);

    if (
      (selectionChanged || sr.activeElement !== refs.scopeInput) &&
      (selectionChanged || !refs.scopeInput.value)
    ) {
      refs.scopeInput.value = suggestedScope;
    }

    if (selectionChanged || sr.activeElement !== refs.valInput) {
      const activeScope = refs.scopeInput.value.trim();
      const savedOrTable = resolveSavedTranslation(
        cur,
        activeScope,
        getEffectiveLocalTable(),
        table
      );
      const hasPlaceholder =
        cur.kind === "dynamic" || INLINE_PLACEHOLDER_RE.test(cur.key);
      refs.valInput.value = savedOrTable ?? (hasPlaceholder ? cur.key : "");
    }
  }

  function patchPanel(): void {
    if (!(hostEl?.shadowRoot && refs)) {
      return;
    }
    const sr = hostEl.shadowRoot;
    setTextFast(refs.titleEl, tr("volTitle", { host: options.hostname }));
    updateStats();
    setTextFast(refs.dlBtn, tr("volDownload", { host: options.hostname }));

    const cur = capturedEntries[selectedIdx];
    if (cur) {
      refs.editorEl.hidden = false;
      refs.emptyEl.hidden = true;
      setTextFast(
        refs.badgeTextEl,
        tr(cur.kind === "dynamic" ? "volBadgeDynamic" : "volBadgeStatic")
      );
      refs.badgeDotEl.className = `us-dot ${cur.kind === "dynamic" ? "dyn" : "static"}`;
      setTextFast(refs.posEl, `#${selectedIdx + 1}/${capturedEntries.length}`);
      setTextFast(
        refs.valuesEl,
        cur.values.length ? `${tr("volValues")}: ${cur.values.join(", ")}` : ""
      );
      setTextFast(refs.keyEl, cur.key);
      refs.valInput.placeholder = tr("volTransPlaceholder", {
        lang: options.getTargetLang(),
      });
      patchEditorFields(cur, sr);
      lastRenderedIdx = selectedIdx;
      lastRenderedKey = cur.key;
    } else {
      refs.editorEl.hidden = true;
      refs.emptyEl.hidden = false;
      lastRenderedIdx = -1;
      lastRenderedKey = "";
    }
    renderConflicts();
    syncClickBlockButton();
  }

  function renderConflicts(): void {
    if (!refs) {
      return;
    }
    const count = pendingConflicts.length;
    refs.conflictsEl.hidden = count === 0;
    if (count === 0) {
      refs.conflictListEl.replaceChildren();
      return;
    }
    setTextFast(refs.conflictHeaderEl, tr("volConflictsHeader", { count }));
    const frag = options.doc.createDocumentFragment();
    for (const c of pendingConflicts) {
      const item = options.doc.createElement("div");
      item.className = "conflict-item";

      if (c.scope) {
        const scopeEl = options.doc.createElement("span");
        scopeEl.className = "ptr-chip ptr-mono";
        scopeEl.textContent = c.scope;
        item.appendChild(scopeEl);
      }

      const keyEl = options.doc.createElement("div");
      keyEl.className = "conflict-key";
      keyEl.textContent = c.key;
      item.appendChild(keyEl);

      const diffEl = options.doc.createElement("div");
      diffEl.className = "conflict-diff";

      const existingRow = options.doc.createElement("div");
      existingRow.className = "conflict-val";
      const existingLbl = options.doc.createElement("span");
      existingLbl.className = "conflict-lbl";
      existingLbl.textContent = tr("volConflictExisting");
      const existingTxt = options.doc.createElement("span");
      existingTxt.textContent = c.existing;
      existingRow.append(existingLbl, existingTxt);

      const importedRow = options.doc.createElement("div");
      importedRow.className = "conflict-val";
      const importedLbl = options.doc.createElement("span");
      importedLbl.className = "conflict-lbl";
      importedLbl.textContent = tr("volConflictImported");
      const importedTxt = options.doc.createElement("span");
      importedTxt.textContent = c.imported;
      importedRow.append(importedLbl, importedTxt);

      diffEl.append(existingRow, importedRow);
      item.appendChild(diffEl);

      const actionsEl = options.doc.createElement("div");
      actionsEl.className = "row-between";
      actionsEl.style.marginTop = "0";

      const btnGroup = options.doc.createElement("div");
      btnGroup.className = "us-btn-group";

      const keepBtn = options.doc.createElement("button");
      keepBtn.type = "button";
      keepBtn.className = "ptr-btn us-btn-sm";
      keepBtn.dataset.conflictId = c.id;
      keepBtn.dataset.conflictAction = "existing";
      keepBtn.textContent = tr("volConflictKeep");

      const overwriteBtn = options.doc.createElement("button");
      overwriteBtn.type = "button";
      overwriteBtn.className = "ptr-btn ptr-btn-primary us-btn-sm";
      overwriteBtn.dataset.conflictId = c.id;
      overwriteBtn.dataset.conflictAction = "imported";
      overwriteBtn.textContent = tr("volConflictOverwrite");

      btnGroup.append(keepBtn, overwriteBtn);
      actionsEl.appendChild(btnGroup);
      item.appendChild(actionsEl);
      frag.appendChild(item);
    }
    refs.conflictListEl.replaceChildren(frag);
  }

  function syncClickBlockMenu(): void {
    if (!menuRegistered) {
      return;
    }
    if (registeredClickHandle !== undefined) {
      gmUnregisterMenuCommand(registeredClickHandle);
      registeredClickHandle = undefined;
    }
    if (!options.isEnabled()) {
      return;
    }
    const blocked = isClickBlocked();
    const caption = options.formatClickBlockLabel
      ? options.formatClickBlockLabel(blocked)
      : tr("volunteerBlockClicks", { state: tr(blocked ? "on" : "off") });
    const handle = gmMenuCommand(caption, toggleClickBlock, {
      id: VOLUNTEER_CLICK_MENU_ID,
    });
    registeredClickHandle = handle ?? VOLUNTEER_CLICK_MENU_ID;
  }

  function toggleClickBlock(): void {
    if (!options.isEnabled()) {
      return;
    }
    const next = !isClickBlocked();
    setClickBlockedState(next);
    syncClickBlockButton();
    setTextFast(refs?.msgEl, tr(next ? "volLockOnMsg" : "volLockOffMsg"));
    syncClickBlockMenu();
  }

  function onPageBlockedEvent(e: Event): void {
    if (!(options.isEnabled() && isClickBlocked())) {
      return;
    }
    if (isUsUiEvent(e, hostEl)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
  }

  function onPageClick(e: Event): void {
    if (!options.isEnabled()) {
      return;
    }
    if (isUsUiEvent(e, hostEl)) {
      return;
    }
    const target = e.target as Element | null;
    if (!target) {
      return;
    }
    if (isClickBlocked()) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
    }
    let walk: Element | null = target;
    while (walk) {
      const match = containerToIndex.get(walk);
      if (match !== undefined) {
        selectedIdx = match;
        patchPanel();
        return;
      }
      walk = walk.parentElement;
    }
  }

  function buildVolCss(
    hostTokens: ReturnType<typeof resolveThemeTokens>
  ): string {
    return `${getSharedPanelCss(hostTokens)}
:host {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483647;
  pointer-events: none;
}
.ptr-vol {
  width: 386px;
  pointer-events: auto;
}
.vol-meta { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-bottom: 6px; }
.vol-badge { font-weight: 600; }
.box {
  background: var(--us-surface);
  padding: 7px 9px;
  border-radius: var(--us-radius-sm);
  word-break: break-word;
  max-height: 64px;
  overflow-y: auto;
  contain: layout paint;
  font-family: var(--us-mono);
  font-size: 11.5px;
}
.field-row { display: grid; grid-template-columns: 52px 1fr auto; gap: 6px; align-items: center; margin-top: 6px; }
.field-row-2 { display: grid; grid-template-columns: 52px 1fr; gap: 6px; align-items: center; margin-top: 6px; }
.field-lbl { font-size: 11.5px; color: var(--us-muted); }
.row-between { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.msg { color: var(--us-muted); font-size: 11.5px; margin-top: 6px; word-break: break-word; }
.import-box { margin-top: 8px; display: grid; gap: 6px; }
.import-box[hidden] { display: none; }
.conflict-box { display: grid; gap: 6px; }
.conflict-box[hidden] { display: none; }
.conflict-list { display: grid; gap: 6px; max-height: 180px; overflow-y: auto; }
.conflict-item {
  background: var(--us-surface);
  border-radius: var(--us-radius-md);
  padding: 7px 9px;
  display: grid;
  gap: 5px;
}
.conflict-key {
  font-family: var(--us-mono);
  font-size: 11px;
  word-break: break-word;
}
.conflict-diff {
  display: grid;
  gap: 3px;
  font-size: 11px;
}
.conflict-val {
  background: var(--us-surface-2);
  border-radius: var(--us-radius-sm);
  padding: 4px 6px;
  word-break: break-word;
}
.conflict-lbl {
  color: var(--us-muted);
  font-size: 10.5px;
  margin-right: 4px;
}`;
  }

  function syncThemeOnVol(): void {
    if (!hostEl?.shadowRoot) {
      return;
    }
    const mode = options.getThemeMode?.() ?? "system";
    const hostColors = mode === "host" ? probeHostColors(options.doc) : null;
    const hostTokens =
      mode === "host" ? resolveThemeTokens("host", hostColors) : null;
    applyThemeModeToElement(hostEl, mode, hostColors);
    applyVolCss(hostEl.shadowRoot, options.doc, buildVolCss(hostTokens));
  }

  function mount(): void {
    if (hostEl) {
      syncThemeOnVol();
      return;
    }
    hostEl = options.doc.createElement("div");
    hostEl.setAttribute("data-ptr-ui", "1");
    markUiRoot(hostEl, "ptr");
    const sr = hostEl.attachShadow({ mode: "open" });

    const mode = options.getThemeMode?.() ?? "system";
    const hostColors = mode === "host" ? probeHostColors(options.doc) : null;
    const hostTokens =
      mode === "host" ? resolveThemeTokens("host", hostColors) : null;
    applyThemeModeToElement(hostEl, mode, hostColors);
    applyVolCss(sr, options.doc, buildVolCss(hostTokens));

    const tpl = options.doc.createElement("template");
    tpl.innerHTML = `
<aside class="us-panel ptr-vol" id="ptr-v-aside" aria-label="${tr("volTitle", { host: options.hostname })}">
  <div class="us-panel-head" id="ptr-v-head">
    <span class="drag-title">
      <svg class="drag-grip" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="3" r="1.1"/><circle cx="8.5" cy="3" r="1.1"/><circle cx="3.5" cy="8" r="1.1"/><circle cx="8.5" cy="8" r="1.1"/><circle cx="3.5" cy="13" r="1.1"/><circle cx="8.5" cy="13" r="1.1"/></svg>
      <span id="ptr-v-title"></span>
    </span>
    <div class="us-btn-group">
      <button id="ptr-v-block-clicks" class="ptr-btn us-btn-sm" type="button" aria-pressed="false"></button>
      <button id="ptr-v-rescan" class="ptr-btn us-btn-sm" type="button"></button>
    </div>
  </div>
  <div class="us-panel-sec">
    <div class="us-stat-strip">
      <div class="us-stat-cell">
        <span class="us-stat-val" id="ptr-v-stat-static">0</span>
        <span class="us-stat-label" id="ptr-v-lbl-static"></span>
      </div>
      <div class="us-stat-cell">
        <span class="us-stat-val" id="ptr-v-stat-dyn">0</span>
        <span class="us-stat-label" id="ptr-v-lbl-dyn"></span>
      </div>
      <div class="us-stat-cell">
        <span class="us-stat-val" id="ptr-v-stat-hits">0</span>
        <span class="us-stat-label" id="ptr-v-lbl-hits"></span>
      </div>
    </div>
  </div>
  <div class="us-panel-sec" id="ptr-v-editor" hidden>
    <div class="vol-meta">
      <span class="ptr-chip vol-badge" id="ptr-v-badge"><i class="us-dot static" id="ptr-v-badge-dot"></i><span id="ptr-v-badge-text"></span> <span class="ptr-mono" id="ptr-v-pos"></span></span>
      <span class="ptr-muted ptr-mono" id="ptr-v-values"></span>
    </div>
    <div class="box" id="ptr-v-key"></div>
    <div class="field-row">
      <span class="field-lbl" id="ptr-v-lbl-scope"></span>
      <input id="ptr-v-scope" class="ptr-input ptr-mono" type="text" />
      <button id="ptr-v-suggest-scope" class="ptr-btn us-btn-sm" type="button"></button>
    </div>
    <div class="field-row-2">
      <span class="field-lbl" id="ptr-v-lbl-trans"></span>
      <input id="ptr-v-val" class="ptr-input" type="text" />
    </div>
    <div class="row-between">
      <div class="us-btn-group">
        <button id="ptr-v-prev" class="ptr-btn us-btn-sm" type="button"></button>
        <button id="ptr-v-next" class="ptr-btn us-btn-sm" type="button"></button>
      </div>
      <button id="ptr-v-save" class="ptr-btn ptr-btn-primary us-btn-sm" type="button"></button>
    </div>
  </div>
  <div class="us-panel-sec ptr-muted" id="ptr-v-empty" hidden></div>
  <div class="us-panel-sec">
    <div class="row-between" style="margin-top:0">
      <div class="us-btn-group">
        <button id="ptr-v-copy" class="ptr-btn us-btn-sm" type="button"></button>
        <button id="ptr-v-dl" class="ptr-btn us-btn-sm" type="button"></button>
      </div>
      <div class="us-btn-group">
        <button id="ptr-v-export-ai" class="ptr-btn us-btn-sm" type="button"></button>
        <button id="ptr-v-import-toggle" class="ptr-btn us-btn-sm" type="button"></button>
      </div>
    </div>
    <div class="import-box" id="ptr-v-import-box" hidden>
      <textarea id="ptr-v-import-input" class="ptr-input" rows="3"></textarea>
      <div class="row-between" style="margin-top:0">
        <button id="ptr-v-import-cancel" class="ptr-btn us-btn-sm" type="button"></button>
        <button id="ptr-v-import-apply" class="ptr-btn ptr-btn-primary us-btn-sm" type="button"></button>
      </div>
    </div>
    <div class="conflict-box" id="ptr-v-conflicts" hidden>
      <div class="row-between" style="margin-top:0">
        <span class="vol-badge" id="ptr-v-conflict-header"></span>
        <div class="us-btn-group">
          <button id="ptr-v-conflict-keep-all" class="ptr-btn us-btn-sm" type="button"></button>
          <button id="ptr-v-conflict-overwrite-all" class="ptr-btn ptr-btn-primary us-btn-sm" type="button"></button>
        </div>
      </div>
      <div class="conflict-list" id="ptr-v-conflict-list"></div>
    </div>
    <div class="msg" id="ptr-v-msg"></div>
  </div>
</aside>`;
    sr.appendChild(tpl.content.cloneNode(true));

    const get = <T extends HTMLElement>(id: string): T =>
      sr.querySelector(`#${id}`) as T;

    setTextFast(get("ptr-v-rescan"), tr("volRescan"));
    setTextFast(get("ptr-v-lbl-static"), tr("volStatStatic"));
    setTextFast(get("ptr-v-lbl-dyn"), tr("volStatDynamic"));
    setTextFast(get("ptr-v-lbl-hits"), tr("volStatHits"));
    setTextFast(get("ptr-v-lbl-scope"), tr("volScope"));
    setTextFast(get("ptr-v-lbl-trans"), tr("volTrans"));
    setTextFast(get("ptr-v-suggest-scope"), tr("volSuggest"));
    setTextFast(get("ptr-v-prev"), tr("volPrev"));
    setTextFast(get("ptr-v-next"), tr("volNext"));
    setTextFast(get("ptr-v-save"), tr("volSave"));
    setTextFast(get("ptr-v-empty"), tr("volEmpty"));
    setTextFast(get("ptr-v-copy"), tr("volCopyJson"));
    setTextFast(get("ptr-v-export-ai"), tr("volExportAi"));
    setTextFast(get("ptr-v-import-toggle"), tr("volImportAi"));
    setTextFast(get("ptr-v-import-cancel"), tr("volImportCancel"));
    setTextFast(get("ptr-v-import-apply"), tr("volImportApply"));
    setTextFast(get("ptr-v-conflict-keep-all"), tr("volConflictKeepAll"));
    setTextFast(
      get("ptr-v-conflict-overwrite-all"),
      tr("volConflictOverwriteAll")
    );
    setTextFast(get("ptr-v-msg"), tr("volDraftReady"));

    const scopeInput = get<HTMLInputElement>("ptr-v-scope");
    scopeInput.placeholder = tr("volScopePlaceholder");
    scopeInput.setAttribute("aria-label", tr("volScopePlaceholder"));
    const importInput = get<HTMLTextAreaElement>("ptr-v-import-input");
    importInput.placeholder = tr("volImportPlaceholder");

    refs = {
      asideEl: get("ptr-v-aside"),
      headEl: get("ptr-v-head"),
      titleEl: get("ptr-v-title"),
      statStaticEl: get("ptr-v-stat-static"),
      statDynEl: get("ptr-v-stat-dyn"),
      statHitsEl: get("ptr-v-stat-hits"),
      editorEl: get("ptr-v-editor"),
      emptyEl: get("ptr-v-empty"),
      badgeDotEl: get("ptr-v-badge-dot"),
      badgeTextEl: get("ptr-v-badge-text"),
      posEl: get("ptr-v-pos"),
      valuesEl: get("ptr-v-values"),
      keyEl: get("ptr-v-key"),
      scopeInput,
      suggestBtn: get<HTMLButtonElement>("ptr-v-suggest-scope"),
      valInput: get<HTMLInputElement>("ptr-v-val"),
      prevBtn: get<HTMLButtonElement>("ptr-v-prev"),
      nextBtn: get<HTMLButtonElement>("ptr-v-next"),
      saveBtn: get<HTMLButtonElement>("ptr-v-save"),
      blockClicksBtn: get<HTMLButtonElement>("ptr-v-block-clicks"),
      rescanBtn: get<HTMLButtonElement>("ptr-v-rescan"),
      copyBtn: get<HTMLButtonElement>("ptr-v-copy"),
      dlBtn: get<HTMLButtonElement>("ptr-v-dl"),
      exportAiBtn: get<HTMLButtonElement>("ptr-v-export-ai"),
      importToggleBtn: get<HTMLButtonElement>("ptr-v-import-toggle"),
      importBoxEl: get("ptr-v-import-box"),
      importInput,
      importApplyBtn: get<HTMLButtonElement>("ptr-v-import-apply"),
      importCancelBtn: get<HTMLButtonElement>("ptr-v-import-cancel"),
      conflictsEl: get("ptr-v-conflicts"),
      conflictHeaderEl: get("ptr-v-conflict-header"),
      conflictKeepAllBtn: get<HTMLButtonElement>("ptr-v-conflict-keep-all"),
      conflictOverwriteAllBtn: get<HTMLButtonElement>(
        "ptr-v-conflict-overwrite-all"
      ),
      conflictListEl: get("ptr-v-conflict-list"),
      msgEl: get("ptr-v-msg"),
    };

    refs.blockClicksBtn.addEventListener("click", toggleClickBlock);
    refs.rescanBtn.addEventListener("click", () => {
      if (refs) {
        triggerPulse(refs.rescanBtn);
      }
      scanPage();
      patchPanel();
    });
    refs.prevBtn.addEventListener("click", () => {
      if (capturedEntries.length > 0) {
        selectedIdx =
          (selectedIdx - 1 + capturedEntries.length) % capturedEntries.length;
        patchPanel();
      }
    });
    refs.nextBtn.addEventListener("click", () => {
      if (capturedEntries.length > 0) {
        selectedIdx = (selectedIdx + 1) % capturedEntries.length;
        patchPanel();
      }
    });
    refs.suggestBtn.addEventListener("click", () => {
      if (!refs) {
        return;
      }
      triggerPulse(refs.suggestBtn);
      const cur = capturedEntries[selectedIdx];
      refs.scopeInput.value = cur
        ? suggestScopeSelector(cur.seg.container)
        : "";
    });
    refs.saveBtn.addEventListener("click", () => {
      if (!refs) {
        return;
      }
      const cur = capturedEntries[selectedIdx];
      if (!cur) {
        return;
      }
      triggerPulse(refs.saveBtn);
      const val = refs.valInput.value;
      const scopeSel = refs.scopeInput.value.trim();
      const patch: SiteLocaleTable = {};
      addPatchEntry(patch, cur.kind, cur.key, val, scopeSel || undefined);
      syncLocalPatch(patch);
      options.onSiteDictUpdated?.();
      const wasHit = cur.hit;
      cur.hit = val.trim() !== "";
      if (cur.hit !== wasHit) {
        hitCount += cur.hit ? 1 : -1;
        updateStats();
      }
      const preview =
        cur.kind === "dynamic" ? interpolateTemplate(val, cur.values) : val;
      setTextFast(
        refs.msgEl,
        scopeSel
          ? tr("volSavedScoped", { scope: scopeSel, preview })
          : tr("volSaved", { preview })
      );
    });
    refs.copyBtn.addEventListener("click", async () => {
      if (!refs) {
        return;
      }
      triggerPulse(refs.copyBtn);
      const json = getExportJson();
      try {
        await navigator.clipboard.writeText(json);
        setTextFast(refs.msgEl, tr("volCopied"));
      } catch {
        setTextFast(refs.msgEl, tr("volCopyDenied"));
      }
    });
    refs.dlBtn.addEventListener("click", () => {
      if (refs) {
        triggerPulse(refs.dlBtn);
      }
      const json = getExportJson();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = options.doc.createElement("a");
      a.href = url;
      a.download = `${options.hostname}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
    refs.exportAiBtn.addEventListener("click", async () => {
      if (!refs) {
        return;
      }
      triggerPulse(refs.exportAiBtn);
      const bundle = exportForAi();
      try {
        await navigator.clipboard.writeText(bundle.prompt);
        setTextFast(refs.msgEl, tr("hudExportedAi", { count: bundle.count }));
      } catch {
        const blob = new Blob([bundle.prompt], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = options.doc.createElement("a");
        a.href = url;
        a.download = `${options.hostname}-ai-export.md`;
        a.click();
        URL.revokeObjectURL(url);
        setTextFast(refs.msgEl, tr("hudExportDenied"));
      }
    });
    refs.importToggleBtn.addEventListener("click", () => {
      if (!refs) {
        return;
      }
      refs.importBoxEl.hidden = !refs.importBoxEl.hidden;
    });
    refs.importCancelBtn.addEventListener("click", () => {
      if (refs) {
        refs.importBoxEl.hidden = true;
      }
    });
    refs.importApplyBtn.addEventListener("click", () => {
      if (!refs) {
        return;
      }
      try {
        const { synced, conflicts } = importAiJson(refs.importInput.value);
        refs.importInput.value = "";
        refs.importBoxEl.hidden = true;
        triggerPulse(refs.importApplyBtn);
        setTextFast(
          refs.msgEl,
          conflicts > 0
            ? tr("volImportedSync", { synced, conflicts })
            : tr("volImported", { count: synced })
        );
      } catch {
        setTextFast(refs.msgEl, tr("volImportError"));
      }
    });
    refs.conflictKeepAllBtn.addEventListener("click", () => {
      resolveAllConflicts("existing");
    });
    refs.conflictOverwriteAllBtn.addEventListener("click", () => {
      resolveAllConflicts("imported");
    });
    refs.conflictListEl.addEventListener("click", (e) => {
      const btn = (e.target as Element | null)?.closest?.(
        "[data-conflict-action]"
      ) as HTMLButtonElement | null;
      if (!btn) {
        return;
      }
      const id = btn.dataset.conflictId;
      const action = btn.dataset.conflictAction;
      if (id && (action === "existing" || action === "imported")) {
        resolveConflict(id, action);
      }
    });

    dragController?.destroy();
    dragController = createDragController({
      panel: hostEl,
      handle: refs.headEl,
      stage: null,
    });

    (options.doc.body ?? options.doc.documentElement).appendChild(hostEl);
    const captureRoot = getEventCaptureRoot();
    captureRoot.addEventListener("click", onPageClick, true);
    captureRoot.addEventListener("auxclick", onPageBlockedEvent, true);
    captureRoot.addEventListener("submit", onPageBlockedEvent, true);
    scanPage();
    patchPanel();
  }

  function unmount(): void {
    const captureRoot = getEventCaptureRoot();
    captureRoot.removeEventListener("click", onPageClick, true);
    captureRoot.removeEventListener("auxclick", onPageBlockedEvent, true);
    captureRoot.removeEventListener("submit", onPageBlockedEvent, true);
    dragController?.destroy();
    dragController = null;
    hostEl?.remove();
    hostEl = null;
    refs = null;
    prevTexts.clear();
    lastRenderedIdx = -1;
    lastRenderedKey = "";
    if (menuRegistered && registeredClickHandle !== undefined) {
      gmUnregisterMenuCommand(registeredClickHandle);
      registeredClickHandle = undefined;
    }
  }

  function syncFromConfig(): void {
    if (options.isEnabled()) {
      mount();
      scanPage();
      patchPanel();
    } else {
      setClickBlockedState(false);
      unmount();
    }
    syncClickBlockMenu();
  }

  function registerMenu(): void {
    menuRegistered = true;
    const caption = options.formatLabel
      ? options.formatLabel(options.isEnabled())
      : tr("volunteerMode", { state: tr(options.isEnabled() ? "on" : "off") });

    if (
      registeredHandle !== undefined &&
      registeredHandle !== VOLUNTEER_MENU_ID
    ) {
      gmUnregisterMenuCommand(registeredHandle);
    }
    const handle = gmMenuCommand(caption, toggle, { id: VOLUNTEER_MENU_ID });
    registeredHandle = handle ?? caption;
    syncClickBlockMenu();
  }

  function toggle(): void {
    const nextEnabled = !options.isEnabled();
    options.setEnabled(nextEnabled);
    if (!nextEnabled) {
      setClickBlockedState(false);
    }
    syncFromConfig();
    registerMenu();
  }

  return {
    syncFromConfig,
    refreshTheme: syncThemeOnVol,
    registerMenu,
    toggle,
    toggleClickBlock,
    isClickBlocked,
    getExportJson,
    exportForAi,
    importAiJson,
    getPendingConflicts,
    resolveConflict,
    resolveAllConflicts,
    refresh() {
      if (options.isEnabled()) {
        scanPage();
        patchPanel();
      }
    },
    stop: unmount,
  };
}
