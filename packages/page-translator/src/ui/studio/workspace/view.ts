import "../../lit-dom";

import type { TemplateResult } from "lit";
import { html, nothing } from "lit";
import type { Ref } from "lit/directives/ref.js";
import { createRef, ref } from "lit/directives/ref.js";
import type { LiveCaptureCandidate } from "../../../capture/export";
import type { PtrThemeMode } from "../../../platform/config";
import type { PtrMessageKey } from "../../../platform/i18n";
import { formatPtrMsg, MESSAGES_EN } from "../../../platform/i18n";
import type { SiteModifier } from "../../../structure/site-rules";
import { mountLitShadow } from "../../lit-render";
import { applyPtrTheme, getSharedPanelCss } from "../../theme";
import type { InspectScanResult } from "../inspect/logic";
import type {
  CapturedVolunteerEntry,
  VolunteerConflict,
  VolunteerScanResult,
} from "../volunteer/logic";
import type { StudioActivityEntry, StudioNodeFilterTab } from "./logic";
import type { ProjectedBox, StudioBoxMode } from "./overlay";
import { renderOverlayBoxes } from "./overlay";
import type { StudioZoomPreset } from "./stage";

const SHELL_ID = "ptr-studio-shell";

const MODIFIER_OPTIONS: readonly SiteModifier[] = [
  "block",
  "inline-atomic",
  "no-spacing",
  "no-opencc",
  "keep-orig",
];

const BOX_OPTIONS: readonly [StudioBoxMode, PtrMessageKey][] = [
  ["all", "studioBoxesAll"],
  ["included", "studioBoxesIncluded"],
  ["excluded", "studioBoxesExcluded"],
  ["off", "studioBoxesOff"],
];

const FILTER_DEFS: readonly [StudioNodeFilterTab, PtrMessageKey][] = [
  ["all", "studioTabAll"],
  ["captured", "studioTabCaptured"],
  ["excluded", "studioTabExcluded"],
  ["manual", "studioTabManual"],
];

export type StudioRightTab = "node" | "dict";
export type StudioBottomTab = "diag" | "record";
export type TranslatorFn = (key: PtrMessageKey) => string;

export interface StudioWorkspaceViewHandlers {
  onApplyDelta: (rawDelta: string) => void;
  onApplyImport: (rawJson: string) => void;
  onBoxModeChange: (mode: StudioBoxMode) => void;
  onClearActivity: () => void;
  onCopyDiag: () => void;
  onCopyDictJson: () => void;
  onCopyNodes: () => void;
  onDownloadDictJson: () => void;
  onExit: () => void;
  onExportAi: () => void;
  onExportNodes: () => void;
  onFilterTabChange: (tab: StudioNodeFilterTab) => void;
  onNextSegment: () => void;
  onOpenSettings: () => void;
  onPrevSegment: () => void;
  onRescan: () => void;
  onResolveAllConflicts: (choice: "keep" | "overwrite") => void;
  onResolveConflict: (id: string, choice: "keep" | "overwrite") => void;
  onResumeApi: () => void;
  onRuleAction: (
    kind: "add" | "remove" | "mod",
    selector: string,
    modifier: SiteModifier
  ) => void;
  onSaveDraft: (translation: string, scope: string) => void;
  onSearchChange: (query: string) => void;
  onSelectBottomTab: (tab: StudioBottomTab) => void;
  onSelectNode: (index: number) => void;
  onSelectRightTab: (tab: StudioRightTab) => void;
  onSuggestScope: () => string;
  onToggleBottomCollapse: () => void;
  onTogglePauseApi: () => void;
  onToggleRecord: () => void;
  onToggleSelectMode: () => void;
  onToggleTranslate: () => void;
  onZoomChange: (zoom: StudioZoomPreset) => void;
}

export interface StudioWorkspaceView {
  destroy: () => void;
  getDeltaText: () => string;
  host: HTMLElement;
  overlayLayer: HTMLElement;
  renderActivity: (
    entries: readonly StudioActivityEntry[],
    recording: boolean
  ) => void;
  renderBottomState: (collapsed: boolean, activeTab: StudioBottomTab) => void;
  renderBreakpoint: (paused: boolean, waiting: boolean) => void;
  renderConflicts: (conflicts: readonly VolunteerConflict[]) => void;
  renderDiagnostics: (scan: InspectScanResult) => void;
  renderDictEntry: (params: {
    entry: CapturedVolunteerEntry | null;
    index: number;
    initialValue: string;
    scan: VolunteerScanResult | null;
    targetLang: string;
  }) => void;
  renderNodes: (params: {
    filtered: readonly LiveCaptureCandidate[];
    filterTab: StudioNodeFilterTab;
    manualElements: ReadonlySet<Element>;
    selectedIndex: number | null;
    totalCount: number;
    capturedCount: number;
  }) => void;
  renderOverlay: (boxes: readonly ProjectedBox[]) => void;
  renderRightTab: (tab: StudioRightTab) => void;
  renderSelectedNode: (
    entry: LiveCaptureCandidate | null,
    suggestedSelector: string
  ) => void;
  renderToolbar: (params: {
    adapterId: string;
    boxMode: StudioBoxMode;
    selectMode: boolean;
    themeMode: PtrThemeMode;
    translated: boolean;
    zoom: StudioZoomPreset;
  }) => void;
  setDeltaText: (rawDelta: string) => void;
  setStatusMessage: (msg: string) => void;
}

