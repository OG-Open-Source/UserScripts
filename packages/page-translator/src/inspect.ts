import { type GMMenuHandle, gmMenuCommand, gmUnregisterMenuCommand } from "@userscripts/shared";
import type { StyleReader } from "./capture/display-role";
import { encodeInlineNodes } from "./capture/inline-codec";
import { collectSegments } from "./capture/segmenter";
import type { SpacingMode } from "./config";
import { getMetricsSnapshot, type PtrMetrics, recordScanTiming } from "./metrics";
import { type InspectKind, renderInspectMarker } from "./renderer";
import type { CompiledSiteDelta } from "./site-rules";
import { extractPageKeywords } from "./transform/keywords";
import { detectSegmentBcp47, routeSegment } from "./transform/lang-route";
import { extractTemplate, matchSiteTranslation, type SiteLocaleTable } from "./transform/template";
import { getSharedPanelCss } from "./ui-theme";

const INSPECT_MENU_ID = "ptr-inspect";
const HUD_ID = "ptr-inspect-hud";
const HUD_STYLE_ID = "ptr-inspect-hud-style";

const OBSERVE_CONFIG: MutationObserverInit = {
	childList: true,
	subtree: true,
	attributes: true,
	attributeFilter: ["style", "class", "hidden", "open", "aria-hidden", "aria-expanded"],
};

