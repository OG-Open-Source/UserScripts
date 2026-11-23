import { createDragController, markUiRoot } from "@userscripts/shared";
import type { PtrThemeMode } from "../../../platform/config";
import type { PtrMessageKey } from "../../../platform/i18n";
import { formatPtrMsg, MESSAGES_EN } from "../../../platform/i18n";
import { applyPtrTheme, getSharedPanelCss } from "../../theme";
import type {
  CapturedVolunteerEntry,
  VolunteerConflict,
  VolunteerScanResult,
} from "./logic";

const WORKBENCH_ID = "ptr-volunteer-workbench";

export interface VolunteerViewHandlers {
  onApplyImport: (rawJson: string) => void;
  onCopyJson: () => void;
  onExportAi: () => void;
  onNext: () => void;
  onPrev: () => void;
  onRescan: () => void;
  onResolveConflict: (id: string, choice: "keep" | "overwrite") => void;
  onSaveDraft: (translation: string, scope: string) => void;
  onSuggestScope: () => string;
  onToggleLock: () => void;
}

export interface VolunteerView {
  destroy: () => void;
  host: HTMLElement;
  renderConflicts: (conflicts: readonly VolunteerConflict[]) => void;
  renderEntry: (
    entry: CapturedVolunteerEntry | null,
    index: number,
    total: number,
    targetLang: string,
    initialValue: string
  ) => void;
  renderLock: (locked: boolean) => void;
  renderScan: (scan: VolunteerScanResult, themeMode: PtrThemeMode) => void;
  setMessage: (msg: string) => void;
}

function getWorkbenchCss(): string {
  return `
${getSharedPanelCss()}

:host {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 2147483646;
  display: block;
}

.ptr-vol {
  width: min(390px, calc(100vw - 24px));
  padding: 10px 12px;
  box-shadow: var(--us-shadow);
  display: grid;
  gap: 8px;
}

.us-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: grab;
}

.ptr-vol-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.ptr-vol-editor {
  display: grid;
  gap: 6px;
}

.ptr-vol-msg {
  font-size: 11.5px;
  color: var(--us-muted);
}

.ptr-vol-conflicts {
  display: grid;
  gap: 6px;
}

.ptr-vol-conflict-card {
  padding: 8px;
  border-radius: var(--us-radius-md);
  background: var(--us-surface);
  display: grid;
  gap: 4px;
}
`.trim();
}

