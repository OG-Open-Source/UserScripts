import { type GMMenuHandle, gmMenuCommand, gmUnregisterMenuCommand } from "@userscripts/shared";
import type { StyleReader } from "./capture/display-role";
import { encodeInlineNodes } from "./capture/inline-codec";
import { collectSegments, type TranslationSegment } from "./capture/segmenter";
import type { CompiledSiteDelta } from "./site-rules";
import {
	extractTemplate,
	interpolateTemplate,
	matchSiteTranslation,
	type SiteLocaleScope,
	type SiteLocaleTable,
	suggestScopeSelector,
} from "./transform/template";
import { getSharedPanelCss } from "./ui-theme";

const VOLUNTEER_MENU_ID = "ptr-volunteer";
const VOLUNTEER_CLICK_MENU_ID = "ptr-volunteer-block-clicks";
const VOLUNTEER_STYLE_ID = "ptr-vol-style";

export interface VolunteerControllerOptions {
	doc: Document;
	hostname: string;
	/** Ignored legacy field: volunteer exports never include a pathname. */
	pathname?: string;
	getTargetLang: () => string;
	getDelta: () => CompiledSiteDelta;
	getSiteLocaleTable: () => SiteLocaleTable | null;
	isEnabled: () => boolean;
	setEnabled: (next: boolean) => void;
	formatLabel?: (enabled: boolean) => string;
	isClickBlocked?: () => boolean;
	setClickBlocked?: (next: boolean) => void;
	formatClickBlockLabel?: (blocked: boolean) => string;
	getStyle?: StyleReader;
}

interface CapturedEntry {
	seg: TranslationSegment;
	kind: "static" | "dynamic";
	key: string;
	values: string[];
	hit: boolean;
	matchedScope: string | null;
}

interface VolunteerRefs {
	titleEl: HTMLElement;
	statsEl: HTMLElement;
	editorEl: HTMLElement;
	emptyEl: HTMLElement;
	badgeEl: HTMLElement;
	posEl: HTMLElement;
	valuesEl: HTMLElement;
	keyEl: HTMLElement;
	scopeInput: HTMLInputElement;
	suggestBtn: HTMLButtonElement;
	valInput: HTMLInputElement;
	prevBtn: HTMLButtonElement;
	nextBtn: HTMLButtonElement;
	saveBtn: HTMLButtonElement;
	blockClicksBtn: HTMLButtonElement;
	rescanBtn: HTMLButtonElement;
	copyBtn: HTMLButtonElement;
	dlBtn: HTMLButtonElement;
	msgEl: HTMLElement;
}

const volSheetCache = new WeakMap<ShadowRoot, CSSStyleSheet>();

