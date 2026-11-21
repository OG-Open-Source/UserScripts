import { gmAddStyle } from "@userscripts/shared";
import type { SpacingMode } from "./config";

export const STYLE_ELEMENT_ID = "ptr-user-css";

export interface StyleOptions {
	customCss: string;
	customFont: string;
	debugInspect: boolean;
	spacingMode?: SpacingMode;
}

const gmInjectedByDoc = new WeakMap<Document, HTMLStyleElement>();
const shadowSheetByRoot = new WeakMap<ShadowRoot, CSSStyleSheet>();

export function buildStylesheet(opts: StyleOptions): string {
	const fontVal = opts.customFont.trim() || "inherit";
	const useW3cAutospace = opts.spacingMode === "w3c" || opts.spacingMode === "both";
	const autospaceRule = useW3cAutospace ? " text-autospace: normal;" : "";

	const inspectCss = opts.debugInspect
		? `
[data-tr-inspect] {
  outline: 2px dashed #3b82f6 !important;
  outline-offset: 2px !important;
}
[data-tr-inspect-kind="auto-dynamic"] {
  outline-color: #a855f7 !important;
}
[data-tr-inspect="+"],
[data-tr-inspect-kind="+"] {
  outline-color: #10b981 !important;
}
[data-tr-inspect-kind="manual"] {
  outline-color: #f59e0b !important;
}
[data-tr-inspect-mods] {
  outline-style: dotted !important;
}
`
		: "";

	const userCss = opts.customCss.trim();

	return `/* Page Translator base styles (overridable via custom CSS) */
:root { --ptr-font: ${fontVal}; }
[data-tr-block] { display: contents; }
[data-tr-orig] { display: none; }
[data-tr-dst] { display: contents; font-family: var(--ptr-font, inherit);${autospaceRule} }
[data-tr-state="pending"] > [data-tr-orig],
[data-tr-state="error"] > [data-tr-orig],
[data-tr-mod~="keep-orig"] > [data-tr-orig] { display: contents; }
[data-tr-state="pending"] > [data-tr-dst] { opacity: 0.65; }
${inspectCss}${userCss ? `\n/* User custom CSS */\n${userCss}\n` : ""}`;
}

function syncShadowRoot(root: ShadowRoot, css: string, doc: Document): void {
	if (typeof CSSStyleSheet !== "undefined" && Array.isArray(root.adoptedStyleSheets)) {
		try {
			let sheet = shadowSheetByRoot.get(root);
			if (!sheet) {
				sheet = new CSSStyleSheet();
				shadowSheetByRoot.set(root, sheet);
			}
			sheet.replaceSync(css);
			if (!root.adoptedStyleSheets.includes(sheet)) {
				root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
			}
			return;
		} catch {
			// Fall back to <style> inside shadowRoot
		}
	}
	let styleEl = root.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
	if (!styleEl) {
		styleEl = doc.createElement("style");
		styleEl.id = STYLE_ELEMENT_ID;
		root.appendChild(styleEl);
	}
	styleEl.textContent = css;
}

export function syncShadowRootsOnly(doc: Document, opts: StyleOptions, shadowRoots: Iterable<ShadowRoot>): void {
	const css = buildStylesheet(opts);
	for (const root of shadowRoots) {
		syncShadowRoot(root, css, doc);
	}
}

export function syncStylesheet(
	doc: Document,
	opts: StyleOptions,
	shadowRoots?: Iterable<ShadowRoot>,
): HTMLStyleElement {
	const css = buildStylesheet(opts);

	if (shadowRoots) {
		for (const root of shadowRoots) {
			syncShadowRoot(root, css, doc);
		}
	}

	const prevGm = gmInjectedByDoc.get(doc);
	if (prevGm?.isConnected) {
		prevGm.textContent = css;
		return prevGm;
	}
	if (prevGm) {
		gmInjectedByDoc.delete(doc);
	}
	const viaGm = gmAddStyle(css);
	if (viaGm) {
		viaGm.id = STYLE_ELEMENT_ID;
		gmInjectedByDoc.set(doc, viaGm);
		return viaGm;
	}

	let styleEl = doc.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
	if (!styleEl) {
		styleEl = doc.createElement("style");
		styleEl.id = STYLE_ELEMENT_ID;
		(doc.head ?? doc.documentElement).appendChild(styleEl);
	}
	styleEl.textContent = css;
	return styleEl;
}
