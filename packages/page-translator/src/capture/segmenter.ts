import { isForeignUi } from "@userscripts/shared";
import type {
  ElementTreatment,
  SiteStructureAdapter,
} from "../structure/adapter";
import type { CompiledSiteDelta, SiteModifier } from "../structure/site-rules";
import { matchesAny, matchModifiers } from "../structure/site-rules";
import type { StyleReader } from "./display-role";
import {
  createRoleClassifier,
  defaultGetStyle,
  isCodeOrMonospace,
  isNonProsePrimitive,
} from "./display-role";

export { isCodeOrMonospace } from "./display-role";

export interface TranslationSegment {
  container: Element;
  displayContents?: boolean;
  id: string;
  modifiers: Set<SiteModifier>;
  nodes: Node[];
  sourceRule: "auto" | "+";
}

const HAS_TRANSLATABLE_LETTER = /\p{L}/u;
const URL_ONLY = /^https?:\/\/\S+$/iu;

let nextSegmentSeq = 1;

function isTranslatorManaged(el: Element): boolean {
  return (
    el.id === "ptr-user-css" ||
    el.id === "ptr-inspect-hud" ||
    el.hasAttribute("data-tr-block") ||
    el.hasAttribute("data-tr-orig") ||
    el.hasAttribute("data-tr-dst") ||
    isForeignUi(el)
  );
}

function getLogicalParent(node: Node): Element | null {
  if (node.parentElement) {
    return node.parentElement;
  }
  const pn = node.parentNode;
  if (pn && "host" in pn && (pn as ShadowRoot).host) {
    return (pn as ShadowRoot).host;
  }
  return null;
}

export type CaptureExcludeReason =
  | "mono"
  | "hidden"
  | "foreign-ui"
  | "translator-managed"
  | "removed"
  | "non-prose"
  | "out-of-scope"
  | "adapter-skip";

export interface ComputedStyleSummary {
  display: string;
  fontFamily: string;
  visibility: string;
}

export interface CaptureCandidateDecision {
  classification: ElementTreatment;
  computedStyleSummary: ComputedStyleSummary;
  excludeReason: CaptureExcludeReason | null;
  included: boolean;
}

export interface CaptureCandidateOptions {
  adapter?: SiteStructureAdapter;
  getStyle?: StyleReader;
  scope?: readonly Element[];
}

function isInScope(el: Element, scope: readonly Element[]): boolean {
  let current: Element | null = el;
  while (current) {
    if (scope.includes(current)) {
      return true;
    }
    current = getLogicalParent(current);
  }
  return false;
}

export function evaluateCaptureCandidate(
  el: Element,
  delta: CompiledSiteDelta,
  options: CaptureCandidateOptions = {}
): CaptureCandidateDecision {
  const getStyle = options.getStyle ?? defaultGetStyle;
  const style = getStyle(el);
  const role = createRoleClassifier(() => style).getRole(el);
  let classification =
    options.adapter?.elementPolicy(el) ??
    (isNonProsePrimitive(el) ? "atomic" : "prose");
  let excludeReason: CaptureExcludeReason | null = null;

  if (isCodeOrMonospace(el, () => style)) {
    classification = "skip";
    excludeReason = "mono";
  } else if (isForeignUi(el)) {
    excludeReason = "foreign-ui";
  } else if (isTranslatorManaged(el)) {
    excludeReason = "translator-managed";
  } else if (role === "hidden") {
    excludeReason = "hidden";
  } else if (matchesAny(el, delta.removeSelectors)) {
    excludeReason = "removed";
  } else if (options.scope && !isInScope(el, options.scope)) {
    excludeReason = "out-of-scope";
  } else if (classification === "skip") {
    excludeReason = "adapter-skip";
  } else if (isNonProsePrimitive(el) && role !== "inline") {
    excludeReason = "non-prose";
  }

  return {
    included: excludeReason === null,
    excludeReason,
    classification,
    computedStyleSummary: {
      display: style.display,
      visibility: style.visibility,
      fontFamily: style.fontFamily ?? "",
    },
  };
}

export const evaluateElementCandidate = evaluateCaptureCandidate;
export const classifyCaptureNode = evaluateCaptureCandidate;

function collectTranslatableText(node: Node, delta: CompiledSiteDelta): string {
  if (node.nodeType === 3) {
    return node.nodeValue ?? "";
  }
  if (node.nodeType !== 1) {
    return "";
  }
  const el = node as Element;
  if (isNonProsePrimitive(el) || matchesAny(el, delta.removeSelectors)) {
    return "";
  }
  if (matchModifiers(el, delta).has("inline-atomic")) {
    return "";
  }
  let out = "";
  for (const child of Array.from(el.childNodes)) {
    out += collectTranslatableText(child, delta);
  }
  return out;
}

