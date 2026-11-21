import { type CompiledSiteDelta, matchesAny, matchModifiers, type SiteModifier } from "../site-rules";
import { createRoleClassifier, isNonProsePrimitive, type StyleReader } from "./display-role";

export interface TranslationSegment {
	id: string;
	container: Element;
	nodes: Node[];
	sourceRule: "auto" | "+";
	modifiers: Set<SiteModifier>;
	displayContents?: boolean;
}

const HAS_TRANSLATABLE_LETTER = /\p{L}/u;
const URL_ONLY = /^https?:\/\/\S+$/i;

let nextSegmentSeq = 1;

function isTranslatorManaged(el: Element): boolean {
	return (
		el.id === "ptr-user-css" ||
		el.id === "ptr-inspect-hud" ||
		el.hasAttribute("data-tr-block") ||
		el.hasAttribute("data-tr-orig") ||
		el.hasAttribute("data-tr-dst") ||
		el.hasAttribute("data-ptr-ui") ||
		el.closest?.("[data-ptr-ui]") !== null
	);
}

function getLogicalParent(node: Node): Element | null {
	if (node.parentElement) return node.parentElement;
	const pn = node.parentNode;
	if (pn && "host" in pn && (pn as ShadowRoot).host) {
		return (pn as ShadowRoot).host;
	}
	return null;
}

function collectTranslatableText(node: Node, delta: CompiledSiteDelta): string {
	if (node.nodeType === 3) return node.nodeValue ?? "";
	if (node.nodeType !== 1) return "";
	const el = node as Element;
	if (isNonProsePrimitive(el) || matchesAny(el, delta.removeSelectors)) return "";
	if (matchModifiers(el, delta).has("inline-atomic")) return "";
	let out = "";
	for (const child of Array.from(el.childNodes)) {
		out += collectTranslatableText(child, delta);
	}
	return out;
}

function hasMeaningfulText(nodes: readonly Node[], forced: boolean, delta: CompiledSiteDelta): boolean {
	const raw = nodes
		.map((n) => (forced ? (n.textContent ?? "") : collectTranslatableText(n, delta)))
		.join("")
		.trim();
	if (!raw) return false;
	if (forced) return true;
	if (URL_ONLY.test(raw)) return false;
	return HAS_TRANSLATABLE_LETTER.test(raw);
}

export function collectSegments(
	root: Element,
	delta: CompiledSiteDelta,
	options?: { getStyle?: StyleReader; shadowRoots?: Set<ShadowRoot>; onExcluded?: () => void },
): TranslationSegment[] {
	const classifier = createRoleClassifier(options?.getStyle);
	const splitTriggerCache = new WeakMap<Element, boolean>();
	const excludedCounted = new WeakSet<Element>();
	const segments: TranslationSegment[] = [];

	function isExcludedSubtree(el: Element): boolean {
		const managed = isTranslatorManaged(el);
		const excluded =
			managed ||
			classifier.getRole(el) === "hidden" ||
			matchesAny(el, delta.removeSelectors) ||
			(classifier.isNonProsePrimitive(el) && classifier.getRole(el) !== "inline");
		if (excluded && !managed && !excludedCounted.has(el)) {
			excludedCounted.add(el);
			options?.onExcluded?.();
		}
		return excluded;
	}

	const rootAncestorMods = new Set<SiteModifier>();
	let ancestor: Element | null = getLogicalParent(root);
	while (ancestor) {
		if (isExcludedSubtree(ancestor) || classifier.isNonProsePrimitive(ancestor)) {
			return segments;
		}
		for (const m of matchModifiers(ancestor, delta)) {
			rootAncestorMods.add(m);
		}
		ancestor = getLogicalParent(ancestor);
	}

	function containsSplitTrigger(el: Element): boolean {
		const cached = splitTriggerCache.get(el);
		if (cached !== undefined) return cached;
		let trigger = Boolean(el.shadowRoot);
		if (!trigger) {
			for (const child of Array.from(el.children)) {
				if (
					isExcludedSubtree(child) ||
					classifier.getRole(child) === "block" ||
					matchesAny(child, delta.addSelectors) ||
					matchModifiers(child, delta).has("block") ||
					(!classifier.isNonProsePrimitive(child) && containsSplitTrigger(child))
				) {
					trigger = true;
					break;
				}
			}
		}
		splitTriggerCache.set(el, trigger);
		return trigger;
	}

	function flushRun(container: Element, run: Node[], sourceRule: "auto" | "+", inheritedMods: Set<SiteModifier>): void {
		let start = 0;
		let end = run.length;
		while (start < end && run[start]?.nodeType === 3 && !(run[start]?.nodeValue ?? "").trim()) {
			start++;
		}
		while (end > start && run[end - 1]?.nodeType === 3 && !(run[end - 1]?.nodeValue ?? "").trim()) {
			end--;
		}
		const trimmed = run.slice(start, end);
		if (trimmed.length === 0) return;
		if (!hasMeaningfulText(trimmed, sourceRule === "+", delta)) return;

		const displayVal = options?.getStyle
			? options.getStyle(container).display
			: typeof getComputedStyle === "function"
				? getComputedStyle(container).display
				: "";

		segments.push({
			id: `seg-${nextSegmentSeq++}`,
			container,
			nodes: trimmed,
			sourceRule,
			modifiers: new Set(inheritedMods),
			displayContents: displayVal === "contents",
		});
	}

	function walkChildList(
		hostContainer: Element,
		childNodes: NodeListOf<ChildNode>,
		forcedRule: "auto" | "+",
		inheritedMods: Set<SiteModifier>,
	): void {
		let run: Node[] = [];
		for (const child of Array.from(childNodes)) {
			if (child.nodeType === 3) {
				run.push(child);
				continue;
			}
			if (child.nodeType !== 1) continue;

			const el = child as Element;
			if (isExcludedSubtree(el)) {
				flushRun(hostContainer, run, forcedRule, inheritedMods);
				run = [];
				continue;
			}

			if (classifier.isNonProsePrimitive(el)) {
				run.push(el);
				continue;
			}

			const isPlus = matchesAny(el, delta.addSelectors);
			const mods = matchModifiers(el, delta);
			const isBlockBoundary =
				Boolean(el.shadowRoot) ||
				isPlus ||
				mods.has("block") ||
				classifier.getRole(el) === "block" ||
				containsSplitTrigger(el);

			if (isBlockBoundary) {
				flushRun(hostContainer, run, forcedRule, inheritedMods);
				run = [];
				walkBlock(el, isPlus ? "+" : forcedRule, inheritedMods, mods);
			} else {
				run.push(el);
			}
		}
		flushRun(hostContainer, run, forcedRule, inheritedMods);
	}

	function walkBlock(
		container: Element,
		forcedRule: "auto" | "+" = "auto",
		parentMods: Set<SiteModifier> = rootAncestorMods,
		precomputedMods?: Set<SiteModifier>,
	): void {
		if (isExcludedSubtree(container)) return;
		if (classifier.isNonProsePrimitive(container)) return;

		const localMods = precomputedMods ?? matchModifiers(container, delta);
		const mergedMods = localMods.size === 0 ? parentMods : new Set([...parentMods, ...localMods]);

		if (container.shadowRoot) {
			options?.shadowRoots?.add(container.shadowRoot);
			walkChildList(container, container.shadowRoot.childNodes, forcedRule, mergedMods);
		}

		walkChildList(container, container.childNodes, forcedRule, mergedMods);
	}

	walkBlock(root, matchesAny(root, delta.addSelectors) ? "+" : "auto", rootAncestorMods);
	return segments;
}