interface StudioWorkspaceViewState {
  activity: readonly StudioActivityEntry[];
  adapterId: string;
  bottomCollapsed: boolean;
  bottomTab: StudioBottomTab;
  boxMode: StudioBoxMode;
  bpPaused: boolean;
  bpWaiting: boolean;
  capturedCount: number;
  conflicts: readonly VolunteerConflict[];
  deltaText: string;
  dictEntry: CapturedVolunteerEntry | null;
  dictIndex: number;
  dictScan: VolunteerScanResult | null;
  filteredNodes: readonly LiveCaptureCandidate[];
  filterTab: StudioNodeFilterTab;
  importDrawerOpen: boolean;
  inspectScan: InspectScanResult | null;
  manualElements: ReadonlySet<Element>;
  recording: boolean;
  rightTab: StudioRightTab;
  selectedEntry: LiveCaptureCandidate | null;
  selectedIndex: number | null;
  selectedModifier: SiteModifier;
  selectMode: boolean;
  statusMessage: string;
  targetLang: string;
  totalCount: number;
  translated: boolean;
  zoom: StudioZoomPreset;
}

interface StudioWorkspaceRefs {
  delta: Ref<HTMLTextAreaElement>;
  importText: Ref<HTMLTextAreaElement>;
  modSelect: Ref<HTMLSelectElement>;
  nodeList: Ref<HTMLDivElement>;
  overlay: Ref<HTMLDivElement>;
  scope: Ref<HTMLInputElement>;
  search: Ref<HTMLInputElement>;
  selector: Ref<HTMLInputElement>;
  trans: Ref<HTMLInputElement>;
}

function getWorkspaceCss(): string {
  return `
${getSharedPanelCss()}

:host {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  pointer-events: none;
  display: block;
}

.ptr-studio-shell {
  position: fixed;
  inset: 0;
  pointer-events: none;
  --ptr-bottom-h: 190px;
}

.ptr-studio-shell[data-bottom-collapsed="1"] {
  --ptr-bottom-h: 36px;
}

.ptr-studio-overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}

.ptr-studio-dock {
  position: fixed;
  pointer-events: auto;
  z-index: 2;
  background: var(--us-bg);
  color: var(--us-fg);
  font: var(--us-sans);
  box-sizing: border-box;
  overflow: hidden;
}

.ptr-studio-top {
  top: 0;
  left: 0;
  right: 0;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px;
  background: var(--us-surface);
}

.ptr-studio-left {
  top: 40px;
  left: 0;
  bottom: var(--ptr-bottom-h);
  width: 300px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-radius: 0;
}

.ptr-studio-right {
  top: 40px;
  right: 0;
  bottom: var(--ptr-bottom-h);
  width: 340px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-radius: 0;
}

.ptr-studio-bottom {
  left: 0;
  right: 0;
  bottom: 0;
  height: var(--ptr-bottom-h);
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 10px;
  background: var(--us-surface);
  border-radius: 0;
}

.ptr-studio-bottom-head {
  justify-content: space-between;
}

.ptr-studio-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.ptr-studio-row-nowrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ptr-studio-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ptr-studio-node-row {
  text-align: left;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: var(--us-radius-md);
  background: var(--us-surface);
  color: var(--us-fg);
  cursor: pointer;
  display: grid;
  gap: 3px;
  font: inherit;
}

.ptr-studio-node-row:hover {
  background: var(--us-surface-2);
}

.ptr-studio-node-row[aria-selected="true"] {
  background: var(--us-surface-3);
  box-shadow: inset 3px 0 0 var(--us-accent-bg);
}

.ptr-studio-card {
  padding: 8px;
  border-radius: var(--us-radius-md);
  background: var(--us-surface);
  display: grid;
  gap: 6px;
}

.ptr-studio-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: var(--us-radius-sm);
  background: var(--us-surface-2);
  color: var(--us-fg);
  font-size: 10.5px;
  line-height: 1.3;
}

.ptr-studio-pill-accent {
  background: var(--us-accent-bg);
  color: var(--us-accent-fg);
  font-weight: 600;
}

.ptr-studio-status {
  font-size: 11px;
  color: var(--us-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ptr-studio-hidden {
  display: none !important;
}

.ptr-studio-top-left {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
}

.ptr-studio-top-left .drag-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ptr-studio-top-left .ptr-chip {
  flex: 0 0 auto;
  white-space: nowrap;
}

.ptr-studio-top-actions {
  flex: 0 1 auto;
  min-width: 0;
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
}

.ptr-studio-top-actions::-webkit-scrollbar {
  display: none;
}

.ptr-studio-top-actions .ptr-btn {
  flex: 0 0 auto;
  white-space: nowrap;
  height: 28px;
  padding: 0 11px;
}

select.ptr-input.ptr-studio-select-inline {
  width: auto;
  min-width: 0;
  flex: 0 0 auto;
  height: 28px;
  padding: 0 10px;
  font-size: 11.5px;
  background: var(--us-surface-2);
  --rho: 0.5;
  border-radius: calc(var(--rho) * min(240px, 60px));
  corner-shape: superellipse(2);
}
`.trim();
}

