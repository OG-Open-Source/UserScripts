import type { GMMenuHandle, ThemeMode } from "@userscripts/shared";
import {
  applyThemeModeToElement,
  createDragController,
  gmMenuCommand,
  gmUnregisterMenuCommand,
  markUiRoot,
  probeHostColors,
  resolveThemeTokens,
} from "@userscripts/shared";
import type { StyleReader } from "./capture/display-role";
import { encodeInlineNodes } from "./capture/inline-codec";
import { collectSegments } from "./capture/segmenter";
import type { PunctNormMode, SpacingMode } from "./config";
import { buildAiTranslationExport } from "./export-ai";
import type { PtrMessageKey } from "./i18n";
import { formatPtrMsg, MESSAGES_EN } from "./i18n";
import type { PtrMetrics } from "./metrics";
import { getMetricsSnapshot, recordScanTiming } from "./metrics";
import type { InspectKind } from "./renderer";
import { renderInspectMarker } from "./renderer";
import type { CompiledSiteDelta } from "./site-rules";
import { extractPageKeywords } from "./transform/keywords";
import { detectSegmentBcp47, routeSegment } from "./transform/lang-route";
import { inspectTextSpacing } from "./transform/spacing";
import type { SiteLocaleTable } from "./transform/template";
import { extractTemplate, matchSiteTranslation } from "./transform/template";
import { getSharedPanelCss } from "./ui-theme";

const INSPECT_MENU_ID = "ptr-inspect";
const HUD_ID = "ptr-inspect-hud";
const HUD_STYLE_ID = "ptr-inspect-hud-style";

const OBSERVE_CONFIG: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: [
    "style",
    "class",
    "hidden",
    "open",
    "aria-hidden",
    "aria-expanded",
  ],
};

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function scheduleFrame(cb: () => void): { id: number; cancel: () => void } {
  if (
    typeof requestAnimationFrame === "function" &&
    typeof cancelAnimationFrame === "function"
  ) {
    const id = requestAnimationFrame(cb);
    return { id, cancel: () => cancelAnimationFrame(id) };
  }
  const id = setTimeout(cb, 16) as unknown as number;
  return { id, cancel: () => clearTimeout(id) };
}

function triggerPulse(btn: HTMLElement): void {
  btn.classList.remove("flash-done");
  void btn.offsetWidth;
  btn.classList.add("flash-done");
}

function supportsTextAutospace(): boolean {
  try {
    return (
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("text-autospace", "normal")
    );
  } catch {
    return false;
  }
}

interface SegmentHoverMeta {
  kind: InspectKind;
  mods: string[];
  route: string;
  scope: string | null;
  snippet: string;
  spacingDiff: string;
  spacingMode: string;
  spacingSummary: string;
  template: string;
  values: string[];
}

interface HudRefs {
  apiAvgEl: HTMLElement;
  apiBEl: HTMLElement;
  asideEl: HTMLElement;
  autospaceEl: HTMLElement;
  cacheHEl: HTMLElement;
  cacheMEl: HTMLElement;
  cacheRateEl: HTMLElement;
  copyBtn: HTMLButtonElement;
  countDynEl: HTMLElement;
  countManualEl: HTMLElement;
  countPlusEl: HTMLElement;
  countStaticEl: HTMLElement;
  detailsEl: HTMLElement;
  dictEl: HTMLElement;
  dictUnitEl: HTMLElement;
  excludedEl: HTMLElement;
  exportAiBtn: HTMLButtonElement;
  headEl: HTMLElement;
  hoverDotEl: HTMLElement;
  hoverHintEl: HTMLElement;
  hoverKindEl: HTMLElement;
  hoverKvEl: HTMLElement;
  hoverRouteEl: HTMLElement;
  hoverScopeEl: HTMLElement;
  hoverSpaceEl: HTMLElement;
  hoverSpacingDiffEl: HTMLElement;
  hoverTplEl: HTMLElement;
  hoverValsEl: HTMLElement;
  kwEl: HTMLElement;
  ldEl: HTMLElement;
  msgEl: HTMLElement;
  mutBEl: HTMLElement;
  nodesEl: HTMLElement;
  routeApiEl: HTMLElement;
  routeOpenccEl: HTMLElement;
  routeSkipEl: HTMLElement;
  scanIEl: HTMLElement;
  scanLEl: HTMLElement;
  segScopedEl: HTMLElement;
  segTotalEl: HTMLElement;
  shadowsEl: HTMLElement;
  spaceEl: HTMLElement;
  toggleBtn: HTMLButtonElement;
}

export interface InspectControllerOptions {
  doc: Document;
  formatLabel?: (enabled: boolean) => string;
  getDelta: () => CompiledSiteDelta;
  getPunctNorm?: () => PunctNormMode;
  getSiteLocaleTable?: () => SiteLocaleTable | null;
  getSpacingMode?: () => SpacingMode;
  getStyle?: StyleReader;
  getTargetLang?: () => string;
  getThemeMode?: () => ThemeMode;
  hostname?: string;
  isEnabled: () => boolean;
  metrics?: PtrMetrics;
  onAfterChange?: () => void;
  onShadowRoots?: (roots: Set<ShadowRoot>) => void;
  setEnabled: (next: boolean) => void;
  t?: (key: PtrMessageKey) => string;
}

