import type {
  ElementTreatment,
  SiteStructureAdapter,
} from "../structure/adapter";
import { resolveAdapter } from "../structure/registry";
import type { CompiledSiteDelta } from "../structure/site-rules";
import {
  matchModifiers,
  resolveSiteDeltaForHost,
} from "../structure/site-rules";
import type { StyleReader } from "./display-role";
import { defaultGetStyle, isNonProsePrimitive } from "./display-role";
import type {
  CaptureCandidateDecision,
  CaptureExcludeReason,
  ComputedStyleSummary,
} from "./segmenter";
import { evaluateCaptureCandidate } from "./segmenter";

const DEFAULT_MAX_PREVIEW_LENGTH = 160;
const WHITESPACE_RE = /\s+/gu;

export type CaptureCandidateExcludeReason = CaptureExcludeReason | "atomic";

export interface CaptureCandidate {
  classification: ElementTreatment;
  computedStyleSummary: ComputedStyleSummary;
  domPath: string;
  excludeReason: CaptureCandidateExcludeReason | null;
  included: boolean;
  region: string | string[] | null;
  textPreview: string;
}

export interface ExportCaptureOptions {
  adapter?: SiteStructureAdapter;
  adapters?: readonly SiteStructureAdapter[];
  delta?: CompiledSiteDelta;
  getStyle?: StyleReader;
  host?: string;
  maxPreviewLength?: number;
  root?: Element;
  siteDeltas?: Record<string, string>;
}

function getLogicalParent(el: Element): Element | null {
  if (el.parentElement) {
    return el.parentElement;
  }
  const parent = el.parentNode;
  if (parent && "host" in parent) {
    return (parent as ShadowRoot).host;
  }
  return null;
}

function getSameTagSiblings(el: Element): Element[] {
  let children: Element[] = [];
  if (el.parentElement) {
    children = Array.from(el.parentElement.children);
  } else if (el.parentNode && "host" in el.parentNode) {
    children = Array.from((el.parentNode as ShadowRoot).children);
  }
  return children.filter((sibling) => sibling.tagName === el.tagName);
}

function getDomPath(el: Element): string {
  const segments: string[] = [];
  let current: Element | null = el;

  while (current) {
    let segment = current.tagName.toLowerCase();
    if (current.id) {
      segment += `#${current.id}`;
    } else {
      const sameTagSiblings = getSameTagSiblings(current);
      if (sameTagSiblings.length > 1) {
        segment += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
      }
    }
    segments.unshift(segment);

    if (
      !current.parentElement &&
      current.parentNode &&
      "host" in current.parentNode
    ) {
      segments.unshift("#shadow-root");
      current = (current.parentNode as ShadowRoot).host;
    } else {
      current = current.parentElement;
    }
  }

  return segments.join(" > ");
}

function getRegion(
  el: Element,
  regions: Readonly<Record<string, Element[]>>
): string | string[] | null {
  const matches = Object.entries(regions)
    .filter(([, roots]) =>
      roots.some((root) => root === el || root.contains(el))
    )
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));

  if (matches.length === 0) {
    return null;
  }
  return matches.length === 1 ? (matches[0] ?? null) : matches;
}

function getTextPreview(el: Element, maxPreviewLength: number): string {
  const normalized = (el.textContent ?? "").replace(WHITESPACE_RE, " ").trim();
  return normalized.slice(0, Math.max(0, maxPreviewLength));
}

function getOwnExcludeReason(
  el: Element,
  delta: CompiledSiteDelta,
  decision: CaptureCandidateDecision
): CaptureCandidateExcludeReason | null {
  if (
    decision.included &&
    (decision.classification === "atomic" ||
      isNonProsePrimitive(el) ||
      matchModifiers(el, delta).has("inline-atomic"))
  ) {
    return "atomic";
  }
  return decision.excludeReason;
}

function mergeExcludeReason(
  inherited: CaptureCandidateExcludeReason | null,
  own: CaptureCandidateExcludeReason | null
): CaptureCandidateExcludeReason | null {
  if (inherited && (own === null || own === "out-of-scope")) {
    return inherited;
  }
  return own;
}

function getInheritableReason(
  reason: CaptureCandidateExcludeReason | null
): CaptureCandidateExcludeReason | null {
  return reason === "out-of-scope" ? null : reason;
}

export function exportCaptureCandidates(
  doc: Document,
  opts: ExportCaptureOptions = {}
): CaptureCandidate[] {
  const host = opts.host ?? doc.location?.hostname ?? "";
  const adapter = opts.adapter ?? resolveAdapter({ doc, host }, opts.adapters);
  const delta =
    opts.delta ?? resolveSiteDeltaForHost(host, opts.siteDeltas ?? {});
  const getStyle = opts.getStyle ?? defaultGetStyle;
  const root = opts.root ?? doc.body ?? doc.documentElement;
  if (!root) {
    return [];
  }

  const scope = adapter.captureScope(doc);
  const regions = adapter.regions(doc);
  const maxPreviewLength = opts.maxPreviewLength ?? DEFAULT_MAX_PREVIEW_LENGTH;
  const evaluationOptions = { adapter, getStyle, scope };
  const candidates: CaptureCandidate[] = [];
  const seen = new Set<Element>();

  function evaluate(el: Element): CaptureCandidateDecision {
    return evaluateCaptureCandidate(el, delta, evaluationOptions);
  }

  const ancestors: Element[] = [];
  let ancestor = getLogicalParent(root);
  while (ancestor) {
    ancestors.unshift(ancestor);
    ancestor = getLogicalParent(ancestor);
  }

  let inheritedReason: CaptureCandidateExcludeReason | null = null;
  for (const ancestorElement of ancestors) {
    const ownReason = getOwnExcludeReason(
      ancestorElement,
      delta,
      evaluate(ancestorElement)
    );
    inheritedReason = getInheritableReason(
      mergeExcludeReason(inheritedReason, ownReason)
    );
  }

  function walk(
    el: Element,
    ancestorReason: CaptureCandidateExcludeReason | null
  ): void {
    if (seen.has(el)) {
      return;
    }
    seen.add(el);

    const decision = evaluate(el);
    const ownReason = getOwnExcludeReason(el, delta, decision);
    const excludeReason = mergeExcludeReason(ancestorReason, ownReason);
    candidates.push({
      domPath: getDomPath(el),
      region: getRegion(el, regions),
      classification: decision.classification,
      included: excludeReason === null,
      excludeReason,
      computedStyleSummary: decision.computedStyleSummary,
      textPreview: getTextPreview(el, maxPreviewLength),
    });

    const childReason = getInheritableReason(excludeReason);
    const shadowChildren = el.shadowRoot
      ? Array.from(el.shadowRoot.children)
      : [];
    for (const child of [...shadowChildren, ...Array.from(el.children)]) {
      walk(child, childReason);
    }
  }

  walk(root, inheritedReason);
  return candidates;
}
