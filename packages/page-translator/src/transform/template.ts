export interface SiteLocaleScope {
	static?: Record<string, string>;
	dynamic?: Record<string, string>;
}

export interface SiteLocaleTable {
	static?: Record<string, string>;
	dynamic?: Record<string, string>;
	scoped?: Record<string, SiteLocaleScope>;
}

export interface ExtractedTemplate {
	kind: "static" | "dynamic";
	template: string;
	values: string[];
}

const TOKENIZER_RE =
	/(<x\s+id="\d+"\s*\/>)|(<[^>]+>)|(@[A-Za-z0-9_-]+)|((?<![A-Za-z0-9.])(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?![A-Za-z0-9.]))/g;

export function extractTemplate(payloadHtml: string): ExtractedTemplate {
	const values: string[] = [];
	const template = payloadHtml.replace(
		TOKENIZER_RE,
		(full, atomicSlot?: string, otherTag?: string, handle?: string, num?: string) => {
			if (otherTag) return otherTag;
			const val = atomicSlot ?? handle ?? num;
			if (!val) return full;
			const idx = values.length;
			values.push(val);
			return `{v${idx}}`;
		},
	);

	return { kind: values.length > 0 ? "dynamic" : "static", template, values };
}

export function interpolateTemplate(template: string, values: readonly string[]): string {
	return template.replace(/\{v(\d+)\}/g, (m, rawIdx: string) => {
		const idx = Number(rawIdx);
		return idx >= 0 && idx < values.length ? values[idx]! : m;
	});
}

function matchScopeEntry(
	payloadHtml: string,
	trimmed: string,
	scope: SiteLocaleScope | null | undefined,
	getExtracted: () => ExtractedTemplate,
): { kind: "static" | "dynamic"; html: string } | null {
	if (!scope) return null;

	const staticHit = scope.static?.[payloadHtml] ?? scope.static?.[trimmed];
	if (typeof staticHit === "string") {
		return { kind: "static", html: staticHit };
	}

	const extracted = getExtracted();
	if (extracted.values.length > 0) {
		const dynHit = scope.dynamic?.[extracted.template];
		if (typeof dynHit === "string") {
			return { kind: "dynamic", html: interpolateTemplate(dynHit, extracted.values) };
		}
	}

	return null;
}

export function matchSiteTranslation(
	payloadHtml: string,
	table: SiteLocaleTable | null | undefined,
	container?: Element | null,
): { kind: "static" | "dynamic"; html: string; scope?: string } | null {
	if (!table) return null;

	const trimmed = payloadHtml.trim();
	let extracted: ExtractedTemplate | null = null;
	const getExtracted = (): ExtractedTemplate => (extracted ??= extractTemplate(trimmed));

	if (container && table.scoped) {
		for (const [selector, scopeTable] of Object.entries(table.scoped)) {
			if (!selector || !scopeTable) continue;
			let matched: Element | null = null;
			try {
				matched = typeof container.closest === "function" ? container.closest(selector) : null;
			} catch {
				matched = null;
			}
			if (!matched) continue;

			const hit = matchScopeEntry(payloadHtml, trimmed, scopeTable, getExtracted);
			if (hit) {
				return { ...hit, scope: selector };
			}
		}
	}

	return matchScopeEntry(payloadHtml, trimmed, table, getExtracted);
}

const HASHED_TOKEN_RE = /^[A-Za-z0-9_-]*[0-9][A-Za-z0-9_-]{3,}$/;
const VALID_IDENT_RE = /^[A-Za-z_-][A-Za-z0-9_-]*$/;

function escapeAttrValue(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function suggestScopeSelector(el: Element | null | undefined): string {
	let cur: Element | null = el?.parentElement ?? null;
	for (let depth = 0; cur && depth < 5; depth += 1, cur = cur.parentElement) {
		const tag = cur.tagName.toLowerCase();
		if (tag === "body" || tag === "html") break;

		const id = cur.getAttribute("id")?.trim();
		if (id && VALID_IDENT_RE.test(id) && !HASHED_TOKEN_RE.test(id)) {
			return `#${id}`;
		}

		const testId = cur.getAttribute("data-testid")?.trim();
		if (testId) {
			return `[data-testid="${escapeAttrValue(testId)}"]`;
		}

		const ariaLabel = cur.getAttribute("aria-label")?.trim();
		if (ariaLabel) {
			return `${tag}[aria-label="${escapeAttrValue(ariaLabel)}"]`;
		}

		const rawClass = cur.getAttribute("class") ?? "";
		for (const token of rawClass.split(/\s+/)) {
			if (token && VALID_IDENT_RE.test(token) && !HASHED_TOKEN_RE.test(token)) {
				return `.${token}`;
			}
		}
	}
	return "";
}