function formatRegion(region: string | string[] | null): string {
  if (Array.isArray(region)) {
    return region.join(", ");
  }
  return region ?? "-";
}

function renderTopToolbar(
  state: StudioWorkspaceViewState,
  hostname: string,
  handlers: StudioWorkspaceViewHandlers,
  t: TranslatorFn
): TemplateResult {
  const zoomOptions: readonly [StudioZoomPreset, string][] = [
    ["fit", t("studioZoomFit")],
    ["50", "50%"],
    ["75", "75%"],
    ["100", "100%"],
  ];
  const summaryText = `${state.capturedCount}/${state.totalCount}`;
  const adapterText = formatPtrMsg(t("hudFramework"), {
    adapterId: state.adapterId,
  });

  return html`
    <header class="ptr-studio-dock ptr-studio-top" data-studio-dock="top">
      <div class="ptr-studio-row-nowrap ptr-studio-top-left">
        <strong class="drag-title"
          >${formatPtrMsg(t("studioTitle"), { host: hostname })}</strong
        >
        <span class="ptr-chip ptr-mono" data-studio-adapter="1"
          >${adapterText}</span
        >
        <span class="ptr-chip ptr-mono" data-studio-summary="1"
          >${summaryText}</span
        >
      </div>
      <div class="ptr-studio-row-nowrap ptr-studio-top-actions">
        <button
          type="button"
          class="ptr-btn ptr-btn-primary"
          data-studio-action="translate"
          @click=${handlers.onToggleTranslate}
        >
          ${t(state.translated ? "restorePage" : "translatePage")}
        </button>
        <button
          type="button"
          class="ptr-btn"
          data-studio-action="rescan"
          @click=${handlers.onRescan}
        >
          ${t("volRescan")}
        </button>
        <button
          type="button"
          class="ptr-btn"
          data-studio-action="select-mode"
          aria-pressed=${state.selectMode ? "true" : "false"}
          @click=${handlers.onToggleSelectMode}
        >
          ${t(state.selectMode ? "studioModeSelect" : "studioModeInteract")}
        </button>
        <select
          class="ptr-input ptr-studio-select-inline"
          data-studio-action="box-mode"
          .value=${state.boxMode}
          @change=${(e: Event) => {
            const nextMode = (e.target as HTMLSelectElement)
              .value as StudioBoxMode;
            state.boxMode = nextMode;
            handlers.onBoxModeChange(nextMode);
          }}
        >
          ${BOX_OPTIONS.map(
            ([val, key]) => html`
              <option value=${val} ?selected=${val === state.boxMode}>
                ${t(key)}
              </option>
            `
          )}
        </select>
        <select
          class="ptr-input ptr-studio-select-inline"
          data-studio-action="zoom"
          .value=${state.zoom}
          @change=${(e: Event) => {
            const nextZoom = (e.target as HTMLSelectElement)
              .value as StudioZoomPreset;
            state.zoom = nextZoom;
            handlers.onZoomChange(nextZoom);
          }}
        >
          ${zoomOptions.map(
            ([val, label]) => html`
              <option value=${val} ?selected=${val === state.zoom}>
                ${label}
              </option>
            `
          )}
        </select>
        <button
          type="button"
          class="ptr-btn"
          data-studio-action="export-nodes"
          @click=${handlers.onExportNodes}
        >
          ${t("studioExportNodes")}
        </button>
        <button
          type="button"
          class="ptr-btn"
          data-studio-action="settings"
          @click=${handlers.onOpenSettings}
        >
          ${t("basicOpenSettings")}
        </button>
        <button
          type="button"
          class="ptr-btn"
          data-studio-action="exit"
          @click=${handlers.onExit}
        >
          ${t("studioExit")}
        </button>
      </div>
    </header>
  `;
}

function renderNodeRow(
  entry: LiveCaptureCandidate,
  state: StudioWorkspaceViewState,
  onSelect: (index: number) => void,
  t: TranslatorFn
): TemplateResult {
  const { candidate, element, index } = entry;
  const isManual = state.manualElements.has(element);
  const isSelected = index === state.selectedIndex;
  const statusLabel = candidate.included
    ? t("studioTabCaptured")
    : (candidate.excludeReason ?? t("studioTabExcluded"));

  return html`
    <button
      type="button"
      class="ptr-studio-node-row"
      data-studio-node-index=${String(index)}
      aria-selected=${isSelected ? "true" : "false"}
      @click=${() => onSelect(index)}
    >
      <div class="ptr-studio-row">
        <span
          class=${
            candidate.included
              ? "ptr-studio-pill ptr-studio-pill-accent"
              : "ptr-studio-pill"
          }
          >${statusLabel}</span
        >
        <span class="ptr-studio-pill ptr-mono">${candidate.classification}</span>
        ${isManual ? html`<span class="ptr-studio-pill">${t("segManual")}</span>` : nothing}
      </div>
      <div class="ptr-mono ptr-muted">${candidate.domPath}</div>
      <div>${candidate.textPreview}</div>
    </button>
  `;
}

