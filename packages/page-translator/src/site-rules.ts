export type SiteModifier = "block" | "inline-atomic" | "no-spacing" | "no-opencc" | "keep-orig";

const VALID_MODIFIERS = new Set<SiteModifier>(["block", "inline-atomic", "no-spacing", "no-opencc", "keep-orig"]);

export interface SiteModRule {
	selector: string;
	modifiers: SiteModifier[];
}

export interface CompiledSiteDelta {
	addSelectors: string[];
	removeSelectors: string[];
	modRules: SiteModRule[];
}

export function parseSiteDelta(source: string): CompiledSiteDelta {
	const addSelectors: string[] = [];
	const removeSelectors: string[] = [];
	const modRules: SiteModRule[] = [];

	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;

		const op = line[0];
		const rest = line.slice(1).trim();
		if (!rest) continue;

		if (op === "+") {
			addSelectors.push(rest);
		} else if (op === "-") {
			removeSelectors.push(rest);
		} else if (op === "*") {
			const sepIdx = rest.lastIndexOf(":");
			if (sepIdx === -1) continue;
			const selector = rest.slice(0, sepIdx).trim();
			const rawMods = rest.slice(sepIdx + 1);
			if (!selector) continue;
			const modifiers = rawMods
				.split(",")
				.map((m) => m.trim() as SiteModifier)
				.filter((m) => VALID_MODIFIERS.has(m));
			if (modifiers.length > 0) {
				modRules.push({ selector, modifiers });
			}
		}
	}

	return { addSelectors, removeSelectors, modRules };
}

function hostMatchesPattern(hostname: string, pattern: string): boolean {
	const host = hostname.toLowerCase();
	const pat = pattern.trim().toLowerCase();
	if (!pat) return false;
	if (pat === "*") return true;
	if (pat.startsWith("*.")) {
		const base = pat.slice(2);
		return host === base || host.endsWith(`.${base}`);
	}
	return host === pat;
}

function patternSpecificity(pattern: string): number {
	const pat = pattern.trim();
	if (pat === "*") return 0;
	if (pat.startsWith("*.")) return 1;
	return 2;
}

export const BUILTIN_SITE_DEFAULTS: Record<string, string> = {};

export function resolveSiteDeltaForHost(
	hostname: string,
	siteDeltas: Record<string, string>,
	builtInDefaults: Record<string, string> = BUILTIN_SITE_DEFAULTS,
): CompiledSiteDelta {
	const entries: Array<[string, string]> = [...Object.entries(builtInDefaults), ...Object.entries(siteDeltas)];

	const matched = entries
		.filter(([pattern]) => hostMatchesPattern(hostname, pattern))
		.sort(([a], [b]) => patternSpecificity(a) - patternSpecificity(b));

	const addSelectors: string[] = [];
	const removeSelectors: string[] = [];
	const modRules: SiteModRule[] = [];

	for (const [, source] of matched) {
		const parsed = parseSiteDelta(source);
		addSelectors.push(...parsed.addSelectors);
		removeSelectors.push(...parsed.removeSelectors);
		modRules.push(...parsed.modRules);
	}

	return { addSelectors, removeSelectors, modRules };
}

export function safeMatches(el: Element, selector: string): boolean {
	try {
		return el.matches(selector);
	} catch {
		return false;
	}
}

export function matchesAny(el: Element, selectors: readonly string[]): boolean {
	for (const sel of selectors) {
		if (safeMatches(el, sel)) return true;
	}
	return false;
}

export function matchModifiers(el: Element, delta: CompiledSiteDelta): Set<SiteModifier> {
	const out = new Set<SiteModifier>();
	for (const rule of delta.modRules) {
		if (safeMatches(el, rule.selector)) {
			for (const mod of rule.modifiers) {
				out.add(mod);
			}
		}
	}
	return out;
}
