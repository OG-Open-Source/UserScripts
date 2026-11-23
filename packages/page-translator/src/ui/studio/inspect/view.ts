import { createDragController, markUiRoot } from "@userscripts/shared";
import type { PtrThemeMode } from "../../../platform/config";
import type { PtrMessageKey } from "../../../platform/i18n";
import { formatPtrMsg, MESSAGES_EN } from "../../../platform/i18n";
import { applyPtrTheme, getSharedPanelCss } from "../../theme";
import type { InspectScanResult, SegmentHoverMeta } from "./logic";

const HUD_ID = "ptr-inspect-hud";

export interface InspectViewHandlers {
  onCopyDiag: () => void;
  onExportAi: () => void;
}

export interface InspectView {
  destroy: () => void;
  host: HTMLElement;
  renderHover: (meta: SegmentHoverMeta | null) => void;
  renderScan: (scan: InspectScanResult, themeMode: PtrThemeMode) => void;
}

function getHudCss(): string {
  return `
${getSharedPanelCss()}

:host {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 2147483646;
  display: block;
}

.ptr-hud {
  width: min(360px, calc(100vw - 24px));
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

.ptr-hud-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.ptr-hud-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ptr-hud-hover {
  padding: 8px;
  background: var(--us-surface);
  border-radius: var(--us-radius-md);
  font-size: 11.5px;
}

.ptr-hud-details[hidden] {
  display: none;
}
`.trim();
}

export function mountInspectView(
  doc: Document,
  handlers: InspectViewHandlers,
  t: (key: PtrMessageKey) => string = (key) => MESSAGES_EN[key]
): InspectView {
  const existing = doc.querySelector(`#${HUD_ID}`);
  if (existing) {
    existing.remove();
  }

  const host = doc.createElement("div");
  host.id = HUD_ID;
  markUiRoot(host, "ptr");

  const shadow = host.attachShadow({ mode: "open" });
  const styleEl = doc.createElement("style");
  styleEl.textContent = getHudCss();

  const aside = doc.createElement("aside");
  aside.className = "ptr-panel ptr-hud";

  const head = doc.createElement("header");
  head.className = "us-panel-head";

  const title = doc.createElement("span");
  title.className = "drag-title";
  title.textContent = t("hudTitle");

  const adapterChip = doc.createElement("span");
  adapterChip.id = "ptr-h-adapter";
  adapterChip.className = "ptr-chip ptr-mono";
  adapterChip.textContent = formatPtrMsg(t("hudFramework"), {
    adapterId: "fallback",
  });

  head.append(title, adapterChip);

  const statsStrip = doc.createElement("div");
  statsStrip.className = "us-stat-strip";

  const makeStat = (id: string, label: string): HTMLElement => {
    const cell = doc.createElement("div");
    cell.className = "us-stat-cell";
    const val = doc.createElement("span");
    val.id = id;
    val.className = "us-stat-val";
    val.textContent = "0";
    const lbl = doc.createElement("span");
    lbl.className = "us-stat-label";
    lbl.textContent = label;
    cell.append(val, lbl);
    statsStrip.append(cell);
    return val;
  };

  const countStaticEl = makeStat("ptr-h-static", t("segStatic"));
  const countDynEl = makeStat("ptr-h-dynamic", t("segDynamic"));
  const countManualEl = makeStat("ptr-h-manual", t("segManual"));

  const hoverBox = doc.createElement("div");
  hoverBox.className = "ptr-hud-hover";
  const hoverHint = doc.createElement("div");
  hoverHint.className = "ptr-muted";
  hoverHint.textContent = t("hoverHint");
  const hoverKv = doc.createElement("dl");
  hoverKv.className = "us-kv";
  hoverKv.hidden = true;
  hoverBox.append(hoverHint, hoverKv);

  const detailsBox = doc.createElement("div");
  detailsBox.className = "ptr-hud-details us-metric-table";
  detailsBox.hidden = true;

  const actions = doc.createElement("div");
  actions.className = "ptr-hud-actions";

  const detailsBtn = doc.createElement("button");
  detailsBtn.type = "button";
  detailsBtn.className = "ptr-btn";
  detailsBtn.textContent = t("btnDetails");
  detailsBtn.setAttribute("aria-pressed", "false");
  detailsBtn.addEventListener("click", () => {
    const next = detailsBox.hidden;
    detailsBox.hidden = !next;
    detailsBtn.setAttribute("aria-pressed", next ? "true" : "false");
  });

  const exportAiBtn = doc.createElement("button");
  exportAiBtn.type = "button";
  exportAiBtn.className = "ptr-btn";
  exportAiBtn.textContent = t("btnExportAi");
  exportAiBtn.addEventListener("click", () => {
    handlers.onExportAi();
  });

  const copyBtn = doc.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "ptr-btn";
  copyBtn.textContent = t("btnCopyDiag");
  copyBtn.addEventListener("click", () => {
    handlers.onCopyDiag();
  });

  actions.append(detailsBtn, exportAiBtn, copyBtn);
  aside.append(head, statsStrip, hoverBox, detailsBox, actions);
  shadow.append(styleEl, aside);
  (doc.body ?? doc.documentElement).append(host);

  const drag = createDragController({
    handle: head,
    panel: host,
    stage: null,
  });

  return {
    host,
    renderScan(scan: InspectScanResult, themeMode: PtrThemeMode): void {
      applyPtrTheme(host, themeMode);
      adapterChip.textContent = formatPtrMsg(t("hudFramework"), {
        adapterId: scan.adapterId,
      });
      countStaticEl.textContent = String(scan.counts.static);
      countDynEl.textContent = String(scan.counts.dynamic);
      countManualEl.textContent = String(scan.counts.manual);
      detailsBox.innerHTML = "";
      const rows: [string, string | number][] = [
        [t("mSegments"), scan.counts.total],
        [t("mRouteApi"), scan.metrics.routing.api],
        [t("mRouteOpencc"), scan.metrics.routing.opencc],
        [t("mRouteSkip"), scan.metrics.routing.skip],
      ];
      for (const [label, val] of rows) {
        const row = doc.createElement("div");
        row.className = "us-metric-row";
        const lbl = doc.createElement("span");
        lbl.className = "m-label";
        lbl.textContent = label;
        const v = doc.createElement("span");
        v.className = "m-val";
        v.textContent = String(val);
        const unit = doc.createElement("span");
        unit.className = "m-unit";
        row.append(lbl, v, unit);
        detailsBox.append(row);
      }
    },
    renderHover(meta: SegmentHoverMeta | null): void {
      if (!meta) {
        hoverHint.hidden = false;
        hoverKv.hidden = true;
        return;
      }
      hoverHint.hidden = true;
      hoverKv.hidden = false;
      hoverKv.innerHTML = "";
      const pairs: [string, string][] = [
        [t("kvTemplate"), meta.template],
        [t("kvScope"), meta.scope ?? "-"],
        [t("kvSpacing"), meta.spacingDiff],
      ];
      for (const [k, v] of pairs) {
        const dt = doc.createElement("dt");
        dt.textContent = k;
        const dd = doc.createElement("dd");
        dd.className = "code-inline";
        dd.textContent = v;
        hoverKv.append(dt, dd);
      }
    },
    destroy(): void {
      drag.destroy();
      host.remove();
    },
  };
}