function applyVolCss(sr: ShadowRoot, doc: Document, css: string): void {
	if (typeof CSSStyleSheet !== "undefined" && Array.isArray(sr.adoptedStyleSheets)) {
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
	let styleEl = sr.getElementById(VOLUNTEER_STYLE_ID) as HTMLStyleElement | null;
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

export function createVolunteerController(options: VolunteerControllerOptions) {
	let hostEl: HTMLElement | null = null;
	let refs: VolunteerRefs | null = null;
	let registeredHandle: GMMenuHandle | undefined;
	let registeredClickHandle: GMMenuHandle | undefined;
	let menuRegistered = false;
	let internalClickBlocked = false;
	const draftStatic: Record<string, string> = {};
	const draftDynamic: Record<string, string> = {};
	const draftScoped: Record<string, SiteLocaleScope> = {};
	let capturedEntries: CapturedEntry[] = [];
	let containerToIndex = new WeakMap<Element, number>();
	let staticCount = 0;
	let dynamicCount = 0;
	let hitCount = 0;
	let selectedIdx = 0;
	let lastRenderedIdx = -1;
	let lastRenderedKey = "";
	const prevTexts = new Map<HTMLElement, string>();

	function setTextFast(el: HTMLElement | null | undefined, text: string): void {
		if (!el) return;
		if (prevTexts.get(el) === text) return;
		prevTexts.set(el, text);
		el.textContent = text;
	}

	function isClickBlocked(): boolean {
		if (!options.isEnabled()) return false;
		return options.isClickBlocked ? options.isClickBlocked() : internalClickBlocked;
	}

	function setClickBlockedState(next: boolean): void {
		const resolved = options.isEnabled() ? next : false;
		internalClickBlocked = resolved;
		options.setClickBlocked?.(resolved);
	}

	function getEventCaptureRoot(): EventTarget {
		return options.doc.defaultView ?? options.doc;
	}

	function scanPage(): void {
		const root = options.doc.body ?? options.doc.documentElement;
		if (!root) return;
		const delta = options.getDelta();
		const table = options.getSiteLocaleTable();
		const segs = collectSegments(root, delta, options.getStyle ? { getStyle: options.getStyle } : undefined);

		const nextIndex = new WeakMap<Element, number>();
		let nextStatic = 0;
		let nextDyn = 0;
		let nextHits = 0;

		capturedEntries = segs.map((seg, idx) => {
			nextIndex.set(seg.container, idx);
			const encoded = encodeInlineNodes(seg.nodes, delta);
			const ext = extractTemplate(encoded.payloadHtml);
			const matchHit = matchSiteTranslation(encoded.payloadHtml, table, seg.container);
			const hit = Boolean(matchHit);
			if (ext.kind === "static") nextStatic += 1;
			else nextDyn += 1;
			if (hit) nextHits += 1;
			return { seg, kind: ext.kind, key: ext.template, values: ext.values, hit, matchedScope: matchHit?.scope ?? null };
		});

		containerToIndex = nextIndex;
		staticCount = nextStatic;
		dynamicCount = nextDyn;
		hitCount = nextHits;
		if (selectedIdx >= capturedEntries.length) selectedIdx = 0;
	}

	function getExportJson(): string {
		const staticOut: Record<string, string> = {};
		for (const [k, v] of Object.entries(draftStatic)) {
			if (isNonEmptyScopedValue(v)) staticOut[k] = v;
		}
		const dynamicOut: Record<string, string> = {};
		for (const [k, v] of Object.entries(draftDynamic)) {
			if (isNonEmptyScopedValue(v)) dynamicOut[k] = v;
		}
		const scopedOut: Record<string, SiteLocaleScope> = {};
		for (const [selector, scope] of Object.entries(draftScoped)) {
			const clean: SiteLocaleScope = {};
			const scopedStatic = Object.fromEntries(
				Object.entries(scope.static ?? {}).filter(([, v]) => isNonEmptyScopedValue(v)),
			);
			const scopedDynamic = Object.fromEntries(
				Object.entries(scope.dynamic ?? {}).filter(([, v]) => isNonEmptyScopedValue(v)),
			);
			if (Object.keys(scopedStatic).length > 0) clean.static = scopedStatic;
			if (Object.keys(scopedDynamic).length > 0) clean.dynamic = scopedDynamic;
			if (clean.static || clean.dynamic) scopedOut[selector] = clean;
		}
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
			2,
		);
	}

	function syncClickBlockButton(): void {
		if (!refs) return;
		const blocked = isClickBlocked();
		setTextFast(refs.blockClicksBtn, blocked ? "Click Lock: ON" : "Click Lock: OFF");
		refs.blockClicksBtn.setAttribute("aria-pressed", blocked ? "true" : "false");
		refs.blockClicksBtn.disabled = !options.isEnabled();
	}

	function updateStats(): void {
		if (!refs) return;
		setTextFast(refs.statsEl, `Static: ${staticCount} | Dynamic: ${dynamicCount} | Manual Hits: ${hitCount}`);
	}

	function patchPanel(): void {
		if (!hostEl?.shadowRoot || !refs) return;
		const sr = hostEl.shadowRoot;
		setTextFast(refs.titleEl, `Volunteer Mode (${options.hostname})`);
		updateStats();
		setTextFast(refs.dlBtn, `Download ${options.hostname}.json`);

		const cur = capturedEntries[selectedIdx];
		if (cur) {
			refs.editorEl.hidden = false;
			refs.emptyEl.hidden = true;

			setTextFast(refs.badgeEl, cur.kind.toUpperCase());
			refs.badgeEl.className = `us-chip vol-badge ${cur.kind === "dynamic" ? "dyn" : ""}`;
			setTextFast(refs.posEl, `#${selectedIdx + 1}/${capturedEntries.length}`);
			setTextFast(refs.valuesEl, cur.values.length ? `values: ${cur.values.join(", ")}` : "");
			setTextFast(refs.keyEl, cur.key);

			const targetLang = options.getTargetLang();
			refs.valInput.placeholder = `Enter translation (${targetLang})...`;

			const selectionChanged = selectedIdx !== lastRenderedIdx || cur.key !== lastRenderedKey;
			const table = options.getSiteLocaleTable();
			const suggestedScope = cur.matchedScope ?? suggestScopeSelector(cur.seg.container);

			if (selectionChanged || sr.activeElement !== refs.scopeInput) {
				if (selectionChanged || !refs.scopeInput.value) {
					refs.scopeInput.value = suggestedScope;
				}
			}

			if (selectionChanged || sr.activeElement !== refs.valInput) {
				const activeScope = refs.scopeInput.value.trim();
				const scopedSaved = activeScope
					? cur.kind === "static"
						? (draftScoped[activeScope]?.static?.[cur.key] ?? table?.scoped?.[activeScope]?.static?.[cur.key])
						: (draftScoped[activeScope]?.dynamic?.[cur.key] ?? table?.scoped?.[activeScope]?.dynamic?.[cur.key])
					: undefined;
				const savedOrTable =
					scopedSaved ??
					(cur.kind === "static"
						? (draftStatic[cur.key] ?? table?.static?.[cur.key])
						: (draftDynamic[cur.key] ?? table?.dynamic?.[cur.key]));
				const hasPlaceholder = cur.kind === "dynamic" || /<x\s+id="\d+"/.test(cur.key);
				refs.valInput.value = savedOrTable ?? (hasPlaceholder ? cur.key : "");
			}
			lastRenderedIdx = selectedIdx;
			lastRenderedKey = cur.key;
		} else {
			refs.editorEl.hidden = true;
			refs.emptyEl.hidden = false;
			lastRenderedIdx = -1;
			lastRenderedKey = "";
		}
		syncClickBlockButton();
	}

	function syncClickBlockMenu(): void {
		if (!menuRegistered) return;
		if (registeredClickHandle !== undefined) {
			gmUnregisterMenuCommand(registeredClickHandle);
			registeredClickHandle = undefined;
		}
		if (!options.isEnabled()) return;
		const blocked = isClickBlocked();
		const caption = options.formatClickBlockLabel
			? options.formatClickBlockLabel(blocked)
			: `Volunteer Click Lock: ${blocked ? "ON" : "OFF"}`;
		const handle = gmMenuCommand(caption, toggleClickBlock, { id: VOLUNTEER_CLICK_MENU_ID });
		registeredClickHandle = handle ?? VOLUNTEER_CLICK_MENU_ID;
	}

	function toggleClickBlock(): void {
		if (!options.isEnabled()) return;
		const next = !isClickBlocked();
		setClickBlockedState(next);
		syncClickBlockButton();
		setTextFast(
			refs?.msgEl,
			next ? "Click lock ON — page click navigation disabled." : "Click lock OFF — normal page clicks restored.",
		);
		syncClickBlockMenu();
	}

	function isPtrUiEvent(e: Event): boolean {
		if (typeof e.composedPath === "function") {
			for (const node of e.composedPath()) {
				if (node === hostEl) return true;
				if (
					node &&
					typeof (node as Element).hasAttribute === "function" &&
					(node as Element).hasAttribute("data-ptr-ui")
				) {
					return true;
				}
			}
		}
		const target = e.target as (Node & Partial<Element>) | null;
		if (!target) return true;
		if (hostEl?.shadowRoot && target.getRootNode?.() === hostEl.shadowRoot) return true;
		if (typeof target.closest === "function" && target.closest("[data-ptr-ui]")) return true;
		return false;
	}

	function onPageBlockedEvent(e: Event): void {
		if (!options.isEnabled() || !isClickBlocked()) return;
		if (isPtrUiEvent(e)) return;
		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation?.();
	}

	function onPageClick(e: Event): void {
		if (!options.isEnabled()) return;
		if (isPtrUiEvent(e)) return;
		const target = e.target as Element | null;
		if (!target) return;
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

	function mount(): void {
		if (hostEl) return;
		hostEl = options.doc.createElement("div");
		hostEl.setAttribute("data-ptr-ui", "1");
		const sr = hostEl.attachShadow({ mode: "open" });

		const css = `${getSharedPanelCss()}
.ptr-vol {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483647;
  width: 360px;
}
.vol-meta { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-bottom: 6px; }
.vol-badge { font-weight: 600; }
.vol-badge.dyn::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #a855f7; }
.vol-badge:not(.dyn)::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #3b82f6; }
.box {
  background: var(--us-surface);
  border: 1px solid var(--us-line);
  padding: 6px 8px;
  border-radius: 4px;
  word-break: break-word;
  max-height: 68px;
  overflow-y: auto;
  contain: layout paint;
  font-family: var(--us-mono);
  font-size: 11.5px;
}
.scope-row { display: grid; grid-template-columns: 1fr auto; gap: 6px; align-items: center; margin: 6px 0; }
.row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 6px; }
.row-between { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-top: 8px; }
.msg { color: var(--us-muted); font-size: 11.5px; margin-top: 6px; word-break: break-word; }`;

		applyVolCss(sr, options.doc, css);

		const tpl = options.doc.createElement("template");
		tpl.innerHTML = `
<aside class="us-panel ptr-vol" aria-label="Volunteer Mode">
  <div class="us-panel-head">
    <span class="us-panel-title" id="ptr-v-title"></span>
    <div style="display:flex;gap:4px">
      <button id="ptr-v-block-clicks" class="ptr-btn us-btn-sm" type="button" aria-pressed="false"></button>
      <button id="ptr-v-rescan" class="ptr-btn us-btn-sm" type="button">Rescan</button>
    </div>
  </div>
  <div class="us-panel-sec">
    <div class="us-muted us-mono" id="ptr-v-stats"></div>
  </div>
  <div class="us-panel-sec" id="ptr-v-editor" hidden>
    <div class="vol-meta">
      <span class="us-chip vol-badge" id="ptr-v-badge"></span>
      <span class="us-mono" id="ptr-v-pos"></span>
      <span class="us-muted us-mono" id="ptr-v-values"></span>
    </div>
    <div class="box" id="ptr-v-key"></div>
    <div class="scope-row">
      <input id="ptr-v-scope" class="ptr-input us-mono" type="text" placeholder="Scope CSS selector (optional)" aria-label="Scope CSS selector" />
      <button id="ptr-v-suggest-scope" class="ptr-btn us-btn-sm" type="button">Suggest parent</button>
    </div>
    <input id="ptr-v-val" class="ptr-input" type="text" />
    <div class="row-between">
      <div style="display:flex;gap:4px">
        <button id="ptr-v-prev" class="ptr-btn us-btn-sm" type="button">Prev</button>
        <button id="ptr-v-next" class="ptr-btn us-btn-sm" type="button">Next</button>
      </div>
      <button id="ptr-v-save" class="ptr-btn ptr-btn-primary us-btn-sm" type="button">Save &amp; Preview</button>
    </div>
  </div>
  <div class="us-panel-sec us-muted" id="ptr-v-empty" hidden>No translatable segments captured yet.</div>
  <div class="us-panel-sec">
    <div class="row">
      <button id="ptr-v-copy" class="ptr-btn us-btn-sm" type="button">Copy JSON</button>
      <button id="ptr-v-dl" class="ptr-btn us-btn-sm" type="button"></button>
    </div>
    <div class="msg" id="ptr-v-msg"></div>
  </div>
</aside>`;
		sr.appendChild(tpl.content.cloneNode(true));

		refs = {
			titleEl: sr.getElementById("ptr-v-title") as HTMLElement,
			statsEl: sr.getElementById("ptr-v-stats") as HTMLElement,
			editorEl: sr.getElementById("ptr-v-editor") as HTMLElement,
			emptyEl: sr.getElementById("ptr-v-empty") as HTMLElement,
			badgeEl: sr.getElementById("ptr-v-badge") as HTMLElement,
			posEl: sr.getElementById("ptr-v-pos") as HTMLElement,
			valuesEl: sr.getElementById("ptr-v-values") as HTMLElement,
			keyEl: sr.getElementById("ptr-v-key") as HTMLElement,
			scopeInput: sr.getElementById("ptr-v-scope") as HTMLInputElement,
			suggestBtn: sr.getElementById("ptr-v-suggest-scope") as HTMLButtonElement,
			valInput: sr.getElementById("ptr-v-val") as HTMLInputElement,
			prevBtn: sr.getElementById("ptr-v-prev") as HTMLButtonElement,
			nextBtn: sr.getElementById("ptr-v-next") as HTMLButtonElement,
			saveBtn: sr.getElementById("ptr-v-save") as HTMLButtonElement,
			blockClicksBtn: sr.getElementById("ptr-v-block-clicks") as HTMLButtonElement,
			rescanBtn: sr.getElementById("ptr-v-rescan") as HTMLButtonElement,
			copyBtn: sr.getElementById("ptr-v-copy") as HTMLButtonElement,
			dlBtn: sr.getElementById("ptr-v-dl") as HTMLButtonElement,
			msgEl: sr.getElementById("ptr-v-msg") as HTMLElement,
		};

		refs.blockClicksBtn.addEventListener("click", toggleClickBlock);
		refs.rescanBtn.addEventListener("click", () => {
			scanPage();
			patchPanel();
		});
		refs.prevBtn.addEventListener("click", () => {
			if (capturedEntries.length > 0) {
				selectedIdx = (selectedIdx - 1 + capturedEntries.length) % capturedEntries.length;
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
			if (!refs) return;
			const cur = capturedEntries[selectedIdx];
			refs.scopeInput.value = cur ? suggestScopeSelector(cur.seg.container) : "";
		});
		refs.saveBtn.addEventListener("click", () => {
			if (!refs) return;
			const cur = capturedEntries[selectedIdx];
			if (!cur) return;
			const val = refs.valInput.value;
			const scopeSel = refs.scopeInput.value.trim();
			if (scopeSel) {
				const scope = draftScoped[scopeSel] ?? {};
				if (cur.kind === "static") scope.static = { ...(scope.static ?? {}), [cur.key]: val };
				else scope.dynamic = { ...(scope.dynamic ?? {}), [cur.key]: val };
				draftScoped[scopeSel] = scope;
			} else if (cur.kind === "static") {
				draftStatic[cur.key] = val;
			} else {
				draftDynamic[cur.key] = val;
			}
			const wasHit = cur.hit;
			cur.hit = val.trim() !== "";
			if (cur.hit !== wasHit) {
				hitCount += cur.hit ? 1 : -1;
				updateStats();
			}
			const preview = cur.kind === "dynamic" ? interpolateTemplate(val, cur.values) : val;
			setTextFast(
				refs.msgEl,
				scopeSel ? `Saved draft (scoped to ${scopeSel}). Preview: ${preview}` : `Saved draft. Preview: ${preview}`,
			);
		});
		refs.copyBtn.addEventListener("click", async () => {
			if (!refs) return;
			const json = getExportJson();
			try {
				await navigator.clipboard.writeText(json);
				setTextFast(refs.msgEl, "Copied volunteer JSON to clipboard.");
			} catch {
				setTextFast(refs.msgEl, "Clipboard denied — use Download instead.");
			}
		});
		refs.dlBtn.addEventListener("click", () => {
			const json = getExportJson();
			const blob = new Blob([json], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const a = options.doc.createElement("a");
			a.href = url;
			a.download = `${options.hostname}.json`;
			a.click();
			URL.revokeObjectURL(url);
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
			: `Volunteer Mode: ${options.isEnabled() ? "ON" : "OFF"}`;

		if (registeredHandle !== undefined && registeredHandle !== VOLUNTEER_MENU_ID) {
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
		registerMenu,
		toggle,
		toggleClickBlock,
		isClickBlocked,
		getExportJson,
		refresh() {
			if (options.isEnabled()) {
				scanPage();
				patchPanel();
			}
		},
		stop: unmount,
	};
}