function renderLeftDock(
  state: StudioWorkspaceViewState,
  refs: StudioWorkspaceRefs,
  handlers: StudioWorkspaceViewHandlers,
  t: TranslatorFn
): TemplateResult {
  return html`
    <aside class="ptr-studio-dock ptr-studio-left" data-studio-dock="left">
      <input
        type="search"
        class="ptr-input"
        placeholder=${t("studioSearchPlaceholder")}
        data-studio-search="1"
        ${ref(refs.search)}
        @input=${(e: Event) => {
          handlers.onSearchChange((e.target as HTMLInputElement).value);
        }}
      />
      <div class="ptr-studio-row">
        ${FILTER_DEFS.map(
          ([tabId, key]) => html`
            <button
              type="button"
              class="ptr-btn"
              data-studio-filter=${tabId}
              aria-pressed=${state.filterTab === tabId ? "true" : "false"}
              @click=${() => handlers.onFilterTabChange(tabId)}
            >
              ${t(key)}
            </button>
          `
        )}
      </div>
      <div
        class="ptr-studio-scroll"
        data-studio-node-list="1"
        ${ref(refs.nodeList)}
      >
        ${
          state.filteredNodes.length === 0
            ? html`<div class="ptr-muted">${t("studioNoNodes")}</div>`
            : state.filteredNodes.map((entry) =>
                renderNodeRow(entry, state, handlers.onSelectNode, t)
              )
        }
      </div>
    </aside>
  `;
}

function renderNodeMeta(
  entry: LiveCaptureCandidate | null,
  t: TranslatorFn
): TemplateResult {
  if (!entry) {
    return html`<div class="ptr-muted">${t("studioSelectPrompt")}</div>`;
  }

  const { candidate } = entry;
  const statusLabel = candidate.included
    ? t("studioTabCaptured")
    : (candidate.excludeReason ?? t("studioTabExcluded"));
  const styleLine = `${candidate.computedStyleSummary.display} | ${candidate.computedStyleSummary.visibility} | ${candidate.computedStyleSummary.fontFamily}`;

  return html`
    <div class="ptr-studio-row">
      <span
        class=${
          candidate.included
            ? "ptr-studio-pill ptr-studio-pill-accent"
            : "ptr-studio-pill"
        }
        >${statusLabel}</span
      >
      <span class="ptr-studio-pill ptr-mono">${candidate.classification}</span>
      <span class="ptr-studio-pill ptr-mono"
        >${formatRegion(candidate.region)}</span
      >
    </div>
    <div class="code-inline">${candidate.domPath}</div>
    <div class="ptr-mono ptr-muted">${styleLine}</div>
    <div>${candidate.textPreview}</div>
  `;
}

function renderNodePanel(
  state: StudioWorkspaceViewState,
  refs: StudioWorkspaceRefs,
  handlers: StudioWorkspaceViewHandlers,
  t: TranslatorFn,
  onModifierChange: (mod: SiteModifier) => void,
  onDeltaInput: (val: string) => void
): TemplateResult {
  const readSelector = (): string => refs.selector.value?.value ?? "";
  const readMod = (): SiteModifier =>
    (refs.modSelect.value?.value as SiteModifier | undefined) ??
    state.selectedModifier;
  const readDelta = (): string => refs.delta.value?.value ?? state.deltaText;

  return html`
    <div
      class=${
        state.rightTab === "node"
          ? "ptr-studio-scroll"
          : "ptr-studio-scroll ptr-studio-hidden"
      }
      data-studio-panel="node"
    >
      <div class="ptr-studio-card">
        ${renderNodeMeta(state.selectedEntry, t)}
      </div>
      <div class="ptr-studio-card">
        <label class="ptr-muted">${t("studioRuleSelector")}</label>
        <input
          type="text"
          class="ptr-input ptr-mono"
          data-studio-rule-selector="1"
          ${ref(refs.selector)}
        />
        <div class="ptr-studio-row">
          <button
            type="button"
            class="ptr-btn"
            data-studio-action="rule-add"
            @click=${() => handlers.onRuleAction("add", readSelector(), readMod())}
          >
            ${t("studioRuleAdd")}
          </button>
          <button
            type="button"
            class="ptr-btn"
            data-studio-action="rule-remove"
            @click=${() => handlers.onRuleAction("remove", readSelector(), readMod())}
          >
            ${t("studioRuleRemove")}
          </button>
          <button
            type="button"
            class="ptr-btn"
            data-studio-action="rule-mod"
            @click=${() => handlers.onRuleAction("mod", readSelector(), readMod())}
          >
            ${t("studioRuleMod")}
          </button>
          <select
            class="ptr-input ptr-studio-select-inline"
            data-studio-rule-mod-select="1"
            ${ref(refs.modSelect)}
            .value=${state.selectedModifier}
            @change=${(e: Event) => {
              onModifierChange(
                (e.target as HTMLSelectElement).value as SiteModifier
              );
            }}
          >
            ${MODIFIER_OPTIONS.map(
              (mod) => html`
                <option value=${mod} ?selected=${mod === state.selectedModifier}>
                  ${mod}
                </option>
              `
            )}
          </select>
        </div>
        <label class="ptr-muted">${t("studioSiteDeltas")}</label>
        <textarea
          rows="4"
          class="ptr-input"
          data-studio-delta-textarea="1"
          ${ref(refs.delta)}
          @input=${(e: Event) => {
            onDeltaInput((e.target as HTMLTextAreaElement).value);
          }}
        ></textarea>
        <button
          type="button"
          class="ptr-btn ptr-btn-primary"
          data-studio-action="rule-apply"
          @click=${() => handlers.onApplyDelta(readDelta())}
        >
          ${t("studioRuleApply")}
        </button>
      </div>
    </div>
  `;
}