export function mountVolunteerView(
  doc: Document,
  hostname: string,
  handlers: VolunteerViewHandlers,
  t: (key: PtrMessageKey) => string = (key) => MESSAGES_EN[key]
): VolunteerView {
  const existing = doc.querySelector(`#${WORKBENCH_ID}`);
  if (existing) {
    existing.remove();
  }

  const host = doc.createElement("div");
  host.id = WORKBENCH_ID;
  markUiRoot(host, "ptr");

  const shadow = host.attachShadow({ mode: "open" });
  const styleEl = doc.createElement("style");
  styleEl.textContent = getWorkbenchCss();

  const aside = doc.createElement("aside");
  aside.className = "ptr-panel ptr-vol";

  const head = doc.createElement("header");
  head.className = "us-panel-head";

  const titleEl = doc.createElement("span");
  titleEl.className = "drag-title";
  titleEl.textContent = formatPtrMsg(t("volTitle"), { host: hostname });

  const lockBtn = doc.createElement("button");
  lockBtn.type = "button";
  lockBtn.className = "ptr-btn";
  lockBtn.textContent = t("volLockOff");
  lockBtn.setAttribute("aria-pressed", "false");
  lockBtn.addEventListener("click", () => {
    handlers.onToggleLock();
  });

  head.append(titleEl, lockBtn);

  const statsStrip = doc.createElement("div");
  statsStrip.className = "us-stat-strip";

  const makeStat = (label: string): HTMLElement => {
    const cell = doc.createElement("div");
    cell.className = "us-stat-cell";
    const val = doc.createElement("span");
    val.className = "us-stat-val";
    val.textContent = "0";
    const lbl = doc.createElement("span");
    lbl.className = "us-stat-label";
    lbl.textContent = label;
    cell.append(val, lbl);
    statsStrip.append(cell);
    return val;
  };

  const statStaticEl = makeStat(t("volStatStatic"));
  const statDynEl = makeStat(t("volStatDynamic"));
  const statHitsEl = makeStat(t("volStatHits"));

  const emptyEl = doc.createElement("div");
  emptyEl.className = "ptr-vol-msg";
  emptyEl.textContent = t("volEmpty");

  const editorEl = doc.createElement("div");
  editorEl.className = "ptr-vol-editor";
  editorEl.hidden = true;

  const posEl = doc.createElement("div");
  posEl.className = "ptr-chip ptr-mono";
  posEl.textContent = "0 / 0";

  const keyEl = doc.createElement("div");
  keyEl.className = "code-inline";

  const scopeRow = doc.createElement("div");
  scopeRow.className = "ptr-vol-row";
  const scopeInput = doc.createElement("input");
  scopeInput.type = "text";
  scopeInput.className = "ptr-input";
  scopeInput.placeholder = t("volScopePlaceholder");
  const suggestBtn = doc.createElement("button");
  suggestBtn.type = "button";
  suggestBtn.className = "ptr-btn";
  suggestBtn.textContent = t("volSuggest");
  suggestBtn.addEventListener("click", () => {
    scopeInput.value = handlers.onSuggestScope();
  });
  scopeRow.append(scopeInput, suggestBtn);

  const valInput = doc.createElement("input");
  valInput.type = "text";
  valInput.className = "ptr-input";

  const navRow = doc.createElement("div");
  navRow.className = "ptr-vol-row";

  const prevBtn = doc.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "ptr-btn";
  prevBtn.textContent = t("volPrev");
  prevBtn.addEventListener("click", () => {
    handlers.onPrev();
  });

  const nextBtn = doc.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "ptr-btn";
  nextBtn.textContent = t("volNext");
  nextBtn.addEventListener("click", () => {
    handlers.onNext();
  });

  const saveBtn = doc.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "ptr-btn ptr-btn-primary";
  saveBtn.textContent = t("volSave");
  saveBtn.addEventListener("click", () => {
    handlers.onSaveDraft(valInput.value, scopeInput.value);
  });

  navRow.append(prevBtn, nextBtn, saveBtn);
  editorEl.append(posEl, keyEl, scopeRow, valInput, navRow);

  const toolbar = doc.createElement("div");
  toolbar.className = "ptr-vol-row";

  const rescanBtn = doc.createElement("button");
  rescanBtn.type = "button";
  rescanBtn.className = "ptr-btn";
  rescanBtn.textContent = t("volRescan");
  rescanBtn.addEventListener("click", () => {
    handlers.onRescan();
  });

  const exportAiBtn = doc.createElement("button");
  exportAiBtn.type = "button";
  exportAiBtn.className = "ptr-btn";
  exportAiBtn.textContent = t("volExportAi");
  exportAiBtn.addEventListener("click", () => {
    handlers.onExportAi();
  });

  const importToggleBtn = doc.createElement("button");
  importToggleBtn.type = "button";
  importToggleBtn.className = "ptr-btn";
  importToggleBtn.textContent = t("volImportAi");

  const copyBtn = doc.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "ptr-btn";
  copyBtn.textContent = t("volCopyJson");
  copyBtn.addEventListener("click", () => {
    handlers.onCopyJson();
  });

  toolbar.append(rescanBtn, exportAiBtn, importToggleBtn, copyBtn);

  const importBox = doc.createElement("div");
  importBox.className = "ptr-vol-editor";
  importBox.hidden = true;
  const importInput = doc.createElement("textarea");
  importInput.className = "ptr-input";
  importInput.rows = 3;
  importInput.placeholder = t("volImportPlaceholder");
  const importApplyBtn = doc.createElement("button");
  importApplyBtn.type = "button";
  importApplyBtn.className = "ptr-btn ptr-btn-primary";
  importApplyBtn.textContent = t("volImportApply");
  importApplyBtn.addEventListener("click", () => {
    handlers.onApplyImport(importInput.value);
  });
  importBox.append(importInput, importApplyBtn);

  importToggleBtn.addEventListener("click", () => {
    importBox.hidden = !importBox.hidden;
  });

  const conflictsEl = doc.createElement("div");
  conflictsEl.className = "ptr-vol-conflicts";
  conflictsEl.hidden = true;

  const msgEl = doc.createElement("div");
  msgEl.className = "ptr-vol-msg";

  aside.append(
    head,
    statsStrip,
    emptyEl,
    editorEl,
    toolbar,
    importBox,
    conflictsEl,
    msgEl
  );
  shadow.append(styleEl, aside);
  (doc.body ?? doc.documentElement).append(host);

  const drag = createDragController({
    handle: head,
    panel: host,
    stage: null,
  });

  return {
    host,
    renderScan(scan: VolunteerScanResult, themeMode: PtrThemeMode): void {
      applyPtrTheme(host, themeMode);
      statStaticEl.textContent = String(scan.staticCount);
      statDynEl.textContent = String(scan.dynamicCount);
      statHitsEl.textContent = String(scan.hitCount);
    },
    renderEntry(
      entry: CapturedVolunteerEntry | null,
      index: number,
      total: number,
      targetLang: string,
      initialValue: string
    ): void {
      if (!entry) {
        emptyEl.hidden = false;
        editorEl.hidden = true;
        return;
      }
      emptyEl.hidden = true;
      editorEl.hidden = false;
      posEl.textContent = `${index + 1} / ${total}`;
      keyEl.textContent = entry.key;
      scopeInput.value = entry.matchedScope ?? "";
      valInput.value = initialValue;
      valInput.placeholder = formatPtrMsg(t("volTransPlaceholder"), {
        lang: targetLang,
      });
    },
    renderLock(locked: boolean): void {
      lockBtn.textContent = locked ? t("volLockOn") : t("volLockOff");
      lockBtn.setAttribute("aria-pressed", locked ? "true" : "false");
    },
    renderConflicts(conflicts: readonly VolunteerConflict[]): void {
      conflictsEl.innerHTML = "";
      conflictsEl.hidden = conflicts.length === 0;
      for (const conflict of conflicts) {
        const card = doc.createElement("div");
        card.className = "ptr-vol-conflict-card";
        const keyLine = doc.createElement("div");
        keyLine.className = "code-inline";
        keyLine.textContent = conflict.key;
        const row = doc.createElement("div");
        row.className = "ptr-vol-row";
        const keepBtn = doc.createElement("button");
        keepBtn.type = "button";
        keepBtn.className = "ptr-btn";
        keepBtn.textContent = t("volConflictKeep");
        keepBtn.addEventListener("click", () => {
          handlers.onResolveConflict(conflict.id, "keep");
        });
        const useBtn = doc.createElement("button");
        useBtn.type = "button";
        useBtn.className = "ptr-btn ptr-btn-primary";
        useBtn.textContent = t("volConflictOverwrite");
        useBtn.addEventListener("click", () => {
          handlers.onResolveConflict(conflict.id, "overwrite");
        });
        row.append(keepBtn, useBtn);
        card.append(keyLine, row);
        conflictsEl.append(card);
      }
    },
    setMessage(msg: string): void {
      msgEl.textContent = msg;
    },
    destroy(): void {
      drag.destroy();
      host.remove();
    },
  };
}