function hasMeaningfulText(
  nodes: readonly Node[],
  forced: boolean,
  delta: CompiledSiteDelta
): boolean {
  const raw = nodes
    .map((n) =>
      forced ? (n.textContent ?? "") : collectTranslatableText(n, delta)
    )
    .join("")
    .trim();
  if (!raw) {
    return false;
  }
  if (forced) {
    return true;
  }
  if (URL_ONLY.test(raw)) {
    return false;
  }
  return HAS_TRANSLATABLE_LETTER.test(raw);
}

export function collectSegments(
  root: Element,
  delta: CompiledSiteDelta,
  options?: {
    adapter?: SiteStructureAdapter;
    getStyle?: StyleReader;
    shadowRoots?: Set<ShadowRoot>;
    onExcluded?: () => void;
  }
): TranslationSegment[] {
  const classifier = createRoleClassifier(options?.getStyle);
  const splitTriggerCache = new WeakMap<Element, boolean>();
  const excludedCounted = new WeakSet<Element>();
  const segments: TranslationSegment[] = [];

  function isExcludedSubtree(el: Element): boolean {
    const decision = evaluateCaptureCandidate(el, delta, {
      adapter: options?.adapter,
      getStyle: options?.getStyle,
    });
    const managed =
      decision.excludeReason === "foreign-ui" ||
      decision.excludeReason === "translator-managed";
    if (!(decision.included || managed || excludedCounted.has(el))) {
      excludedCounted.add(el);
      options?.onExcluded?.();
    }
    return !decision.included;
  }

  const rootAncestorMods = new Set<SiteModifier>();
  let ancestor: Element | null = getLogicalParent(root);
  while (ancestor) {
    if (
      isExcludedSubtree(ancestor) ||
      classifier.isNonProsePrimitive(ancestor)
    ) {
      return segments;
    }
    for (const m of matchModifiers(ancestor, delta)) {
      rootAncestorMods.add(m);
    }
    ancestor = getLogicalParent(ancestor);
  }

  function containsSplitTrigger(el: Element): boolean {
    const cached = splitTriggerCache.get(el);
    if (cached !== undefined) {
      return cached;
    }
    let trigger = Boolean(el.shadowRoot);
    if (!trigger) {
      for (const child of Array.from(el.children)) {
        if (
          isExcludedSubtree(child) ||
          classifier.getRole(child) === "block" ||
          matchesAny(child, delta.addSelectors) ||
          matchModifiers(child, delta).has("block") ||
          (!classifier.isNonProsePrimitive(child) &&
            containsSplitTrigger(child))
        ) {
          trigger = true;
          break;
        }
      }
    }
    splitTriggerCache.set(el, trigger);
    return trigger;
  }

  function flushRun(
    container: Element,
    run: Node[],
    sourceRule: "auto" | "+",
    inheritedMods: Set<SiteModifier>
  ): void {
    let start = 0;
    let end = run.length;
    while (
      start < end &&
      run[start]?.nodeType === 3 &&
      !(run[start]?.nodeValue ?? "").trim()
    ) {
      start += 1;
    }
    while (
      end > start &&
      run[end - 1]?.nodeType === 3 &&
      !(run[end - 1]?.nodeValue ?? "").trim()
    ) {
      end -= 1;
    }
    const trimmed = run.slice(start, end);
    if (trimmed.length === 0) {
      return;
    }
    if (!hasMeaningfulText(trimmed, sourceRule === "+", delta)) {
      return;
    }

    let displayVal = "";
    if (options?.getStyle) {
      displayVal = options.getStyle(container).display;
    } else if (typeof getComputedStyle === "function") {
      displayVal = getComputedStyle(container).display;
    }

    const id = `seg-${nextSegmentSeq}`;
    nextSegmentSeq += 1;
    segments.push({
      id,
      container,
      nodes: trimmed,
      sourceRule,
      modifiers: new Set(inheritedMods),
      displayContents: displayVal === "contents",
    });
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Verbatim legacy port covered by parity tests.
  function walkChildList(
    hostContainer: Element,
    childNodes: NodeListOf<ChildNode>,
    forcedRule: "auto" | "+",
    inheritedMods: Set<SiteModifier>
  ): void {
    let run: Node[] = [];
    for (const child of Array.from(childNodes)) {
      if (child.nodeType === 3) {
        run.push(child);
        continue;
      }
      if (child.nodeType !== 1) {
        continue;
      }

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
    precomputedMods?: Set<SiteModifier>
  ): void {
    if (isExcludedSubtree(container)) {
      return;
    }
    if (classifier.isNonProsePrimitive(container)) {
      return;
    }

    const localMods = precomputedMods ?? matchModifiers(container, delta);
    const mergedMods =
      localMods.size === 0
        ? parentMods
        : new Set([...parentMods, ...localMods]);

    if (container.shadowRoot) {
      options?.shadowRoots?.add(container.shadowRoot);
      walkChildList(
        container,
        container.shadowRoot.childNodes,
        forcedRule,
        mergedMods
      );
    }

    walkChildList(container, container.childNodes, forcedRule, mergedMods);
  }

  walkBlock(
    root,
    matchesAny(root, delta.addSelectors) ? "+" : "auto",
    rootAncestorMods
  );
  return segments;
}