function renderConflicts(
  conflicts: readonly VolunteerConflict[],
  handlers: StudioWorkspaceViewHandlers,
  t: TranslatorFn
): TemplateResult {
  const cls =
    conflicts.length === 0
      ? "ptr-studio-card ptr-studio-hidden"
      : "ptr-studio-card";

  return html`
    <div class=${cls} data-studio-dict="conflicts">
      ${
        conflicts.length === 0
          ? nothing
          : html`
            <div class="ptr-studio-row">
              <strong
                >${formatPtrMsg(t("volConflictsHeader"), {
                  count: conflicts.length,
                })}</strong
              >
              <button
                type="button"
                class="ptr-btn"
                data-studio-conflict-keep-all="1"
                @click=${() => handlers.onResolveAllConflicts("keep")}
              >
                ${t("volConflictKeepAll")}
              </button>
              <button
                type="button"
                class="ptr-btn"
                data-studio-conflict-overwrite-all="1"
                @click=${() => handlers.onResolveAllConflicts("overwrite")}
              >
                ${t("volConflictOverwriteAll")}
              </button>
            </div>
            ${conflicts.map(
              (c) => html`
                <div class="ptr-studio-card">
                  <div class="code-inline">${c.key}</div>
                  <div>${`${t("volConflictExisting")}: ${c.existing}`}</div>
                  <div>${`${t("volConflictImported")}: ${c.imported}`}</div>
                  <div class="ptr-studio-row">
                    <button
                      type="button"
                      class="ptr-btn"
                      data-studio-conflict-keep=${c.id}
                      @click=${() => handlers.onResolveConflict(c.id, "keep")}
                    >
                      ${t("volConflictKeep")}
                    </button>
                    <button
                      type="button"
                      class="ptr-btn"
                      data-studio-conflict-overwrite=${c.id}
                      @click=${() =>
                        handlers.onResolveConflict(c.id, "overwrite")}
                    >
                      ${t("volConflictOverwrite")}
                    </button>
                  </div>
                </div>
              `
            )}
          `
      }
    </div>
  `;
}

