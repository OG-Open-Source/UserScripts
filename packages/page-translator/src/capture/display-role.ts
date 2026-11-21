export type StyleReader = (el: Element) => { display: string; visibility: string };
export type ElementRole = "hidden" | "inline" | "block";

const NON_PROSE_TAGS = new Set([
	"SCRIPT",
	"STYLE",
	"NOSCRIPT",
	"TEMPLATE",
	"TEXTAREA",
	"INPUT",
	"SELECT",
	"OPTION",
	"SVG",
	"MATH",
	"CANVAS",
	"AUDIO",
	"VIDEO",
	"IFRAME",
	"OBJECT",
	"EMBED",
]);

function defaultGetStyle(el: Element): { display: string; visibility: string } {
	const view = el.ownerDocument?.defaultView;
	const gcs =
		view && typeof view.getComputedStyle === "function"
			? view.getComputedStyle.bind(view)
			: typeof getComputedStyle === "function"
				? getComputedStyle
				: null;
	if (!gcs) return { display: "block", visibility: "visible" };
	const cs = gcs(el);
	return { display: cs.display, visibility: cs.visibility };
}

export function isNonProsePrimitive(el: Element): boolean {
	if (NON_PROSE_TAGS.has(el.tagName.toUpperCase())) return true;
	if ((el as HTMLElement).isContentEditable) return true;
	if (el.getAttribute("contenteditable") === "true") return true;
	return false;
}

export function createRoleClassifier(getStyle: StyleReader = defaultGetStyle) {
	const cache = new WeakMap<Element, ElementRole>();

	function getRole(el: Element): ElementRole {
		const cached = cache.get(el);
		if (cached) return cached;

		const { display, visibility } = getStyle(el);
		let role: ElementRole;
		if (display === "none" || visibility === "hidden" || visibility === "collapse") {
			role = "hidden";
		} else if (
			display === "inline" ||
			display === "inline-block" ||
			display === "inline-flex" ||
			display === "inline-grid" ||
			display === "contents" ||
			display === "ruby" ||
			display === "ruby-text" ||
			display === "ruby-base"
		) {
			role = "inline";
		} else {
			role = "block";
		}

		cache.set(el, role);
		return role;
	}

	return { getRole, isNonProsePrimitive };
}
