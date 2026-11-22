import discourseJson from "../../fingerprints/discourse.json" with {
  type: "json",
};
import {
  isCodeOrMonospace,
  isNonProsePrimitive,
} from "../capture/display-role";
import type {
  ElementTreatment,
  SiteStructureAdapter,
  StructureAdapterContext,
  StructureRegionMap,
} from "./adapter";
import type { FingerprintData } from "./fingerprints";
import { matchesAny, safeMatches } from "./site-rules";

function selectAll(doc: Document, selectors: readonly string[]): Element[] {
  const elements: Element[] = [];
  const seen = new Set<Element>();
  for (const selector of selectors) {
    try {
      for (const element of doc.querySelectorAll(selector)) {
        if (!seen.has(element)) {
          seen.add(element);
          elements.push(element);
        }
      }
    } catch {
      // Remote fingerprints may contain selectors unsupported by this engine.
    }
  }
  return elements;
}

function hasMatch(doc: Document, selector: string): boolean {
  try {
    return doc.querySelector(selector) !== null;
  } catch {
    return false;
  }
}

function isExcluded(el: Element, fingerprint: FingerprintData): boolean {
  let current: Element | null = el;
  while (current) {
    if (matchesAny(current, fingerprint.excludeSelectors)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function withoutNestedRoots(elements: readonly Element[]): Element[] {
  return elements.filter(
    (element, index) =>
      !elements.slice(0, index).some((candidate) => candidate.contains(element))
  );
}

function createRegions(
  doc: Document,
  fingerprint: FingerprintData
): StructureRegionMap {
  const regions: StructureRegionMap = {};
  for (const [name, selectors] of Object.entries(fingerprint.regions)) {
    regions[name] = selectAll(doc, selectors);
  }
  return regions;
}

function createCaptureScope(
  doc: Document,
  fingerprint: FingerprintData
): Element[] {
  const candidates = selectAll(doc, fingerprint.captureSelectors).filter(
    (element) => !isExcluded(element, fingerprint)
  );
  const roots = withoutNestedRoots(candidates);
  if (roots.length > 0) {
    return roots;
  }
  return doc.body && !isExcluded(doc.body, fingerprint) ? [doc.body] : [];
}

function createSpaRegions(
  doc: Document,
  fingerprint: FingerprintData
): Element[] {
  const candidates = selectAll(doc, fingerprint.spaRescanSelectors).filter(
    (element) =>
      element !== doc.body &&
      element !== doc.documentElement &&
      !isExcluded(element, fingerprint)
  );
  return withoutNestedRoots(candidates);
}

export function createDiscourseAdapter(
  fingerprint: FingerprintData = discourseJson as FingerprintData
): SiteStructureAdapter {
  function detect({ doc }: StructureAdapterContext): boolean {
    return (
      fingerprint.detectSelectors.some((selector) => hasMatch(doc, selector)) ||
      (hasMatch(doc, "#main-outlet") && hasMatch(doc, "header.d-header"))
    );
  }

  function elementPolicy(el: Element): ElementTreatment {
    if (isCodeOrMonospace(el)) {
      return "skip";
    }
    if (isExcluded(el, fingerprint)) {
      return "skip";
    }
    for (const [selector, treatment] of Object.entries(fingerprint.policies)) {
      if (safeMatches(el, selector)) {
        return treatment;
      }
    }
    return isNonProsePrimitive(el) ? "atomic" : "prose";
  }

  return {
    id: fingerprint.id,
    detect,
    regions: (doc) => createRegions(doc, fingerprint),
    captureScope: (doc) => createCaptureScope(doc, fingerprint),
    onSpaNavigate: (doc) => createSpaRegions(doc, fingerprint),
    elementPolicy,
  };
}

export const discourseAdapter: SiteStructureAdapter = createDiscourseAdapter();