function renderDictPanel(
  state: StudioWorkspaceViewState,
  refs: StudioWorkspaceRefs,
  hostname: string,
  handlers: StudioWorkspaceViewHandlers,
  t: TranslatorFn,
  onSetImportDrawerOpen: (open: boolean) => void
): TemplateResult {
  const total = state.dictScan?.entries.length ?? 0;
  const entry = state.dictEntry;
  const counterText = total > 0 ? `${state.dictIndex + 1} / ${total}` : "0 / 0";
  let kindLabel = "-";
  if (entry) {
    kindLabel = t(
      entry.kind === "dynamic" ? "volBadgeDynamic" : "volBadgeStatic"
    );
  }
  const sourceText = entry ? entry.key : t("volEmpty");
  const transPlaceholder = formatPtrMsg(t("volTransPlaceholder"), {
    lang: state.targetLang,
  });

  return html`
    <div
      class=${
        state.rightTab === "dict"
          ? "ptr-studio-scroll"
          : "ptr-studio-scroll ptr-studio-hidden"
      }
      data-studio-panel="dict"
    >
      <div class="ptr-studio-row">
        <button
          type="button"
          class="ptr-btn"
          data-studio-dict="prev"
          @click=${handlers.onPrevSegment}
        >
          ${t("volPrev")}
        </button>
        <button
          type="button"
          class="ptr-btn"
          data-studio-dict="next"
          @click=${handlers.onNextSegment}
        >
          ${t("volNext")}
        </button>
        <span class="ptr-chip ptr-mono">${counterText}</span>
        <span class="ptr-studio-pill">${kindLabel}</span>
      </div>
      <div class="code-inline">${sourceText}</div>
      <div class="ptr-studio-row-nowrap">
        <input
          type="text"
          class="ptr-input ptr-mono"
          placeholder=${t("volScopePlaceholder")}
          data-studio-dict="scope"
          ${ref(refs.scope)}
        />
        <button
          type="button"
          class="ptr-btn"
          data-studio-dict="suggest"
          @click=${() => {
            const suggested = handlers.onSuggestScope();
            if (suggested && refs.scope.value) {
              refs.scope.value.value = suggested;
            }
          }}
        >
          ${t("volSuggest")}
        </button>
      </div>
      <input
        type="text"
        class="ptr-input"
        placeholder=${transPlaceholder}
        data-studio-dict="trans"
        ${ref(refs.trans)}
      />
      <button
        type="button"
        class="ptr-btn ptr-btn-primary"
        data-studio-dict="save"
        @click=${() => {
          handlers.onSaveDraft(
            refs.trans.value?.value ?? "",
            refs.scope.value?.value ?? ""
          );
        }}
      >
        ${t("volSave")}
      </button>
      <div class="ptr-studio-row">
        <button
          type="button"
          class="ptr-btn"
          data-studio-dict="copy-json"
          @click=${handlers.onCopyDictJson}
        >
          ${t("volCopyJson")}
        </button>
        <button
          type="button"
          class="ptr-btn"
          data-studio-dict="download"
          @click=${handlers.onDownloadDictJson}
        >
          ${formatPtrMsg(t("volDownload"), { host: hostname })}
        </button>
        <button
          type="button"
          class="ptr-btn"
          data-studio-dict="export-ai"
          @click=${handlers.onExportAi}
        >
          ${t("volExportAi")}
        </button>
        <button
          type="button"
          class="ptr-btn"
          data-studio-dict="import-ai"
          @click=${() => onSetImportDrawerOpen(!state.importDrawerOpen)}
        >
          ${t("volImportAi")}
        </button>
      </div>
      <div
        class=${
          state.importDrawerOpen
            ? "ptr-studio-card"
            : "ptr-studio-card ptr-studio-hidden"
        }
      >
        <textarea
          rows="3"
          class="ptr-input"
          placeholder=${t("volImportPlaceholder")}
          data-studio-dict="import-text"
          ${ref(refs.importText)}
        ></textarea>
        <div class="ptr-studio-row">
          <button
            type="button"
            class="ptr-btn ptr-btn-primary"
            data-studio-dict="import-apply"
            @click=${() => {
              handlers.onApplyImport(refs.importText.value?.value ?? "");
            }}
          >
            ${t("volImportApply")}
          </button>
          <button
            type="button"
            class="ptr-btn"
            data-studio-dict="import-cancel"
            @click=${() => onSetImportDrawerOpen(false)}
          >
            ${t("volImportCancel")}
          </button>
        </div>
      </div>
      ${renderConflicts(state.conflicts, handlers, t)}
    </div>
  `;
}

function renderRightDock(
  state: StudioWorkspaceViewState,
  refs: StudioWorkspaceRefs,
  hostname: string,
  handlers: StudioWorkspaceViewHandlers,
  t: TranslatorFn,
  actions: {
    onDeltaInput: (val: string) => void;
    onModifierChange: (mod: SiteModifier) => void;
    onSetImportDrawerOpen: (open: boolean) => void;
  }
): TemplateResult {
  return html`
    <aside class="ptr-studio-dock ptr-studio-right" data-studio-dock="right">
      <div class="ptr-studio-row">
        <button
          type="button"
          class="ptr-btn"
          data-studio-right-tab="node"
          aria-pressed=${state.rightTab === "node" ? "true" : "false"}
          @click=${() => handlers.onSelectRightTab("node")}
        >
          ${t("studioInspectorNode")}
        </button>
        <button
          type="button"
          class="ptr-btn"
          data-studio-right-tab="dict"
          aria-pressed=${state.rightTab === "dict" ? "true" : "false"}
          @click=${() => handlers.onSelectRightTab("dict")}
        >
          ${t("studioInspectorDict")}
        </button>
      </div>
      ${renderNodePanel(
        state,
        refs,
        handlers,
        t,
        actions.onModifierChange,
        actions.onDeltaInput
      )}
      ${renderDictPanel(
        state,
        refs,
        hostname,
        handlers,
        t,
        actions.onSetImportDrawerOpen
      )}
      <div class="ptr-studio-status" data-studio-status="1">
        ${state.statusMessage}
      </div>
    </aside>
  `;
}

function renderDiagPanel(
  state: StudioWorkspaceViewState,
  handlers: StudioWorkspaceViewHandlers,
  t: TranslatorFn
): TemplateResult {
  const scan = state.inspectScan;
  const items: readonly [string, number][] = scan
    ? [
        [t("mSegments"), scan.counts.total],
        [t("volStatStatic"), scan.counts.static],
        [t("volStatDynamic"), scan.counts.dynamic],
        [t("volStatHits"), scan.counts.manual],
        [t("mRouteApi"), scan.metrics.routing.api],
        [t("mRouteOpencc"), scan.metrics.routing.opencc],
        [t("mRouteSkip"), scan.metrics.routing.skip],
        [t("mExcluded"), scan.metrics.excludedCount],
      ]
    : [];
  const hidden = state.bottomCollapsed || state.bottomTab !== "diag";

  return html`
    <div
      class=${hidden ? "ptr-studio-scroll ptr-studio-hidden" : "ptr-studio-scroll"}
      data-studio-panel="diag"
    >
      <div class="ptr-studio-row">
        ${items.map(
          ([label, value]) => html`
            <span class="ptr-chip ptr-mono">${`${label}: ${value}`}</span>
          `
        )}
      </div>
      <div class="ptr-studio-row">
        <button
          type="button"
          class="ptr-btn"
          data-studio-action="copy-diag"
          @click=${handlers.onCopyDiag}
        >
          ${t("btnCopyDiag")}
        </button>
        <button
          type="button"
          class="ptr-btn"
          data-studio-action="copy-nodes"
          @click=${handlers.onCopyNodes}
        >
          ${t("studioCopyNodes")}
        </button>
        <button
          type="button"
          class="ptr-btn"
          data-studio-action="export-nodes-bottom"
          @click=${handlers.onExportNodes}
        >
          ${t("studioExportNodes")}
        </button>
      </div>
    </div>
  `;
}

