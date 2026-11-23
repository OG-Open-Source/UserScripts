import { markUiRoot } from "@userscripts/shared";
import type { LiveCaptureCandidate } from "../../../capture/export";
import type { PtrThemeMode } from "../../../platform/config";
import type { PtrMessageKey } from "../../../platform/i18n";
import { formatPtrMsg, MESSAGES_EN } from "../../../platform/i18n";
import type { SiteModifier } from "../../../structure/site-rules";
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

export type StudioRightTab = "node" | "dict";
export type StudioBottomTab = "diag" | "record";

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

.ptr-studio-select-inline {
  width: auto;
  min-width: 0;
  padding: 4px 8px;
  font-size: 11.5px;
}
`.trim();
}

function makeButton(
  doc: Document,
  label: string,
  attrs: Record<string, string> = {},
  primary = false
): HTMLButtonElement {
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = primary ? "ptr-btn ptr-btn-primary" : "ptr-btn";
  btn.textContent = label;
  for (const [key, val] of Object.entries(attrs)) {
    btn.setAttribute(key, val);
  }
  return btn;
}

function formatRegion(region: string | string[] | null): string {
  if (Array.isArray(region)) {
    return region.join(", ");
  }
  return region ?? "-";
}

function buildNodeRow(
  doc: Document,
  entry: LiveCaptureCandidate,
  options: {
    isManual: boolean;
    isSelected: boolean;
    onSelect: (index: number) => void;
    t: (key: PtrMessageKey) => string;
  }
): HTMLButtonElement {
  const { candidate, index } = entry;
  const { isManual, isSelected, onSelect, t } = options;

  const row = doc.createElement("button");
  row.type = "button";
  row.className = "ptr-studio-node-row";
  row.setAttribute("data-studio-node-index", String(index));
  row.setAttribute("aria-selected", isSelected ? "true" : "false");

  const header = doc.createElement("div");
  header.className = "ptr-studio-row";

  const statusPill = doc.createElement("span");
  statusPill.className = candidate.included
    ? "ptr-studio-pill ptr-studio-pill-accent"
    : "ptr-studio-pill";
  statusPill.textContent = candidate.included
    ? t("studioTabCaptured")
    : (candidate.excludeReason ?? t("studioTabExcluded"));

  const classPill = doc.createElement("span");
  classPill.className = "ptr-studio-pill ptr-mono";
  classPill.textContent = candidate.classification;

  header.append(statusPill, classPill);
  if (isManual) {
    const manualPill = doc.createElement("span");
    manualPill.className = "ptr-studio-pill";
    manualPill.textContent = t("segManual");
    header.append(manualPill);
  }

  const pathEl = doc.createElement("div");
  pathEl.className = "ptr-mono ptr-muted";
  pathEl.textContent = candidate.domPath;

  const previewEl = doc.createElement("div");
  previewEl.textContent = candidate.textPreview;

  row.append(header, pathEl, previewEl);
  row.addEventListener("click", () => onSelect(index));
  return row;
}

/** Mounts the Industrial Studio Workspace Shadow DOM shell on doc.documentElement. */
export function mountStudioWorkspaceView(
  doc: Document,
  hostname: string,
  handlers: StudioWorkspaceViewHandlers,
  t: (key: PtrMessageKey) => string = (key) => MESSAGES_EN[key]
): StudioWorkspaceView {
  doc.querySelector(`#${SHELL_ID}`)?.remove();

  const host = doc.createElement("div");
  host.id = SHELL_ID;
  markUiRoot(host, "ptr");

  const shadow = host.attachShadow({ mode: "open" });
  const styleEl = doc.createElement("style");
  styleEl.textContent = getWorkspaceCss();

  const shell = doc.createElement("div");
  shell.className = "ptr-studio-shell";

  const overlayLayer = doc.createElement("div");
  overlayLayer.className = "ptr-studio-overlay";
  overlayLayer.setAttribute("data-studio-overlay", "1");

  // --- Top Toolbar ---
  const topDock = doc.createElement("header");
  topDock.className = "ptr-studio-dock ptr-studio-top";
  topDock.setAttribute("data-studio-dock", "top");

  const topLeft = doc.createElement("div");
  topLeft.className = "ptr-studio-row-nowrap";
  const titleEl = doc.createElement("strong");
  titleEl.className = "drag-title";
  titleEl.textContent = formatPtrMsg(t("studioTitle"), { host: hostname });
  const adapterBadge = doc.createElement("span");
  adapterBadge.className = "ptr-chip ptr-mono";
  adapterBadge.setAttribute("data-studio-adapter", "1");
  const summaryChip = doc.createElement("span");
  summaryChip.className = "ptr-chip ptr-mono";
  summaryChip.setAttribute("data-studio-summary", "1");
  topLeft.append(titleEl, adapterBadge, summaryChip);

  const topActions = doc.createElement("div");
  topActions.className = "ptr-studio-row-nowrap";
  const translateBtn = makeButton(
    doc,
    t("translatePage"),
    { "data-studio-action": "translate" },
    true
  );
  translateBtn.addEventListener("click", handlers.onToggleTranslate);

  const rescanBtn = makeButton(doc, t("volRescan"), {
    "data-studio-action": "rescan",
  });
  rescanBtn.addEventListener("click", handlers.onRescan);

  const selectModeBtn = makeButton(doc, t("studioModeSelect"), {
    "data-studio-action": "select-mode",
    "aria-pressed": "true",
  });
  selectModeBtn.addEventListener("click", handlers.onToggleSelectMode);

  const boxSelect = doc.createElement("select");
  boxSelect.className = "ptr-input ptr-studio-select-inline";
  boxSelect.setAttribute("data-studio-action", "box-mode");
  const boxOptions: [StudioBoxMode, PtrMessageKey][] = [
    ["all", "studioBoxesAll"],
    ["included", "studioBoxesIncluded"],
    ["excluded", "studioBoxesExcluded"],
    ["off", "studioBoxesOff"],
  ];
  for (const [val, key] of boxOptions) {
    const opt = doc.createElement("option");
    opt.value = val;
    opt.textContent = t(key);
    boxSelect.append(opt);
  }
  boxSelect.addEventListener("change", () => {
    handlers.onBoxModeChange(boxSelect.value as StudioBoxMode);
  });

  const zoomSelect = doc.createElement("select");
  zoomSelect.className = "ptr-input ptr-studio-select-inline";
  zoomSelect.setAttribute("data-studio-action", "zoom");
  const zoomOptions: [StudioZoomPreset, string][] = [
    ["fit", t("studioZoomFit")],
    ["50", "50%"],
    ["75", "75%"],
    ["100", "100%"],
  ];
  for (const [val, label] of zoomOptions) {
    const opt = doc.createElement("option");
    opt.value = val;
    opt.textContent = label;
    zoomSelect.append(opt);
  }
  zoomSelect.addEventListener("change", () => {
    handlers.onZoomChange(zoomSelect.value as StudioZoomPreset);
  });

  const exportNodesBtn = makeButton(doc, t("studioExportNodes"), {
    "data-studio-action": "export-nodes",
  });
  exportNodesBtn.addEventListener("click", handlers.onExportNodes);

  const settingsBtn = makeButton(doc, t("basicOpenSettings"), {
    "data-studio-action": "settings",
  });
  settingsBtn.addEventListener("click", handlers.onOpenSettings);

  const exitBtn = makeButton(doc, t("studioExit"), {
    "data-studio-action": "exit",
  });
  exitBtn.addEventListener("click", handlers.onExit);

  topActions.append(
    translateBtn,
    rescanBtn,
    selectModeBtn,
    boxSelect,
    zoomSelect,
    exportNodesBtn,
    settingsBtn,
    exitBtn
  );
  topDock.append(topLeft, topActions);

  // --- Left Dock: Raw Nodes Explorer ---
  const leftDock = doc.createElement("aside");
  leftDock.className = "ptr-studio-dock ptr-studio-left";
  leftDock.setAttribute("data-studio-dock", "left");

  const searchInput = doc.createElement("input");
  searchInput.type = "search";
  searchInput.className = "ptr-input";
  searchInput.placeholder = t("studioSearchPlaceholder");
  searchInput.setAttribute("data-studio-search", "1");
  searchInput.addEventListener("input", () => {
    handlers.onSearchChange(searchInput.value);
  });

  const filterRow = doc.createElement("div");
  filterRow.className = "ptr-studio-row";
  const filterTabs = new Map<StudioNodeFilterTab, HTMLButtonElement>();
  const filterDefs: [StudioNodeFilterTab, PtrMessageKey][] = [
    ["all", "studioTabAll"],
    ["captured", "studioTabCaptured"],
    ["excluded", "studioTabExcluded"],
    ["manual", "studioTabManual"],
  ];
  for (const [tabId, key] of filterDefs) {
    const tabBtn = makeButton(doc, t(key), {
      "data-studio-filter": tabId,
      "aria-pressed": tabId === "all" ? "true" : "false",
    });
    tabBtn.addEventListener("click", () => handlers.onFilterTabChange(tabId));
    filterTabs.set(tabId, tabBtn);
    filterRow.append(tabBtn);
  }

  const nodeList = doc.createElement("div");
  nodeList.className = "ptr-studio-scroll";
  nodeList.setAttribute("data-studio-node-list", "1");

  leftDock.append(searchInput, filterRow, nodeList);

  // --- Right Dock: Node & Rules + Site Dict ---
  const rightDock = doc.createElement("aside");
  rightDock.className = "ptr-studio-dock ptr-studio-right";
  rightDock.setAttribute("data-studio-dock", "right");

  const rightTabRow = doc.createElement("div");
  rightTabRow.className = "ptr-studio-row";
  const nodeTabBtn = makeButton(doc, t("studioInspectorNode"), {
    "data-studio-right-tab": "node",
    "aria-pressed": "true",
  });
  nodeTabBtn.addEventListener("click", () => handlers.onSelectRightTab("node"));

  const dictTabBtn = makeButton(doc, t("studioInspectorDict"), {
    "data-studio-right-tab": "dict",
    "aria-pressed": "false",
  });
  dictTabBtn.addEventListener("click", () => handlers.onSelectRightTab("dict"));
  rightTabRow.append(nodeTabBtn, dictTabBtn);

  // Right Panel 1: Node & Rules
  const nodePanel = doc.createElement("div");
  nodePanel.className = "ptr-studio-scroll";
  nodePanel.setAttribute("data-studio-panel", "node");

  const nodeMetaCard = doc.createElement("div");
  nodeMetaCard.className = "ptr-studio-card";
  const nodeMetaPrompt = doc.createElement("div");
  nodeMetaPrompt.className = "ptr-muted";
  nodeMetaPrompt.textContent = t("studioSelectPrompt");
  nodeMetaCard.append(nodeMetaPrompt);

  const ruleCard = doc.createElement("div");
  ruleCard.className = "ptr-studio-card";
  const selectorLabel = doc.createElement("label");
  selectorLabel.className = "ptr-muted";
  selectorLabel.textContent = t("studioRuleSelector");

  const selectorInput = doc.createElement("input");
  selectorInput.type = "text";
  selectorInput.className = "ptr-input ptr-mono";
  selectorInput.setAttribute("data-studio-rule-selector", "1");

  const modSelect = doc.createElement("select");
  modSelect.className = "ptr-input ptr-studio-select-inline";
  modSelect.setAttribute("data-studio-rule-mod-select", "1");
  for (const mod of MODIFIER_OPTIONS) {
    const opt = doc.createElement("option");
    opt.value = mod;
    opt.textContent = mod;
    modSelect.append(opt);
  }

  const ruleBtnRow = doc.createElement("div");
  ruleBtnRow.className = "ptr-studio-row";
  const addRuleBtn = makeButton(doc, t("studioRuleAdd"), {
    "data-studio-action": "rule-add",
  });
  addRuleBtn.addEventListener("click", () => {
    handlers.onRuleAction(
      "add",
      selectorInput.value,
      modSelect.value as SiteModifier
    );
  });

  const removeRuleBtn = makeButton(doc, t("studioRuleRemove"), {
    "data-studio-action": "rule-remove",
  });
  removeRuleBtn.addEventListener("click", () => {
    handlers.onRuleAction(
      "remove",
      selectorInput.value,
      modSelect.value as SiteModifier
    );
  });

  const modRuleBtn = makeButton(doc, t("studioRuleMod"), {
    "data-studio-action": "rule-mod",
  });
  modRuleBtn.addEventListener("click", () => {
    handlers.onRuleAction(
      "mod",
      selectorInput.value,
      modSelect.value as SiteModifier
    );
  });
  ruleBtnRow.append(addRuleBtn, removeRuleBtn, modRuleBtn, modSelect);

  const deltaLabel = doc.createElement("label");
  deltaLabel.className = "ptr-muted";
  deltaLabel.textContent = t("studioSiteDeltas");

  const deltaTextarea = doc.createElement("textarea");
  deltaTextarea.rows = 4;
  deltaTextarea.className = "ptr-input";
  deltaTextarea.setAttribute("data-studio-delta-textarea", "1");

  const applyDeltaBtn = makeButton(
    doc,
    t("studioRuleApply"),
    { "data-studio-action": "rule-apply" },
    true
  );
  applyDeltaBtn.addEventListener("click", () => {
    handlers.onApplyDelta(deltaTextarea.value);
  });

  ruleCard.append(
    selectorLabel,
    selectorInput,
    ruleBtnRow,
    deltaLabel,
    deltaTextarea,
    applyDeltaBtn
  );
  nodePanel.append(nodeMetaCard, ruleCard);

  // Right Panel 2: Site Dict
  const dictPanel = doc.createElement("div");
  dictPanel.className = "ptr-studio-scroll ptr-studio-hidden";
  dictPanel.setAttribute("data-studio-panel", "dict");

  const dictNavRow = doc.createElement("div");
  dictNavRow.className = "ptr-studio-row";
  const prevSegBtn = makeButton(doc, t("volPrev"), {
    "data-studio-dict": "prev",
  });
  prevSegBtn.addEventListener("click", handlers.onPrevSegment);
  const nextSegBtn = makeButton(doc, t("volNext"), {
    "data-studio-dict": "next",
  });
  nextSegBtn.addEventListener("click", handlers.onNextSegment);
  const segCounter = doc.createElement("span");
  segCounter.className = "ptr-chip ptr-mono";
  const segKindBadge = doc.createElement("span");
  segKindBadge.className = "ptr-studio-pill";
  dictNavRow.append(prevSegBtn, nextSegBtn, segCounter, segKindBadge);

  const dictSourceBox = doc.createElement("div");
  dictSourceBox.className = "code-inline";

  const scopeRow = doc.createElement("div");
  scopeRow.className = "ptr-studio-row-nowrap";
  const scopeInput = doc.createElement("input");
  scopeInput.type = "text";
  scopeInput.className = "ptr-input ptr-mono";
  scopeInput.placeholder = t("volScopePlaceholder");
  scopeInput.setAttribute("data-studio-dict", "scope");
  const suggestScopeBtn = makeButton(doc, t("volSuggest"), {
    "data-studio-dict": "suggest",
  });
  suggestScopeBtn.addEventListener("click", () => {
    const suggested = handlers.onSuggestScope();
    if (suggested) {
      scopeInput.value = suggested;
    }
  });
  scopeRow.append(scopeInput, suggestScopeBtn);

  const transInput = doc.createElement("input");
  transInput.type = "text";
  transInput.className = "ptr-input";
  transInput.setAttribute("data-studio-dict", "trans");

  const saveDraftBtn = makeButton(
    doc,
    t("volSave"),
    { "data-studio-dict": "save" },
    true
  );
  saveDraftBtn.addEventListener("click", () => {
    handlers.onSaveDraft(transInput.value, scopeInput.value);
  });

  const dictActionsRow = doc.createElement("div");
  dictActionsRow.className = "ptr-studio-row";
  const copyDictBtn = makeButton(doc, t("volCopyJson"), {
    "data-studio-dict": "copy-json",
  });
  copyDictBtn.addEventListener("click", handlers.onCopyDictJson);

  const downloadDictBtn = makeButton(
    doc,
    formatPtrMsg(t("volDownload"), { host: hostname }),
    { "data-studio-dict": "download" }
  );
  downloadDictBtn.addEventListener("click", handlers.onDownloadDictJson);

  const exportAiBtn = makeButton(doc, t("volExportAi"), {
    "data-studio-dict": "export-ai",
  });
  exportAiBtn.addEventListener("click", handlers.onExportAi);

  const importAiBtn = makeButton(doc, t("volImportAi"), {
    "data-studio-dict": "import-ai",
  });

  dictActionsRow.append(copyDictBtn, downloadDictBtn, exportAiBtn, importAiBtn);

  const importDrawer = doc.createElement("div");
  importDrawer.className = "ptr-studio-card ptr-studio-hidden";
  const importTextarea = doc.createElement("textarea");
  importTextarea.rows = 3;
  importTextarea.className = "ptr-input";
  importTextarea.placeholder = t("volImportPlaceholder");
  importTextarea.setAttribute("data-studio-dict", "import-text");

  const importBtnRow = doc.createElement("div");
  importBtnRow.className = "ptr-studio-row";
  const applyImportBtn = makeButton(
    doc,
    t("volImportApply"),
    { "data-studio-dict": "import-apply" },
    true
  );
  applyImportBtn.addEventListener("click", () => {
    handlers.onApplyImport(importTextarea.value);
  });
  const cancelImportBtn = makeButton(doc, t("volImportCancel"), {
    "data-studio-dict": "import-cancel",
  });
  cancelImportBtn.addEventListener("click", () => {
    importDrawer.classList.add("ptr-studio-hidden");
  });
  importBtnRow.append(applyImportBtn, cancelImportBtn);
  importDrawer.append(importTextarea, importBtnRow);

  importAiBtn.addEventListener("click", () => {
    importDrawer.classList.toggle("ptr-studio-hidden");
  });

  const conflictsBox = doc.createElement("div");
  conflictsBox.className = "ptr-studio-card ptr-studio-hidden";
  conflictsBox.setAttribute("data-studio-dict", "conflicts");

  dictPanel.append(
    dictNavRow,
    dictSourceBox,
    scopeRow,
    transInput,
    saveDraftBtn,
    dictActionsRow,
    importDrawer,
    conflictsBox
  );

  const statusLine = doc.createElement("div");
  statusLine.className = "ptr-studio-status";
  statusLine.setAttribute("data-studio-status", "1");

  rightDock.append(rightTabRow, nodePanel, dictPanel, statusLine);

  // --- Bottom Dock: Diagnostics & Export + Record & Log ---
  const bottomDock = doc.createElement("footer");
  bottomDock.className = "ptr-studio-dock ptr-studio-bottom";
  bottomDock.setAttribute("data-studio-dock", "bottom");

  const bottomHeader = doc.createElement("div");
  bottomHeader.className = "ptr-studio-row";
  bottomHeader.style.justifyContent = "space-between";

  const bottomTabRow = doc.createElement("div");
  bottomTabRow.className = "ptr-studio-row";
  const diagTabBtn = makeButton(doc, t("studioBottomDiag"), {
    "data-studio-bottom-tab": "diag",
    "aria-pressed": "true",
  });
  diagTabBtn.addEventListener("click", () =>
    handlers.onSelectBottomTab("diag")
  );
  const recordTabBtn = makeButton(doc, t("studioBottomRecord"), {
    "data-studio-bottom-tab": "record",
    "aria-pressed": "false",
  });
  recordTabBtn.addEventListener("click", () =>
    handlers.onSelectBottomTab("record")
  );
  bottomTabRow.append(diagTabBtn, recordTabBtn);

  const collapseBtn = makeButton(doc, t("studioCollapse"), {
    "data-studio-action": "collapse-bottom",
  });
  collapseBtn.addEventListener("click", handlers.onToggleBottomCollapse);
  bottomHeader.append(bottomTabRow, collapseBtn);

  // Bottom Panel 1: Diagnostics & Export
  const diagPanel = doc.createElement("div");
  diagPanel.className = "ptr-studio-scroll";
  diagPanel.setAttribute("data-studio-panel", "diag");

  const diagStats = doc.createElement("div");
  diagStats.className = "ptr-studio-row";
  const diagActions = doc.createElement("div");
  diagActions.className = "ptr-studio-row";
  const copyDiagBtn = makeButton(doc, t("btnCopyDiag"), {
    "data-studio-action": "copy-diag",
  });
  copyDiagBtn.addEventListener("click", handlers.onCopyDiag);
  const copyNodesBtn = makeButton(doc, t("studioCopyNodes"), {
    "data-studio-action": "copy-nodes",
  });
  copyNodesBtn.addEventListener("click", handlers.onCopyNodes);
  const exportNodesBottomBtn = makeButton(doc, t("studioExportNodes"), {
    "data-studio-action": "export-nodes-bottom",
  });
  exportNodesBottomBtn.addEventListener("click", handlers.onExportNodes);
  diagActions.append(copyDiagBtn, copyNodesBtn, exportNodesBottomBtn);
  diagPanel.append(diagStats, diagActions);

  // Bottom Panel 2: Record & Log
  const recordPanel = doc.createElement("div");
  recordPanel.className = "ptr-studio-scroll ptr-studio-hidden";
  recordPanel.setAttribute("data-studio-panel", "record");

  const recordControls = doc.createElement("div");
  recordControls.className = "ptr-studio-row";
  const recordToggleBtn = makeButton(doc, t("studioRecordStart"), {
    "data-studio-action": "record-toggle",
    "aria-pressed": "false",
  });
  recordToggleBtn.addEventListener("click", handlers.onToggleRecord);

  const recordClearBtn = makeButton(doc, t("studioRecordClear"), {
    "data-studio-action": "record-clear",
  });
  recordClearBtn.addEventListener("click", handlers.onClearActivity);

  const bpPauseBtn = makeButton(doc, t("studioBpPauseApi"), {
    "data-studio-action": "bp-pause",
    "aria-pressed": "false",
  });
  bpPauseBtn.addEventListener("click", handlers.onTogglePauseApi);

  const bpResumeBtn = makeButton(doc, t("studioBpResume"), {
    "data-studio-action": "bp-resume",
  });
  bpResumeBtn.addEventListener("click", handlers.onResumeApi);

  const bpBadge = doc.createElement("span");
  bpBadge.className = "ptr-studio-status";

  recordControls.append(
    recordToggleBtn,
    recordClearBtn,
    bpPauseBtn,
    bpResumeBtn,
    bpBadge
  );

  const activityList = doc.createElement("div");
  activityList.className = "ptr-studio-scroll";
  activityList.setAttribute("data-studio-activity-list", "1");
  recordPanel.append(recordControls, activityList);

  bottomDock.append(bottomHeader, diagPanel, recordPanel);

  shell.append(overlayLayer, topDock, leftDock, rightDock, bottomDock);
  shadow.append(styleEl, shell);
  doc.documentElement.append(host);

  return {
    host,
    overlayLayer,
    destroy: () => {
      host.remove();
    },
    getDeltaText: () => deltaTextarea.value,
    setDeltaText: (rawDelta: string) => {
      deltaTextarea.value = rawDelta;
    },
    setStatusMessage: (msg: string) => {
      statusLine.textContent = msg;
    },
    renderToolbar: ({
      adapterId,
      boxMode,
      selectMode,
      themeMode,
      translated,
      zoom,
    }) => {
      applyPtrTheme(host, themeMode);
      adapterBadge.textContent = formatPtrMsg(t("hudFramework"), {
        adapterId,
      });
      translateBtn.textContent = t(
        translated ? "restorePage" : "translatePage"
      );
      selectModeBtn.textContent = t(
        selectMode ? "studioModeSelect" : "studioModeInteract"
      );
      selectModeBtn.setAttribute("aria-pressed", selectMode ? "true" : "false");
      boxSelect.value = boxMode;
      zoomSelect.value = zoom;
    },
    renderNodes: ({
      filtered,
      filterTab,
      manualElements,
      selectedIndex,
      totalCount,
      capturedCount,
    }) => {
      summaryChip.textContent = `${capturedCount}/${totalCount}`;
      for (const [id, btn] of filterTabs) {
        btn.setAttribute("aria-pressed", id === filterTab ? "true" : "false");
      }

      if (filtered.length === 0) {
        const empty = doc.createElement("div");
        empty.className = "ptr-muted";
        empty.textContent = t("studioNoNodes");
        nodeList.replaceChildren(empty);
        return;
      }

      const frag = doc.createDocumentFragment();
      for (const entry of filtered) {
        frag.append(
          buildNodeRow(doc, entry, {
            isManual: manualElements.has(entry.element),
            isSelected: entry.index === selectedIndex,
            onSelect: handlers.onSelectNode,
            t,
          })
        );
      }
      nodeList.replaceChildren(frag);
    },
    renderSelectedNode: (entry, suggestedSelector) => {
      if (!entry) {
        const prompt = doc.createElement("div");
        prompt.className = "ptr-muted";
        prompt.textContent = t("studioSelectPrompt");
        nodeMetaCard.replaceChildren(prompt);
        selectorInput.value = "";
        return;
      }

      const { candidate } = entry;
      const badgeRow = doc.createElement("div");
      badgeRow.className = "ptr-studio-row";

      const incPill = doc.createElement("span");
      incPill.className = candidate.included
        ? "ptr-studio-pill ptr-studio-pill-accent"
        : "ptr-studio-pill";
      incPill.textContent = candidate.included
        ? t("studioTabCaptured")
        : (candidate.excludeReason ?? t("studioTabExcluded"));

      const clsPill = doc.createElement("span");
      clsPill.className = "ptr-studio-pill ptr-mono";
      clsPill.textContent = candidate.classification;

      const regPill = doc.createElement("span");
      regPill.className = "ptr-studio-pill ptr-mono";
      regPill.textContent = formatRegion(candidate.region);

      badgeRow.append(incPill, clsPill, regPill);

      const pathBox = doc.createElement("div");
      pathBox.className = "code-inline";
      pathBox.textContent = candidate.domPath;

      const styleBox = doc.createElement("div");
      styleBox.className = "ptr-mono ptr-muted";
      styleBox.textContent = `${candidate.computedStyleSummary.display} | ${candidate.computedStyleSummary.visibility} | ${candidate.computedStyleSummary.fontFamily ?? "-"}`;

      const textBox = doc.createElement("div");
      textBox.textContent = candidate.textPreview;

      nodeMetaCard.replaceChildren(badgeRow, pathBox, styleBox, textBox);
      selectorInput.value = suggestedSelector;
    },
    renderRightTab: (tab) => {
      nodeTabBtn.setAttribute(
        "aria-pressed",
        tab === "node" ? "true" : "false"
      );
      dictTabBtn.setAttribute(
        "aria-pressed",
        tab === "dict" ? "true" : "false"
      );
      nodePanel.classList.toggle("ptr-studio-hidden", tab !== "node");
      dictPanel.classList.toggle("ptr-studio-hidden", tab !== "dict");
    },
    renderDictEntry: ({ entry, index, initialValue, scan, targetLang }) => {
      const total = scan?.entries.length ?? 0;
      segCounter.textContent = total > 0 ? `${index + 1} / ${total}` : "0 / 0";
      transInput.placeholder = formatPtrMsg(t("volTransPlaceholder"), {
        lang: targetLang,
      });

      if (!entry) {
        segKindBadge.textContent = "-";
        dictSourceBox.textContent = t("volEmpty");
        scopeInput.value = "";
        transInput.value = "";
        return;
      }

      segKindBadge.textContent = t(
        entry.kind === "dynamic" ? "volBadgeDynamic" : "volBadgeStatic"
      );
      dictSourceBox.textContent = entry.key;
      scopeInput.value = entry.matchedScope ?? "";
      transInput.value = initialValue;
    },
    renderConflicts: (conflicts) => {
      if (conflicts.length === 0) {
        conflictsBox.classList.add("ptr-studio-hidden");
        conflictsBox.replaceChildren();
        return;
      }
      conflictsBox.classList.remove("ptr-studio-hidden");
      const header = doc.createElement("div");
      header.className = "ptr-studio-row";
      const title = doc.createElement("strong");
      title.textContent = formatPtrMsg(t("volConflictsHeader"), {
        count: conflicts.length,
      });
      const keepAllBtn = makeButton(doc, t("volConflictKeepAll"), {
        "data-studio-conflict-keep-all": "1",
      });
      keepAllBtn.addEventListener("click", () =>
        handlers.onResolveAllConflicts("keep")
      );
      const overwriteAllBtn = makeButton(doc, t("volConflictOverwriteAll"), {
        "data-studio-conflict-overwrite-all": "1",
      });
      overwriteAllBtn.addEventListener("click", () =>
        handlers.onResolveAllConflicts("overwrite")
      );
      header.append(title, keepAllBtn, overwriteAllBtn);

      const frag = doc.createDocumentFragment();
      frag.append(header);
      for (const c of conflicts) {
        const card = doc.createElement("div");
        card.className = "ptr-studio-card";
        const keyEl = doc.createElement("div");
        keyEl.className = "code-inline";
        keyEl.textContent = c.key;

        const existingEl = doc.createElement("div");
        existingEl.textContent = `${t("volConflictExisting")}: ${c.existing}`;
        const importedEl = doc.createElement("div");
        importedEl.textContent = `${t("volConflictImported")}: ${c.imported}`;

        const btnRow = doc.createElement("div");
        btnRow.className = "ptr-studio-row";
        const keepBtn = makeButton(doc, t("volConflictKeep"), {
          "data-studio-conflict-keep": c.id,
        });
        keepBtn.addEventListener("click", () =>
          handlers.onResolveConflict(c.id, "keep")
        );
        const overwriteBtn = makeButton(doc, t("volConflictOverwrite"), {
          "data-studio-conflict-overwrite": c.id,
        });
        overwriteBtn.addEventListener("click", () =>
          handlers.onResolveConflict(c.id, "overwrite")
        );
        btnRow.append(keepBtn, overwriteBtn);

        card.append(keyEl, existingEl, importedEl, btnRow);
        frag.append(card);
      }
      conflictsBox.replaceChildren(frag);
    },
    renderBottomState: (collapsed, activeTab) => {
      shell.setAttribute("data-bottom-collapsed", collapsed ? "1" : "0");
      collapseBtn.textContent = t(
        collapsed ? "studioExpand" : "studioCollapse"
      );
      diagTabBtn.setAttribute(
        "aria-pressed",
        activeTab === "diag" ? "true" : "false"
      );
      recordTabBtn.setAttribute(
        "aria-pressed",
        activeTab === "record" ? "true" : "false"
      );
      diagPanel.classList.toggle(
        "ptr-studio-hidden",
        collapsed || activeTab !== "diag"
      );
      recordPanel.classList.toggle(
        "ptr-studio-hidden",
        collapsed || activeTab !== "record"
      );
    },
    renderDiagnostics: (scan) => {
      const items: [string, number][] = [
        [t("mSegments"), scan.counts.total],
        [t("volStatStatic"), scan.counts.static],
        [t("volStatDynamic"), scan.counts.dynamic],
        [t("volStatHits"), scan.counts.manual],
        [t("mRouteApi"), scan.metrics.routing.api],
        [t("mRouteOpencc"), scan.metrics.routing.opencc],
        [t("mRouteSkip"), scan.metrics.routing.skip],
        [t("mExcluded"), scan.metrics.excludedCount],
      ];
      const frag = doc.createDocumentFragment();
      for (const [label, value] of items) {
        const chip = doc.createElement("span");
        chip.className = "ptr-chip ptr-mono";
        chip.textContent = `${label}: ${value}`;
        frag.append(chip);
      }
      diagStats.replaceChildren(frag);
    },
    renderActivity: (entries, recording) => {
      recordToggleBtn.textContent = t(
        recording ? "studioRecordStop" : "studioRecordStart"
      );
      recordToggleBtn.setAttribute(
        "aria-pressed",
        recording ? "true" : "false"
      );

      if (entries.length === 0) {
        const empty = doc.createElement("div");
        empty.className = "ptr-muted";
        empty.textContent = t("studioRecordEmpty");
        activityList.replaceChildren(empty);
        return;
      }

      const frag = doc.createDocumentFragment();
      for (const entry of entries) {
        const line = doc.createElement("div");
        line.className = "ptr-mono";
        line.textContent = `[${entry.timestamp}] (${entry.kind}) ${entry.summary}`;
        frag.append(line);
      }
      activityList.replaceChildren(frag);
    },
    renderBreakpoint: (paused, waiting) => {
      bpPauseBtn.setAttribute("aria-pressed", paused ? "true" : "false");
      bpResumeBtn.disabled = !(paused || waiting);
      bpBadge.textContent =
        paused || waiting
          ? formatPtrMsg(t("studioBpWaiting"), { count: waiting ? 1 : 0 })
          : "";
    },
    renderOverlay: (boxes) => {
      renderOverlayBoxes(overlayLayer, doc, boxes);
    },
  };
}