function nowMs(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function scheduleFrame(cb: () => void): { id: number; cancel: () => void } {
	if (typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function") {
		const id = requestAnimationFrame(cb);
		return { id, cancel: () => cancelAnimationFrame(id) };
	}
	const id = setTimeout(cb, 16) as unknown as number;
	return { id, cancel: () => clearTimeout(id) };
}

interface SegmentHoverMeta {
	kind: InspectKind;
	route: string;
	spacingMode: string;
	mods: string[];
	template: string;
	values: string[];
	scope: string | null;
	snippet: string;
}

interface HudRefs {
	spaceEl: HTMLElement;
	hoverEl: HTMLElement;
	toggleBtn: HTMLButtonElement;
	copyBtn: HTMLButtonElement;
	detailsEl: HTMLElement;
	segEl: HTMLElement;
	routeEl: HTMLElement;
	dictEl: HTMLElement;
	ldEl: HTMLElement;
	kwEl: HTMLElement;
	scanIEl: HTMLElement;
	scanLEl: HTMLElement;
	nodesEl: HTMLElement;
	cacheHEl: HTMLElement;
	cacheMEl: HTMLElement;
	cacheRateEl: HTMLElement;
	apiBEl: HTMLElement;
	apiAvgEl: HTMLElement;
	mutBEl: HTMLElement;
	excludedEl: HTMLElement;
	shadowsEl: HTMLElement;
	countStaticEl: HTMLElement;
	countDynEl: HTMLElement;
	countPlusEl: HTMLElement;
	countManualEl: HTMLElement;
}

export interface InspectControllerOptions {
	doc: Document;
	getDelta: () => CompiledSiteDelta;
	isEnabled: () => boolean;
	setEnabled: (next: boolean) => void;
	formatLabel?: (enabled: boolean) => string;
	onAfterChange?: () => void;
	onShadowRoots?: (roots: Set<ShadowRoot>) => void;
	getStyle?: StyleReader;
	getSiteLocaleTable?: () => SiteLocaleTable | null;
	getSpacingMode?: () => SpacingMode;
	metrics?: PtrMetrics;
	getTargetLang?: () => string;
}

const hudSheetCache = new WeakMap<ShadowRoot, CSSStyleSheet>();

function applyHudCss(sr: ShadowRoot, doc: Document, css: string): void {
	if (typeof CSSStyleSheet !== "undefined" && Array.isArray(sr.adoptedStyleSheets)) {
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
	let hoverListenerAttached = false;
	let pendingHoverHost: Element | null = null;
	let lastHoverHost: Element | null = null;
	let hoverRaf: { id: number; cancel: () => void } | null = null;
	let telemetryRaf: { id: number; cancel: () => void } | null = null;
	let telemetryDirty = false;
	const prevTexts = new Map<HTMLElement, string>();

	function setTextFast(el: HTMLElement | null | undefined, text: string): void {
		if (!el) return;
		if (prevTexts.get(el) === text) return;
		prevTexts.set(el, text);
		el.textContent = text;
	}

	function ensureObserved(node: Node): void {
		if (!mutationObserver || observedRoots.has(node)) return;
		observedRoots.add(node);
		mutationObserver.observe(node, OBSERVE_CONFIG);
	}

	const hoverMeta = new WeakMap<Element, SegmentHoverMeta>();

	function updateHudHover(label: string, preview: string, meta?: SegmentHoverMeta | null): void {
		if (!hudRefs) return;
		if (meta) {
			const parts: string[] = [`kind: ${meta.kind}`, `route: ${meta.route}`];
			if (meta.spacingMode) parts.push(`spacing: ${meta.spacingMode}`);
			if (meta.mods.length > 0) parts.push(`mods: ${meta.mods.join(",")}`);
			if (meta.scope) parts.push(`scope: ${meta.scope}`);
			if (meta.template) parts.push(`template: ${meta.template.slice(0, 60)}`);
			if (meta.values.length > 0) parts.push(`values: ${meta.values.join(", ")}`);
			const text = label ? `${label} — ${parts.join(" | ")}` : parts.join(" | ");
			setTextFast(hudRefs.hoverEl, text);
			return;
		}
		setTextFast(
			hudRefs.hoverEl,
			label ? `${label}${preview ? ` — ${preview}` : ""}` : "Hover any outlined block to inspect capture metadata.",
		);
	}

	function flushTelemetry(force = false): void {
		if (!hudRefs || !options.metrics) return;
		const snap = getMetricsSnapshot(options.metrics);
		setTextFast(hudRefs.countStaticEl, String(snap.segments.autoStatic));
		setTextFast(hudRefs.countDynEl, String(snap.segments.autoDynamic));
		setTextFast(hudRefs.countPlusEl, String(snap.segments.plus));
		setTextFast(hudRefs.countManualEl, String(snap.segments.manual));

		const isHidden = hudRefs.detailsEl.hasAttribute("hidden");
		if (isHidden && !force) {
			return;
		}
		telemetryDirty = false;

		setTextFast(
			hudRefs.segEl,
			`total ${snap.segments.total} | static ${snap.segments.autoStatic} | dynamic ${snap.segments.autoDynamic} | + ${snap.segments.plus} | manual ${snap.segments.manual} | scoped ${snap.segments.scopedHits}`,
		);
		setTextFast(hudRefs.routeEl, `api ${snap.routing.api} | opencc ${snap.routing.opencc} | skip ${snap.routing.skip}`);
		setTextFast(
			hudRefs.dictEl,
			`loaded ${snap.dictLoaded ? "yes" : "no"} | static ${snap.dictCounts.static} | dynamic ${snap.dictCounts.dynamic} | scoped ${snap.dictCounts.scoped}`,
		);
		setTextFast(hudRefs.ldEl, snap.languageDetectorStatus);
		setTextFast(hudRefs.kwEl, snap.keywordsSample.slice(0, 10).join(", ") || "—");
		setTextFast(hudRefs.scanIEl, snap.initialScanMs === null ? "—" : snap.initialScanMs.toFixed(1));
		setTextFast(hudRefs.scanLEl, snap.lastScanMs.toFixed(1));
		setTextFast(hudRefs.nodesEl, String(snap.nodesVisited));
		setTextFast(hudRefs.cacheHEl, String(snap.cacheHits));
		setTextFast(hudRefs.cacheMEl, String(snap.cacheMisses));
		setTextFast(hudRefs.cacheRateEl, `${snap.cacheHitRatePct}%`);
		setTextFast(hudRefs.apiBEl, String(snap.apiBatches));
		setTextFast(hudRefs.apiAvgEl, snap.apiBatches > 0 ? snap.avgApiBatchMs.toFixed(1) : "—");
		setTextFast(hudRefs.mutBEl, String(snap.mutationBatches));
		setTextFast(hudRefs.excludedEl, String(snap.excludedCount));
		setTextFast(hudRefs.shadowsEl, String(snap.shadowRootCount));
	}

	function scheduleTelemetryFlush(): void {
		telemetryDirty = true;
		if (telemetryRaf) return;
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
			if (kind) segCounts[kind] = (segCounts[kind] ?? 0) + 1;
			const meta = hoverMeta.get(el);
			if (meta?.snippet && samples.length < 40) samples.push(meta.snippet);
		}
		if (options.metrics && options.metrics.keywordsSample.length === 0 && samples.length > 0) {
			options.metrics.keywordsSample = extractPageKeywords(samples);
		}
		const out: Record<string, unknown> = {};
		if (options.metrics) out.metrics = getMetricsSnapshot(options.metrics);
		out.segmentKindCounts = segCounts;
		return JSON.stringify(out, null, 2);
	}

	function mountHud(): void {
		const parent = options.doc.body ?? options.doc.documentElement;
		if (!parent) return;
		if (hudEl?.isConnected && hudRefs) {
			const spacing = options.getSpacingMode?.() ?? "both";
			setTextFast(hudRefs.spaceEl, `space: ${spacing}`);
			flushTelemetry(false);
			return;
		}
		const existing = options.doc.getElementById(HUD_ID);
		if (existing) existing.remove();

		hudEl = options.doc.createElement("div");
		hudEl.id = HUD_ID;
		hudEl.setAttribute("data-ptr-ui", "1");
		const sr = hudEl.attachShadow({ mode: "open" });

		const css = `${getSharedPanelCss()}
.hud {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 2147483647;
  width: 340px;
  pointer-events: auto;
}
.chip-row { display: flex; flex-wrap: wrap; gap: 4px; }
.dot-static { background: #3b82f6; }
.dot-dyn { background: #a855f7; }
.dot-plus { background: #10b981; }
.dot-manual { background: #f59e0b; }
.hover {
  color: var(--us-muted);
  font-family: var(--us-mono);
  font-size: 11px;
  word-break: break-word;
  background: var(--us-surface);
  border: 1px solid var(--us-line);
  border-radius: 4px;
  padding: 5px 7px;
  max-height: 64px;
  overflow-y: auto;
  contain: layout paint;
}
.sec-title { font-size: 11px; font-weight: 600; margin: 6px 0 3px; text-transform: uppercase; letter-spacing: .04em; color: var(--us-muted); }
.sec-title:first-child { margin-top: 0; }
.trow { display: flex; justify-content: space-between; gap: 10px; padding: 1px 0; font-family: var(--us-mono); font-variant-numeric: tabular-nums; font-size: 11px; border-bottom: 1px dashed var(--us-line); }
.trow:last-child { border-bottom: none; }
.trow .l { color: var(--us-muted); }
.trow .v { word-break: break-word; text-align: right; }
.ctrl { display: flex; justify-content: space-between; align-items: center; gap: 8px; }`;

		applyHudCss(sr, options.doc, css);

		const tpl = options.doc.createElement("template");
		tpl.innerHTML = `
<aside class="us-panel hud" aria-label="Capture Preview">
  <div class="us-panel-head">
    <span class="us-panel-title">Capture Preview</span>
    <span class="us-chip us-mono" id="ptr-h-space"></span>
  </div>
  <div class="us-panel-sec">
    <div class="chip-row">
      <span class="us-chip"><i class="us-dot dot-static"></i>static <span id="ptr-h-c-static">0</span></span>
      <span class="us-chip"><i class="us-dot dot-dyn"></i>auto-dynamic <span id="ptr-h-c-dyn">0</span></span>
      <span class="us-chip"><i class="us-dot dot-plus"></i>+ <span id="ptr-h-c-plus">0</span></span>
      <span class="us-chip"><i class="us-dot dot-manual"></i>manual <span id="ptr-h-c-manual">0</span></span>
    </div>
  </div>
  <div class="us-panel-sec">
    <div class="hover" id="ptr-h-hover">Hover any outlined block to inspect capture metadata.</div>
  </div>
  <div class="us-panel-sec" id="ptr-h-details" hidden>
    <div class="sec-title">1. 能力（網頁判斷與採集）</div>
    <div class="trow"><span class="l">Segments</span><span class="v" id="ptr-h-seg">—</span></div>
    <div class="trow"><span class="l">Routing</span><span class="v" id="ptr-h-route">—</span></div>
    <div class="trow"><span class="l">Dict</span><span class="v" id="ptr-h-dict">—</span></div>
    <div class="trow"><span class="l">LangDetector</span><span class="v" id="ptr-h-ld">—</span></div>
    <div class="trow"><span class="l">Keywords</span><span class="v" id="ptr-h-kw">—</span></div>
    <div class="sec-title">2. 性能（耗時與快取）</div>
    <div class="trow"><span class="l">Scan initial (ms)</span><span class="v" id="ptr-h-scan-i">—</span></div>
    <div class="trow"><span class="l">Scan last (ms)</span><span class="v" id="ptr-h-scan-l">—</span></div>
    <div class="trow"><span class="l">Nodes visited</span><span class="v" id="ptr-h-nodes">0</span></div>
    <div class="trow"><span class="l">Cache hits</span><span class="v" id="ptr-h-cache-h">0</span></div>
    <div class="trow"><span class="l">Cache misses</span><span class="v" id="ptr-h-cache-m">0</span></div>
    <div class="trow"><span class="l">Cache hit rate</span><span class="v" id="ptr-h-cache-rate">0%</span></div>
    <div class="trow"><span class="l">API batches</span><span class="v" id="ptr-h-api-b">0</span></div>
    <div class="trow"><span class="l">Avg API batch (ms)</span><span class="v" id="ptr-h-api-avg">—</span></div>
    <div class="trow"><span class="l">Mutation batches</span><span class="v" id="ptr-h-mut-b">0</span></div>
    <div class="trow"><span class="l">Excluded</span><span class="v" id="ptr-h-excluded">0</span></div>
    <div class="trow"><span class="l">Shadow roots</span><span class="v" id="ptr-h-shadows">0</span></div>
  </div>
  <div class="us-panel-sec ctrl">
    <button type="button" class="ptr-btn us-btn-sm" id="ptr-h-toggle" aria-expanded="false">
      <span>Details</span>
      <svg class="us-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>
    </button>
    <button type="button" class="ptr-btn us-btn-sm" id="ptr-h-copy">Copy Diagnostics</button>
  </div>
</aside>`;
		sr.appendChild(tpl.content.cloneNode(true));

		hudRefs = {
			spaceEl: sr.getElementById("ptr-h-space") as HTMLElement,
			hoverEl: sr.getElementById("ptr-h-hover") as HTMLElement,
			toggleBtn: sr.getElementById("ptr-h-toggle") as HTMLButtonElement,
			copyBtn: sr.getElementById("ptr-h-copy") as HTMLButtonElement,
			detailsEl: sr.getElementById("ptr-h-details") as HTMLElement,
			segEl: sr.getElementById("ptr-h-seg") as HTMLElement,
			routeEl: sr.getElementById("ptr-h-route") as HTMLElement,
			dictEl: sr.getElementById("ptr-h-dict") as HTMLElement,
			ldEl: sr.getElementById("ptr-h-ld") as HTMLElement,
			kwEl: sr.getElementById("ptr-h-kw") as HTMLElement,
			scanIEl: sr.getElementById("ptr-h-scan-i") as HTMLElement,
			scanLEl: sr.getElementById("ptr-h-scan-l") as HTMLElement,
			nodesEl: sr.getElementById("ptr-h-nodes") as HTMLElement,
			cacheHEl: sr.getElementById("ptr-h-cache-h") as HTMLElement,
			cacheMEl: sr.getElementById("ptr-h-cache-m") as HTMLElement,
			cacheRateEl: sr.getElementById("ptr-h-cache-rate") as HTMLElement,
			apiBEl: sr.getElementById("ptr-h-api-b") as HTMLElement,
			apiAvgEl: sr.getElementById("ptr-h-api-avg") as HTMLElement,
			mutBEl: sr.getElementById("ptr-h-mut-b") as HTMLElement,
			excludedEl: sr.getElementById("ptr-h-excluded") as HTMLElement,
			shadowsEl: sr.getElementById("ptr-h-shadows") as HTMLElement,
			countStaticEl: sr.getElementById("ptr-h-c-static") as HTMLElement,
			countDynEl: sr.getElementById("ptr-h-c-dyn") as HTMLElement,
			countPlusEl: sr.getElementById("ptr-h-c-plus") as HTMLElement,
			countManualEl: sr.getElementById("ptr-h-c-manual") as HTMLElement,
		};

		hudRefs.toggleBtn.addEventListener("click", () => {
			if (!hudRefs) return;
			const nextOpen = hudRefs.detailsEl.hasAttribute("hidden");
			if (nextOpen) {
				hudRefs.detailsEl.removeAttribute("hidden");
				hudRefs.toggleBtn.setAttribute("aria-expanded", "true");
				flushTelemetry(true);
			} else {
				hudRefs.detailsEl.setAttribute("hidden", "");
				hudRefs.toggleBtn.setAttribute("aria-expanded", "false");
			}
		});

		hudRefs.copyBtn.addEventListener("click", () => {
			try {
				void navigator.clipboard?.writeText?.(buildDiagnostics());
			} catch {
				// Clipboard can be denied; diagnostics stay visible.
			}
		});

		parent.appendChild(hudEl);
		const spacing = options.getSpacingMode?.() ?? "both";
		setTextFast(hudRefs.spaceEl, `space: ${spacing}`);
		flushTelemetry(false);
	}

	function flushHover(): void {
		hoverRaf = null;
		const host = pendingHoverHost;
		if (!host || !options.isEnabled() || !hudEl) return;
		if (host === lastHoverHost) return;
		lastHoverHost = host;
		const label = host.getAttribute("data-tr-inspect-label") ?? host.getAttribute("data-tr-inspect") ?? "";
		const meta = hoverMeta.get(host);
		const snippet = meta?.snippet ?? "";
		updateHudHover(label, snippet, meta);
	}

	function onDocMouseOver(e: Event): void {
		if (!options.isEnabled() || !hudEl) return;
		const raw = e.target as Element | null;
		if (!raw || raw.closest?.("[data-ptr-ui]")) return;
		const host = raw.closest?.("[data-tr-inspect]");
		if (!host || host === lastHoverHost) return;
		pendingHoverHost = host;
		if (!hoverRaf) {
			hoverRaf = scheduleFrame(flushHover);
		}
	}

	function startHud(): void {
		mountHud();
		if (!hoverListenerAttached) {
			options.doc.addEventListener("mouseover", onDocMouseOver, { passive: true });
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
			target.closest?.("[data-ptr-ui]") !== null
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
				if (metrics) metrics.excludedCount += 1;
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
		const spacingMode = options.getSpacingMode?.();
		const targetLang = options.getTargetLang?.() ?? "";
		const plainTexts: string[] | null = metrics && (isInitialRoot || metrics.keywordsSample.length === 0) ? [] : null;

		for (const s of segs) {
			const encoded = encodeInlineNodes(s.nodes, delta);
			const plain = s.nodes
				.map((n) => n.textContent ?? "")
				.join("")
				.trim();
			if (plainTexts) plainTexts.push(plain);
			// Route purely by the segment's own text; page-level <html lang> or
			// ancestor [lang] attributes are intentionally ignored here.
			const route = routeSegment(plain, targetLang);
			const manualHit = siteTable ? matchSiteTranslation(encoded.payloadHtml, siteTable, s.container) : null;
			const ext = extractTemplate(encoded.payloadHtml);
			let kind: InspectKind = s.sourceRule === "+" ? "+" : "auto-static";
			if (manualHit) {
				kind = "manual";
			} else if (s.sourceRule === "auto" && ext.kind === "dynamic") {
				kind = "auto-dynamic";
			}

			if (metrics) {
				metrics.segments.total += 1;
				if (kind === "manual") metrics.segments.manual += 1;
				else if (kind === "+") metrics.segments.plus += 1;
				else if (kind === "auto-dynamic") metrics.segments.autoDynamic += 1;
				else metrics.segments.autoStatic += 1;
				if (kind === "manual" && manualHit?.scope) metrics.segments.scopedHits += 1;
				if (route.action === "skip") metrics.routing.skip += 1;
				else if (route.action === "opencc") metrics.routing.opencc += 1;
				else metrics.routing.api += 1;
			}

			hoverMeta.set(s.container, {
				kind,
				route: `${detectSegmentBcp47(plain).lang} -> ${route.action}`,
				spacingMode: spacingMode ?? "",
				mods: [...s.modifiers].sort(),
				template: ext.template,
				values: ext.values,
				scope: manualHit?.scope ?? null,
				snippet: plain.replace(/\s+/g, " ").slice(0, 60),
			});

			renderInspectMarker(s, options.doc, { kind, spacingMode });
		}
		if (metrics && plainTexts && plainTexts.length > 0) {
			metrics.keywordsSample = extractPageKeywords(plainTexts);
		}
		if (isInitialRoot) {
			flushTelemetry(false);
		} else if (!telemetryDirty || hudRefs?.detailsEl.hasAttribute("hidden") === false) {
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
		if (mutationObserver || typeof MutationObserver === "undefined") return;
		mutationObserver = new MutationObserver((records) => {
			if (!options.isEnabled()) return;
			for (const rec of records) {
				const recEl = rec.target.nodeType === 1 ? (rec.target as Element) : rec.target.parentElement;
				if (recEl && (recEl.hasAttribute("data-ptr-ui") || recEl.closest?.("[data-ptr-ui]"))) {
					continue;
				}
				if (rec.type === "attributes" && rec.target.nodeType === 1) {
					pendingRoots.add(rec.target as Element);
					continue;
				}
				if (rec.type !== "childList") continue;
				for (const added of Array.from(rec.addedNodes)) {
					if (added.nodeType === 1) {
						const addedEl = added as Element;
						if (!addedEl.hasAttribute("data-ptr-ui") && !addedEl.closest?.("[data-ptr-ui]")) {
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
						if (!r.isConnected) continue;
						let hasAncestor = false;
						let p = r.parentElement;
						while (p) {
							if (rootSet.has(p)) {
								hasAncestor = true;
								break;
							}
							p = p.parentElement;
						}
						if (!hasAncestor) markSubtree(r, false);
					}
				}, 120);
			}
		});
		ensureObserved(root);
		for (const sr of discoveredShadows) ensureObserved(sr);
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
			: `Capture Preview: ${options.isEnabled() ? "ON" : "OFF"}`;

		if (registeredHandle !== undefined && registeredHandle !== INSPECT_MENU_ID) {
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

	return { syncFromConfig, registerMenu, toggle, stop: stopObserver };
}