function renderRecordPanel(
  state: StudioWorkspaceViewState,
  handlers: StudioWorkspaceViewHandlers,
  t: TranslatorFn
): TemplateResult {
  const hidden = state.bottomCollapsed || state.bottomTab !== "record";
  const bpActive = state.bpPaused || state.bpWaiting;
  const bpText = bpActive
    ? formatPtrMsg(t("studioBpWaiting"), { count: state.bpWaiting ? 1 : 0 })
    : "";

  return html`
    <div
      class=${hidden ? "ptr-studio-scroll ptr-studio-hidden" : "ptr-studio-scroll"}
      data-studio-panel="record"
    >
      <div class="ptr-studio-row">
        <button
          type="button"
          class="ptr-btn"
          data-studio-action="record-toggle"
          aria-pressed=${state.recording ? "true" : "false"}
          @click=${handlers.onToggleRecord}
        >
          ${t(state.recording ? "studioRecordStop" : "studioRecordStart")}
        </button>
        <button
          type="button"
          class="ptr-btn"
          data-studio-action="record-clear"
          @click=${handlers.onClearActivity}
        >
          ${t("studioRecordClear")}
        </button>
        <button
          type="button"
          class="ptr-btn"
          data-studio-action="bp-pause"
          aria-pressed=${state.bpPaused ? "true" : "false"}
          @click=${handlers.onTogglePauseApi}
        >
          ${t("studioBpPauseApi")}
        </button>
        <button
          type="button"
          class="ptr-btn"
          data-studio-action="bp-resume"
          ?disabled=${!bpActive}
          @click=${handlers.onResumeApi}
        >
          ${t("studioBpResume")}
        </button>
        <span class="ptr-studio-status">${bpText}</span>
      </div>
      <div class="ptr-studio-scroll" data-studio-activity-list="1">
        ${
          state.activity.length === 0
            ? html`<div class="ptr-muted">${t("studioRecordEmpty")}</div>`
            : state.activity.map(
                (entry) => html`
                <div class="ptr-mono">
                  ${`[${entry.timestamp}] (${entry.kind}) ${entry.summary}`}
                </div>
              `
              )
        }
      </div>
    </div>
  `;
}

function renderBottomDock(
  state: StudioWorkspaceViewState,
  handlers: StudioWorkspaceViewHandlers,
  t: TranslatorFn
): TemplateResult {
  return html`
    <footer class="ptr-studio-dock ptr-studio-bottom" data-studio-dock="bottom">
      <div class="ptr-studio-row ptr-studio-bottom-head">
        <div class="ptr-studio-row">
          <button
            type="button"
            class="ptr-btn"
            data-studio-bottom-tab="diag"
            aria-pressed=${state.bottomTab === "diag" ? "true" : "false"}
            @click=${() => handlers.onSelectBottomTab("diag")}
          >
            ${t("studioBottomDiag")}
          </button>
          <button
            type="button"
            class="ptr-btn"
            data-studio-bottom-tab="record"
            aria-pressed=${state.bottomTab === "record" ? "true" : "false"}
            @click=${() => handlers.onSelectBottomTab("record")}
          >
            ${t("studioBottomRecord")}
          </button>
        </div>
        <button
          type="button"
          class="ptr-btn"
          data-studio-action="collapse-bottom"
          @click=${handlers.onToggleBottomCollapse}
        >
          ${t(state.bottomCollapsed ? "studioExpand" : "studioCollapse")}
        </button>
      </div>
      ${renderDiagPanel(state, handlers, t)}
      ${renderRecordPanel(state, handlers, t)}
    </footer>
  `;
}