const hudSheetCache = new WeakMap<ShadowRoot, CSSStyleSheet>();

function applyHudCss(sr: ShadowRoot, doc: Document, css: string): void {
  if (
    typeof CSSStyleSheet !== "undefined" &&
    Array.isArray(sr.adoptedStyleSheets)
  ) {
    try {
      let sheet = hudSheetCache.get(sr);
      if (!sheet) {
        sheet = new CSSStyleSheet();
        hudSheetCache.set(sr, sheet);
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
  let styleEl = sr.getElementById(HUD_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = doc.createElement("style");
    styleEl.id = HUD_STYLE_ID;
    sr.prepend(styleEl);
  }
  styleEl.textContent = css;
}

export function createInspectController(options: InspectControllerOptions) {
  let mutationObserver: MutationObserver | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingRoots = new Set<Element>();
  const observedRoots = new WeakSet<Node>();
  const discoveredShadows = new Set<ShadowRoot>();
  let registeredHandle: GMMenuHandle | undefined;
  let hudEl: HTMLElement | null = null;
  let hudRefs: HudRefs | null = null;
  let dragController: { destroy: () => void } | null = null;
  let hoverListenerAttached = false;
  let pendingHoverHost: Element | null = null;
  let lastHoverHost: Element | null = null;
  let hoverRaf: { id: number; cancel: () => void } | null = null;
  let telemetryRaf: { id: number; cancel: () => void } | null = null;
  let telemetryDirty = false;
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

  function ensureObserved(node: Node): void {
    if (!mutationObserver || observedRoots.has(node)) {
      return;
    }
    observedRoots.add(node);
    mutationObserver.observe(node, OBSERVE_CONFIG);
  }

  const hoverMeta = new WeakMap<Element, SegmentHoverMeta>();

  function updateHudHover(
    label: string,
    preview: string,
    meta?: SegmentHoverMeta | null
  ): void {
    if (!hudRefs) {
      return;
    }
    if (meta) {
      hudRefs.hoverHintEl.hidden = true;
      hudRefs.hoverKvEl.hidden = false;
      const dotClass =
        meta.kind === "auto-dynamic"
          ? "dyn"
          : meta.kind === "+"
            ? "plus"
            : meta.kind === "manual"
              ? "manual"
              : "static";
      hudRefs.hoverDotEl.className = `us-dot ${dotClass}`;
      setTextFast(hudRefs.hoverKindEl, meta.kind);
      setTextFast(hudRefs.hoverRouteEl, meta.route);
      setTextFast(hudRefs.hoverSpaceEl, meta.spacingSummary);
      setTextFast(hudRefs.hoverScopeEl, meta.scope || "—");
      setTextFast(
        hudRefs.hoverTplEl,
        meta.template.slice(0, 120) || preview || "—"
      );
      setTextFast(
        hudRefs.hoverValsEl,
        meta.values.length > 0 ? meta.values.join(", ") : "—"
      );
      setTextFast(hudRefs.hoverSpacingDiffEl, meta.spacingDiff || "—");
      return;
    }
    hudRefs.hoverHintEl.hidden = false;
    hudRefs.hoverKvEl.hidden = true;
    setTextFast(
      hudRefs.hoverHintEl,
      label ? `${label}${preview ? ` — ${preview}` : ""}` : tr("hoverHint")
    );
  }

  function flushTelemetry(force = false): void {
    if (!(hudRefs && options.metrics)) {
      return;
    }
    const snap = getMetricsSnapshot(options.metrics);
    setTextFast(hudRefs.countStaticEl, String(snap.segments.autoStatic));
    setTextFast(hudRefs.countDynEl, String(snap.segments.autoDynamic));
    setTextFast(hudRefs.countPlusEl, String(snap.segments.plus));
    setTextFast(hudRefs.countManualEl, String(snap.segments.manual));

    const isCollapsed = hudRefs.detailsEl.dataset.collapsed === "true";
    if (isCollapsed && !force) {
      return;
    }
    telemetryDirty = false;

    setTextFast(hudRefs.segTotalEl, String(snap.segments.total));
    setTextFast(hudRefs.segScopedEl, String(snap.segments.scopedHits));
    setTextFast(hudRefs.routeApiEl, String(snap.routing.api));
    setTextFast(hudRefs.routeOpenccEl, String(snap.routing.opencc));
    setTextFast(hudRefs.routeSkipEl, String(snap.routing.skip));
    setTextFast(
      hudRefs.dictEl,
      String(snap.dictCounts.static + snap.dictCounts.dynamic)
    );
    setTextFast(hudRefs.dictUnitEl, `\`${snap.dictCounts.scoped} sc`);
    setTextFast(
      hudRefs.ldEl,
      tr(
        snap.languageDetectorStatus === "available"
          ? "ldAvailable"
          : "ldUnavailable"
      )
    );
    setTextFast(
      hudRefs.kwEl,
      snap.keywordsSample.slice(0, 6).join(", ") || "—"
    );

    setTextFast(
      hudRefs.scanIEl,
      snap.initialScanMs === null ? "—" : snap.initialScanMs.toFixed(1)
    );
    setTextFast(hudRefs.scanLEl, snap.lastScanMs.toFixed(1));
    setTextFast(hudRefs.nodesEl, String(snap.nodesVisited));
    setTextFast(hudRefs.cacheHEl, String(snap.cacheHits));
    setTextFast(hudRefs.cacheMEl, String(snap.cacheMisses));
    setTextFast(hudRefs.cacheRateEl, String(snap.cacheHitRatePct));
    setTextFast(hudRefs.apiBEl, String(snap.apiBatches));
    setTextFast(
      hudRefs.apiAvgEl,
      snap.apiBatches > 0 ? snap.avgApiBatchMs.toFixed(1) : "—"
    );
    setTextFast(hudRefs.mutBEl, String(snap.mutationBatches));
    setTextFast(hudRefs.excludedEl, String(snap.excludedCount));
    setTextFast(hudRefs.shadowsEl, String(snap.shadowRootCount));
  }

  function scheduleTelemetryFlush(): void {
    telemetryDirty = true;
    if (telemetryRaf) {
      return;
    }
    telemetryRaf = scheduleFrame(() => {
      telemetryRaf = null;
      flushTelemetry(false);
    });
  }

  function buildDiagnostics(): string {
    const segCounts: Record<string, number> = {};
    const samples: string[] = [];
    for (const el of options.doc.querySelectorAll("[data-tr-inspect-kind]")) {
      const kind = el.getAttribute("data-tr-inspect-kind");
      if (kind) {
        segCounts[kind] = (segCounts[kind] ?? 0) + 1;
      }
      const meta = hoverMeta.get(el);
      if (meta?.snippet && samples.length < 40) {
        samples.push(meta.snippet);
      }
    }
    if (
      options.metrics &&
      options.metrics.keywordsSample.length === 0 &&
      samples.length > 0
    ) {
      options.metrics.keywordsSample = extractPageKeywords(samples);
    }
    const out: Record<string, unknown> = {};
    if (options.metrics) {
      out.metrics = getMetricsSnapshot(options.metrics);
    }
    out.segmentKindCounts = segCounts;
    return JSON.stringify(out, null, 2);
  }

  function syncThemeOnHud(): void {
    if (!hudEl?.shadowRoot) {
      return;
    }
    const mode = options.getThemeMode?.() ?? "system";
    const hostColors = mode === "host" ? probeHostColors(options.doc) : null;
    const hostTokens =
      mode === "host" ? resolveThemeTokens("host", hostColors) : null;
    applyThemeModeToElement(hudEl, mode, hostColors);
    applyHudCss(hudEl.shadowRoot, options.doc, buildHudCss(hostTokens));
  }

  function buildHudCss(
    hostTokens: ReturnType<typeof resolveThemeTokens>
  ): string {
    return `${getSharedPanelCss(hostTokens)}
:host {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 2147483647;
  pointer-events: none;
}
.hud {
  width: 358px;
  pointer-events: auto;
}
.chip-row { display: flex; flex-wrap: wrap; gap: 4px; }
.hover-hint {
  color: var(--us-muted);
  font-size: 11.5px;
  padding: 6px 8px;
  background: var(--us-surface);
  border-radius: var(--us-radius-sm);
}
.sec-title {
  font-size: 10.5px;
  font-weight: 700;
  margin: 8px 0 4px;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--us-muted);
}
.sec-title:first-child { margin-top: 0; }
.us-collapse-pad { padding: 4px 12px 8px; max-height: 240px; overflow-y: auto; }
.ctrl { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
.hud-msg { color: var(--us-muted); font-size: 11px; margin-top: 5px; }`;
  }

  function mountHud(): void {
    const parent = options.doc.body ?? options.doc.documentElement;
    if (!parent) {
      return;
    }
    if (hudEl?.isConnected && hudRefs) {
      syncThemeOnHud();
      const spacing = options.getSpacingMode?.() ?? "both";
      setTextFast(hudRefs.spaceEl, tr("hudSpaceChip", { mode: spacing }));
      flushTelemetry(false);
      return;
    }
    const existing = options.doc.getElementById(HUD_ID);
    if (existing) {
      existing.remove();
    }

    hudEl = options.doc.createElement("div");
    hudEl.id = HUD_ID;
    hudEl.setAttribute("data-ptr-ui", "1");
    markUiRoot(hudEl, "ptr");
    const sr = hudEl.attachShadow({ mode: "open" });

    const mode = options.getThemeMode?.() ?? "system";
    const hostColors = mode === "host" ? probeHostColors(options.doc) : null;
    const hostTokens =
      mode === "host" ? resolveThemeTokens("host", hostColors) : null;
    applyThemeModeToElement(hudEl, mode, hostColors);
    applyHudCss(sr, options.doc, buildHudCss(hostTokens));

    const tpl = options.doc.createElement("template");
    tpl.innerHTML = `
<aside class="us-panel hud" id="ptr-h-aside" aria-label="${tr("hudTitle")}">
  <div class="us-panel-head" id="ptr-h-head">
    <span class="drag-title">
      <svg class="drag-grip" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="3" r="1.1"/><circle cx="8.5" cy="3" r="1.1"/><circle cx="3.5" cy="8" r="1.1"/><circle cx="8.5" cy="8" r="1.1"/><circle cx="3.5" cy="13" r="1.1"/><circle cx="8.5" cy="13" r="1.1"/></svg>
      <span id="ptr-h-title"></span>
    </span>
    <span class="ptr-chip ptr-mono" id="ptr-h-space"></span>
  </div>
  <div class="us-panel-sec">
    <div class="chip-row">
      <span class="ptr-chip"><i class="us-dot static"></i><span id="ptr-h-l-static"></span> <span id="ptr-h-c-static">0</span></span>
      <span class="ptr-chip"><i class="us-dot dyn"></i><span id="ptr-h-l-dyn"></span> <span id="ptr-h-c-dyn">0</span></span>
      <span class="ptr-chip"><i class="us-dot plus"></i><span id="ptr-h-l-plus"></span> <span id="ptr-h-c-plus">0</span></span>
      <span class="ptr-chip"><i class="us-dot manual"></i><span id="ptr-h-l-manual"></span> <span id="ptr-h-c-manual">0</span></span>
      <span class="ptr-chip ptr-mono" id="ptr-h-autospace"></span>
    </div>
  </div>
  <div class="us-panel-sec">
    <div class="hover-hint" id="ptr-h-hover-hint"></div>
    <div id="ptr-h-hover-kv" hidden>
      <div class="chip-row">
        <span class="ptr-chip"><i class="us-dot static" id="ptr-h-hover-dot"></i><span id="ptr-h-hover-kind"></span></span>
        <span class="ptr-chip ptr-mono" id="ptr-h-hover-route"></span>
        <span class="ptr-chip ptr-mono" id="ptr-h-hover-space"></span>
      </div>
      <dl class="us-kv">
        <dt id="ptr-h-kv-scope"></dt><dd class="ptr-mono" id="ptr-h-hover-scope">—</dd>
        <dt id="ptr-h-kv-tpl"></dt><dd><code class="code-inline" id="ptr-h-hover-tpl">—</code></dd>
        <dt id="ptr-h-kv-vals"></dt><dd class="ptr-mono" id="ptr-h-hover-vals">—</dd>
        <dt id="ptr-h-kv-diff"></dt><dd class="ptr-mono" id="ptr-h-hover-diff">—</dd>
      </dl>
    </div>
  </div>
  <div class="us-collapse" id="ptr-h-details" data-collapsed="true">
    <div class="us-collapse-inner">
      <div class="us-collapse-pad">
        <div class="sec-title" id="ptr-h-sec-cap"></div>
        <div class="us-metric-table">
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-seg"></span><span class="m-val" id="ptr-h-seg-total">0</span><span class="m-unit">\`seg</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-scoped"></span><span class="m-val" id="ptr-h-seg-scoped">0</span><span class="m-unit">\`hit</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-r-api"></span><span class="m-val" id="ptr-h-route-api">0</span><span class="m-unit">\`seg</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-r-cc"></span><span class="m-val" id="ptr-h-route-opencc">0</span><span class="m-unit">\`seg</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-r-skip"></span><span class="m-val" id="ptr-h-route-skip">0</span><span class="m-unit">\`seg</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-dict"></span><span class="m-val" id="ptr-h-dict">0</span><span class="m-unit" id="ptr-h-dict-unit">\`0 sc</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-ld"></span><span class="m-val" id="ptr-h-ld">—</span><span class="m-unit"></span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-kw"></span><span class="m-val" id="ptr-h-kw">—</span><span class="m-unit"></span></div>
        </div>
        <div class="sec-title" id="ptr-h-sec-perf"></div>
        <div class="us-metric-table">
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-scani"></span><span class="m-val" id="ptr-h-scan-i">—</span><span class="m-unit">\`ms</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-scanl"></span><span class="m-val" id="ptr-h-scan-l">0.0</span><span class="m-unit">\`ms</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-nodes"></span><span class="m-val" id="ptr-h-nodes">0</span><span class="m-unit">\`node</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-ch"></span><span class="m-val" id="ptr-h-cache-h">0</span><span class="m-unit">\`hit</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-cm"></span><span class="m-val" id="ptr-h-cache-m">0</span><span class="m-unit">\`miss</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-cr"></span><span class="m-val" id="ptr-h-cache-rate">0</span><span class="m-unit">\`%</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-ab"></span><span class="m-val" id="ptr-h-api-b">0</span><span class="m-unit">\`req</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-aa"></span><span class="m-val" id="ptr-h-api-avg">—</span><span class="m-unit">\`ms</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-mb"></span><span class="m-val" id="ptr-h-mut-b">0</span><span class="m-unit">\`batch</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-ex"></span><span class="m-val" id="ptr-h-excluded">0</span><span class="m-unit">\`el</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-sr"></span><span class="m-val" id="ptr-h-shadows">0</span><span class="m-unit">\`root</span></div>
        </div>
      </div>
    </div>
  </div>
  <div class="us-panel-sec">
    <div class="ctrl">
      <button type="button" class="ptr-btn us-btn-sm" id="ptr-h-toggle" aria-expanded="false">
        <span id="ptr-h-toggle-lbl"></span>
        <svg class="us-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>
      </button>
      <div class="us-btn-group">
        <button type="button" class="ptr-btn us-btn-sm" id="ptr-h-export-ai"></button>
        <button type="button" class="ptr-btn us-btn-sm" id="ptr-h-copy"></button>
      </div>
    </div>
    <div class="hud-msg" id="ptr-h-msg" hidden></div>
  </div>
</aside>`;
    sr.appendChild(tpl.content.cloneNode(true));

    const get = <T extends HTMLElement>(id: string): T =>
      sr.getElementById(id) as T;

    setTextFast(get("ptr-h-title"), tr("hudTitle"));
    setTextFast(get("ptr-h-l-static"), tr("segStatic"));
    setTextFast(get("ptr-h-l-dyn"), tr("segDynamic"));
    setTextFast(get("ptr-h-l-plus"), tr("segPlus"));
    setTextFast(get("ptr-h-l-manual"), tr("segManual"));
    setTextFast(
      get("ptr-h-autospace"),
      tr(
        supportsTextAutospace()
          ? "hudAutospaceNative"
          : "hudAutospaceUnsupported"
      )
    );
    setTextFast(get("ptr-h-hover-hint"), tr("hoverHint"));
    setTextFast(get("ptr-h-kv-scope"), tr("kvScope"));
    setTextFast(get("ptr-h-kv-tpl"), tr("kvTemplate"));
    setTextFast(get("ptr-h-kv-vals"), tr("kvValues"));
    setTextFast(get("ptr-h-kv-diff"), tr("kvSpacing"));
    setTextFast(get("ptr-h-sec-cap"), tr("secCapture"));
    setTextFast(get("ptr-h-sec-perf"), tr("secPerf"));
    setTextFast(get("ptr-h-ml-seg"), tr("mSegments"));
    setTextFast(get("ptr-h-ml-scoped"), tr("mScopedHits"));
    setTextFast(get("ptr-h-ml-r-api"), tr("mRouteApi"));
    setTextFast(get("ptr-h-ml-r-cc"), tr("mRouteOpencc"));
    setTextFast(get("ptr-h-ml-r-skip"), tr("mRouteSkip"));
    setTextFast(get("ptr-h-ml-dict"), tr("mDict"));
    setTextFast(get("ptr-h-ml-ld"), tr("mLangDetector"));
    setTextFast(get("ptr-h-ml-kw"), tr("mKeywords"));
    setTextFast(get("ptr-h-ml-scani"), tr("mInitialScan"));
    setTextFast(get("ptr-h-ml-scanl"), tr("mLastScan"));
    setTextFast(get("ptr-h-ml-nodes"), tr("mNodes"));
    setTextFast(get("ptr-h-ml-ch"), tr("mCacheHit"));
    setTextFast(get("ptr-h-ml-cm"), tr("mCacheMiss"));
    setTextFast(get("ptr-h-ml-cr"), tr("mCacheRate"));
    setTextFast(get("ptr-h-ml-ab"), tr("mApiBatches"));
    setTextFast(get("ptr-h-ml-aa"), tr("mApiAvg"));
    setTextFast(get("ptr-h-ml-mb"), tr("mMutations"));
    setTextFast(get("ptr-h-ml-ex"), tr("mExcluded"));
    setTextFast(get("ptr-h-ml-sr"), tr("mShadowRoots"));
    setTextFast(get("ptr-h-toggle-lbl"), tr("btnDetails"));
    setTextFast(get("ptr-h-export-ai"), tr("btnExportAi"));
    setTextFast(get("ptr-h-copy"), tr("btnCopyDiag"));

    hudRefs = {
      asideEl: get("ptr-h-aside"),
      headEl: get("ptr-h-head"),
      spaceEl: get("ptr-h-space"),
      autospaceEl: get("ptr-h-autospace"),
      hoverHintEl: get("ptr-h-hover-hint"),
      hoverKvEl: get("ptr-h-hover-kv"),
      hoverDotEl: get("ptr-h-hover-dot"),
      hoverKindEl: get("ptr-h-hover-kind"),
      hoverRouteEl: get("ptr-h-hover-route"),
      hoverSpaceEl: get("ptr-h-hover-space"),
      hoverScopeEl: get("ptr-h-hover-scope"),
      hoverTplEl: get("ptr-h-hover-tpl"),
      hoverValsEl: get("ptr-h-hover-vals"),
      hoverSpacingDiffEl: get("ptr-h-hover-diff"),
      toggleBtn: get<HTMLButtonElement>("ptr-h-toggle"),
      exportAiBtn: get<HTMLButtonElement>("ptr-h-export-ai"),
      copyBtn: get<HTMLButtonElement>("ptr-h-copy"),
      detailsEl: get("ptr-h-details"),
      segTotalEl: get("ptr-h-seg-total"),
      segScopedEl: get("ptr-h-seg-scoped"),
      routeApiEl: get("ptr-h-route-api"),
      routeOpenccEl: get("ptr-h-route-opencc"),
      routeSkipEl: get("ptr-h-route-skip"),
      dictEl: get("ptr-h-dict"),
      dictUnitEl: get("ptr-h-dict-unit"),
      ldEl: get("ptr-h-ld"),
      kwEl: get("ptr-h-kw"),
      scanIEl: get("ptr-h-scan-i"),
      scanLEl: get("ptr-h-scan-l"),
      nodesEl: get("ptr-h-nodes"),
      cacheHEl: get("ptr-h-cache-h"),
      cacheMEl: get("ptr-h-cache-m"),
      cacheRateEl: get("ptr-h-cache-rate"),
      apiBEl: get("ptr-h-api-b"),
      apiAvgEl: get("ptr-h-api-avg"),
      mutBEl: get("ptr-h-mut-b"),
      excludedEl: get("ptr-h-excluded"),
      shadowsEl: get("ptr-h-shadows"),
      countStaticEl: get("ptr-h-c-static"),
      countDynEl: get("ptr-h-c-dyn"),
      countPlusEl: get("ptr-h-c-plus"),
      countManualEl: get("ptr-h-c-manual"),
      msgEl: get("ptr-h-msg"),
    };

    hudRefs.toggleBtn.addEventListener("click", () => {
      if (!hudRefs) {
        return;
      }
      const nextOpen = hudRefs.detailsEl.dataset.collapsed === "true";
      hudRefs.detailsEl.dataset.collapsed = String(!nextOpen);
      hudRefs.toggleBtn.setAttribute("aria-expanded", String(nextOpen));
      if (nextOpen) {
        flushTelemetry(true);
      }
    });

    hudRefs.copyBtn.addEventListener("click", () => {
      if (!hudRefs) {
        return;
      }
      triggerPulse(hudRefs.copyBtn);
      try {
        void navigator.clipboard?.writeText?.(buildDiagnostics());
      } catch {
        // Clipboard can be denied; diagnostics stay visible.
      }
    });

    hudRefs.exportAiBtn.addEventListener("click", async () => {
      if (!hudRefs) {
        return;
      }
      triggerPulse(hudRefs.exportAiBtn);
      const hostname =
        options.hostname ?? options.doc.location?.hostname ?? "page";
      const bundle = buildAiTranslationExport(options.doc, options.getDelta(), {
        hostname,
        targetLang: options.getTargetLang?.() ?? "zh-TW",
        getStyle: options.getStyle,
        siteTable: options.getSiteLocaleTable?.() ?? null,
      });
      hudRefs.msgEl.hidden = false;
      try {
        await navigator.clipboard.writeText(bundle.prompt);
        setTextFast(
          hudRefs.msgEl,
          tr("hudExportedAi", { count: bundle.count })
        );
      } catch {
        const blob = new Blob([bundle.prompt], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = options.doc.createElement("a");
        a.href = url;
        a.download = `${hostname}-ai-export.md`;
        a.click();
        URL.revokeObjectURL(url);
        setTextFast(hudRefs.msgEl, tr("hudExportDenied"));
      }
    });

    dragController?.destroy();
    dragController = createDragController({
      panel: hudEl,
      handle: hudRefs.headEl,
      stage: null,
    });

    parent.appendChild(hudEl);
    const spacing = options.getSpacingMode?.() ?? "both";
    setTextFast(hudRefs.spaceEl, tr("hudSpaceChip", { mode: spacing }));
    flushTelemetry(false);
  }

  function flushHover(): void {
    hoverRaf = null;
    const host = pendingHoverHost;
    if (!(host && options.isEnabled() && hudEl)) {
      return;
    }
    if (host === lastHoverHost) {
      return;
    }
    lastHoverHost = host;
    const label =
      host.getAttribute("data-tr-inspect-label") ??
      host.getAttribute("data-tr-inspect") ??
      "";
    const meta = hoverMeta.get(host);
    const snippet = meta?.snippet ?? "";
    updateHudHover(label, snippet, meta);
  }

  function onDocMouseOver(e: Event): void {
    if (!(options.isEnabled() && hudEl)) {
      return;
    }
    const raw = e.target as Element | null;
    if (!raw || raw.closest?.("[data-ptr-ui],[data-us-ui]")) {
      return;
    }
    const host = raw.closest?.("[data-tr-inspect]");
    if (!host || host === lastHoverHost) {
      return;
    }
    pendingHoverHost = host;
    if (!hoverRaf) {
      hoverRaf = scheduleFrame(flushHover);
    }
  }

  function startHud(): void {
    mountHud();
    if (!hoverListenerAttached) {
      options.doc.addEventListener("mouseover", onDocMouseOver, {
        passive: true,
      });
      hoverListenerAttached = true;
    }
  }

  function removeHud(): void {
    if (hoverRaf) {
      hoverRaf.cancel();
      hoverRaf = null;
    }
    if (telemetryRaf) {
      telemetryRaf.cancel();
      telemetryRaf = null;
    }
    dragController?.destroy();
    dragController = null;
    pendingHoverHost = null;
    lastHoverHost = null;
    telemetryDirty = false;
    prevTexts.clear();
    if (hoverListenerAttached) {
      options.doc.removeEventListener("mouseover", onDocMouseOver);
      hoverListenerAttached = false;
    }
    hudEl?.remove();
    options.doc.getElementById(HUD_ID)?.remove();
    hudEl = null;
    hudRefs = null;
  }

  function markSubtree(target: Element, isInitialRoot = false): void {
    if (
      target.id === "ptr-user-css" ||
      target.id === HUD_ID ||
      target.hasAttribute("data-tr-block") ||
      target.hasAttribute("data-tr-orig") ||
      target.hasAttribute("data-tr-dst") ||
      target.hasAttribute("data-ptr-ui") ||
      target.hasAttribute("data-us-ui") ||
      target.closest?.("[data-ptr-ui],[data-us-ui]") !== null
    ) {
      return;
    }
    const delta = options.getDelta();
    const metrics = options.metrics;
    const scanStartedAt = nowMs();
    const shadowRoots = new Set<ShadowRoot>();
    const segs = collectSegments(target, delta, {
      ...(options.getStyle ? { getStyle: options.getStyle } : {}),
      shadowRoots,
      onExcluded: () => {
        if (metrics) {
          metrics.excludedCount += 1;
        }
      },
    });
    if (metrics) {
      recordScanTiming(metrics, nowMs() - scanStartedAt, segs.length);
      metrics.shadowRootCount += shadowRoots.size;
    }
    if (shadowRoots.size > 0) {
      for (const sr of shadowRoots) {
        discoveredShadows.add(sr);
        ensureObserved(sr);
      }
      options.onShadowRoots?.(shadowRoots);
    }

    const siteTable = options.getSiteLocaleTable?.() ?? null;
    const spacingMode = options.getSpacingMode?.() ?? "both";
    const punctNorm = options.getPunctNorm?.() ?? "zh-norm";
    const targetLang = options.getTargetLang?.() ?? "";
    const plainTexts: string[] | null =
      metrics && (isInitialRoot || metrics.keywordsSample.length === 0)
        ? []
        : null;

    for (const s of segs) {
      const encoded = encodeInlineNodes(s.nodes, delta);
      const plain = s.nodes
        .map((n) => n.textContent ?? "")
        .join("")
        .trim();
      if (plainTexts) {
        plainTexts.push(plain);
      }
      // Route purely by the segment's own text; page-level <html lang> or
      // ancestor [lang] attributes are intentionally ignored here.
      const route = routeSegment(plain, targetLang);
      const manualHit = siteTable
        ? matchSiteTranslation(encoded.payloadHtml, siteTable, s.container)
        : null;
      const ext = extractTemplate(encoded.payloadHtml);
      let kind: InspectKind = s.sourceRule === "+" ? "+" : "auto-static";
      if (manualHit) {
        kind = "manual";
      } else if (s.sourceRule === "auto" && ext.kind === "dynamic") {
        kind = "auto-dynamic";
      }

      if (metrics) {
        metrics.segments.total += 1;
        if (kind === "manual") {
          metrics.segments.manual += 1;
        } else if (kind === "+") {
          metrics.segments.plus += 1;
        } else if (kind === "auto-dynamic") {
          metrics.segments.autoDynamic += 1;
        } else {
          metrics.segments.autoStatic += 1;
        }
        if (kind === "manual" && manualHit?.scope) {
          metrics.segments.scopedHits += 1;
        }
        if (route.action === "skip") {
          metrics.routing.skip += 1;
        } else if (route.action === "opencc") {
          metrics.routing.opencc += 1;
        } else {
          metrics.routing.api += 1;
        }
      }

      const previewSource = manualHit?.html
        ? manualHit.html.replace(/<[^>]+>/gu, "")
        : plain;
      const spaceCheck = inspectTextSpacing(
        previewSource,
        punctNorm,
        spacingMode
      );
      const spacingSummary =
        spacingMode === "off"
          ? "off"
          : `+${spaceCheck.insertedSpaces} JS · ${spacingMode}`;
      const spacingDiff =
        spaceCheck.out === previewSource
          ? spacingMode === "w3c"
            ? "CSS text-autospace"
            : "—"
          : `${previewSource.slice(0, 36)} -> ${spaceCheck.out.slice(0, 36)}`;

      hoverMeta.set(s.container, {
        kind,
        route: `${detectSegmentBcp47(plain).lang} -> ${route.action}`,
        spacingMode,
        spacingSummary,
        spacingDiff,
        mods: [...s.modifiers].sort(),
        template: ext.template,
        values: ext.values,
        scope: manualHit?.scope ?? null,
        snippet: plain.replace(/\s+/gu, " ").slice(0, 60),
      });

      renderInspectMarker(s, options.doc, { kind, spacingMode });
    }
    if (metrics && plainTexts && plainTexts.length > 0) {
      metrics.keywordsSample = extractPageKeywords(plainTexts);
    }
    if (isInitialRoot) {
      flushTelemetry(false);
    } else if (
      !telemetryDirty ||
      hudRefs?.detailsEl.dataset.collapsed === "false"
    ) {
      scheduleTelemetryFlush();
    }
  }

  function stopObserver(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    pendingRoots.clear();
    mutationObserver?.disconnect();
    mutationObserver = null;
    removeHud();
  }

  function startObserver(root: Element): void {
    if (mutationObserver || typeof MutationObserver === "undefined") {
      return;
    }
    mutationObserver = new MutationObserver((records) => {
      if (!options.isEnabled()) {
        return;
      }
      for (const rec of records) {
        const recEl =
          rec.target.nodeType === 1
            ? (rec.target as Element)
            : rec.target.parentElement;
        if (
          recEl &&
          (recEl.hasAttribute("data-ptr-ui") ||
            recEl.hasAttribute("data-us-ui") ||
            recEl.closest?.("[data-ptr-ui],[data-us-ui]"))
        ) {
          continue;
        }
        if (rec.type === "attributes" && rec.target.nodeType === 1) {
          pendingRoots.add(rec.target as Element);
          continue;
        }
        if (rec.type !== "childList") {
          continue;
        }
        for (const added of Array.from(rec.addedNodes)) {
          if (added.nodeType === 1) {
            const addedEl = added as Element;
            if (
              !(
                addedEl.hasAttribute("data-ptr-ui") ||
                addedEl.hasAttribute("data-us-ui") ||
                addedEl.closest?.("[data-ptr-ui],[data-us-ui]")
              )
            ) {
              pendingRoots.add(addedEl);
            }
          } else if (added.nodeType === 3 && rec.target.nodeType === 1) {
            pendingRoots.add(rec.target as Element);
          }
        }
      }
      if (pendingRoots.size > 0 && flushTimer === null) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          const roots = Array.from(pendingRoots);
          pendingRoots.clear();
          const rootSet = new Set(roots);
          for (const r of roots) {
            if (!r.isConnected) {
              continue;
            }
            let hasAncestor = false;
            let p = r.parentElement;
            while (p) {
              if (rootSet.has(p)) {
                hasAncestor = true;
                break;
              }
              p = p.parentElement;
            }
            if (!hasAncestor) {
              markSubtree(r, false);
            }
          }
        }, 120);
      }
    });
    ensureObserved(root);
    for (const sr of discoveredShadows) {
      ensureObserved(sr);
    }
  }

  function clearMarkersIn(root: ParentNode): void {
    for (const el of Array.from(root.querySelectorAll("[data-tr-inspect]"))) {
      el.removeAttribute("data-tr-inspect");
      el.removeAttribute("data-tr-inspect-kind");
      el.removeAttribute("data-tr-inspect-space");
      el.removeAttribute("data-tr-inspect-mods");
      el.removeAttribute("data-tr-inspect-label");
    }
  }

  function clearMarkers(): void {
    clearMarkersIn(options.doc);
    for (const sr of discoveredShadows) {
      clearMarkersIn(sr);
    }
  }

  function syncFromConfig(): void {
    const root = options.doc.body ?? options.doc.documentElement;
    if (options.isEnabled()) {
      startHud();
      if (root) {
        startObserver(root);
        markSubtree(root, true);
      }
    } else {
      stopObserver();
      clearMarkers();
    }
  }

  function registerMenu(): void {
    const caption = options.formatLabel
      ? options.formatLabel(options.isEnabled())
      : tr("inspectMode", {
          state: tr(options.isEnabled() ? "on" : "off"),
        });

    if (
      registeredHandle !== undefined &&
      registeredHandle !== INSPECT_MENU_ID
    ) {
      gmUnregisterMenuCommand(registeredHandle);
    }
    const handle = gmMenuCommand(caption, toggle, { id: INSPECT_MENU_ID });
    registeredHandle = handle ?? caption;
  }

  function toggle(): void {
    options.setEnabled(!options.isEnabled());
    options.onAfterChange?.();
    syncFromConfig();
    registerMenu();
  }

  return {
    syncFromConfig,
    refreshTheme: syncThemeOnHud,
    registerMenu,
    toggle,
    stop: stopObserver,
  };
}