/** Mounts the Industrial Studio Workspace Shadow DOM shell on doc.documentElement. */
export function mountStudioWorkspaceView(
  doc: Document,
  hostname: string,
  handlers: StudioWorkspaceViewHandlers,
  t: TranslatorFn = (key) => MESSAGES_EN[key]
): StudioWorkspaceView {
  const mounted = mountLitShadow({
    css: getWorkspaceCss(),
    doc,
    hostId: SHELL_ID,
    mountTarget: doc.documentElement,
    uiTag: "ptr",
  });

  const refs: StudioWorkspaceRefs = {
    delta: createRef<HTMLTextAreaElement>(),
    importText: createRef<HTMLTextAreaElement>(),
    modSelect: createRef<HTMLSelectElement>(),
    nodeList: createRef<HTMLDivElement>(),
    overlay: createRef<HTMLDivElement>(),
    scope: createRef<HTMLInputElement>(),
    search: createRef<HTMLInputElement>(),
    selector: createRef<HTMLInputElement>(),
    trans: createRef<HTMLInputElement>(),
  };

  const state: StudioWorkspaceViewState = {
    activity: [],
    adapterId: "generic",
    bottomCollapsed: false,
    bottomTab: "diag",
    boxMode: "all",
    bpPaused: false,
    bpWaiting: false,
    capturedCount: 0,
    conflicts: [],
    deltaText: "",
    dictEntry: null,
    dictIndex: 0,
    dictScan: null,
    filteredNodes: [],
    filterTab: "all",
    importDrawerOpen: false,
    inspectScan: null,
    manualElements: new Set<Element>(),
    recording: false,
    rightTab: "node",
    selectedEntry: null,
    selectedIndex: null,
    selectedModifier: "block",
    selectMode: true,
    statusMessage: "",
    targetLang: "zh-Hant-TW",
    totalCount: 0,
    translated: false,
    zoom: "fit",
  };

  const renderNow = (): void => {
    mounted.render(html`
      <div
        class="ptr-studio-shell"
        data-bottom-collapsed=${state.bottomCollapsed ? "1" : "0"}
      >
        <div
          class="ptr-studio-overlay"
          data-studio-overlay="1"
          ${ref(refs.overlay)}
        ></div>
        ${renderTopToolbar(state, hostname, handlers, t)}
        ${renderLeftDock(state, refs, handlers, t)}
        ${renderRightDock(state, refs, hostname, handlers, t, {
          onDeltaInput: (val) => {
            state.deltaText = val;
          },
          onModifierChange: (mod) => {
            state.selectedModifier = mod;
          },
          onSetImportDrawerOpen: (open) => {
            state.importDrawerOpen = open;
            renderNow();
          },
        })}
        ${renderBottomDock(state, handlers, t)}
      </div>
    `);
  };

  renderNow();

  const overlayLayer = refs.overlay.value;
  if (!overlayLayer) {
    throw new Error("Expected Studio overlay layer");
  }

  return {
    host: mounted.host,
    overlayLayer,
    destroy: mounted.destroy,
    getDeltaText: () => refs.delta.value?.value ?? state.deltaText,
    setDeltaText: (rawDelta: string) => {
      state.deltaText = rawDelta;
      if (refs.delta.value) {
        refs.delta.value.value = rawDelta;
      }
    },
    setStatusMessage: (msg: string) => {
      state.statusMessage = msg;
      renderNow();
    },
    renderToolbar: ({
      adapterId,
      boxMode,
      selectMode,
      themeMode,
      translated,
      zoom,
    }) => {
      applyPtrTheme(mounted.host, themeMode);
      state.adapterId = adapterId;
      state.boxMode = boxMode;
      state.selectMode = selectMode;
      state.translated = translated;
      state.zoom = zoom;
      renderNow();
    },
    renderNodes: ({
      filtered,
      filterTab,
      manualElements,
      selectedIndex,
      totalCount,
      capturedCount,
    }) => {
      const prevScrollTop = refs.nodeList.value?.scrollTop ?? 0;
      state.filteredNodes = filtered;
      state.filterTab = filterTab;
      state.manualElements = manualElements;
      state.selectedIndex = selectedIndex;
      state.totalCount = totalCount;
      state.capturedCount = capturedCount;
      renderNow();
      if (filtered.length > 0 && refs.nodeList.value) {
        refs.nodeList.value.scrollTop = prevScrollTop;
      }
    },
    renderSelectedNode: (entry, suggestedSelector) => {
      state.selectedEntry = entry;
      renderNow();
      if (refs.selector.value) {
        refs.selector.value.value = entry ? suggestedSelector : "";
      }
    },
    renderRightTab: (tab) => {
      state.rightTab = tab;
      renderNow();
    },
    renderDictEntry: ({ entry, index, initialValue, scan, targetLang }) => {
      state.dictEntry = entry;
      state.dictIndex = index;
      state.dictScan = scan;
      state.targetLang = targetLang;
      renderNow();
      if (refs.scope.value) {
        refs.scope.value.value = entry ? (entry.matchedScope ?? "") : "";
      }
      if (refs.trans.value) {
        refs.trans.value.value = entry ? initialValue : "";
      }
    },
    renderConflicts: (conflicts) => {
      state.conflicts = conflicts;
      renderNow();
    },
    renderBottomState: (collapsed, activeTab) => {
      state.bottomCollapsed = collapsed;
      state.bottomTab = activeTab;
      renderNow();
    },
    renderDiagnostics: (scan) => {
      state.inspectScan = scan;
      renderNow();
    },
    renderActivity: (entries, recording) => {
      state.activity = entries;
      state.recording = recording;
      renderNow();
    },
    renderBreakpoint: (paused, waiting) => {
      state.bpPaused = paused;
      state.bpWaiting = waiting;
      renderNow();
    },
    renderOverlay: (boxes) => {
      renderOverlayBoxes(overlayLayer, doc, boxes);
    },
  };
}
