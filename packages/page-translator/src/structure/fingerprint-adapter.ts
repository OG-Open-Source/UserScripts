import {
  isCodeOrMonospace,
  isNonProsePrimitive,
} from "../capture/display-role";
import type { ElementTreatment, StructureRegionMap } from "./adapter";
import type { FingerprintData } from "./fingerprints";
import { matchesAny, safeMatches } from "./site-rules";

export function selectAll(
  doc: Document,
  selectors: readonly string[]
): Element[] {
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

export function hasMatch(doc: Document, selector: string): boolean {
  try {
    return doc.querySelector(selector) !== null;
  } catch {
    return false;
  }
}

export function isExcluded(el: Element, fingerprint: FingerprintData): boolean {
  let current: Element | null = el;
  while (current) {
    if (matchesAny(current, fingerprint.excludeSelectors)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

export function withoutNestedRoots(elements: readonly Element[]): Element[] {
  return elements.filter(
    (element) =>
      !elements.some(
        (candidate) => candidate !== element && candidate.contains(element)
      )
  );
}

export function createRegions(
  doc: Document,
  fingerprint: FingerprintData
): StructureRegionMap {
  const regions: StructureRegionMap = {};
  for (const [name, selectors] of Object.entries(fingerprint.regions)) {
    regions[name] = selectAll(doc, selectors);
  }
  return regions;
}

export function createCaptureScope(
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

export function createSpaRegions(
  doc: Document,
  fingerprint: FingerprintData,
  extraFilter: (element: Element) => boolean = () => true
): Element[] {
  const candidates = selectAll(doc, fingerprint.spaRescanSelectors).filter(
    (element) =>
      element !== doc.body &&
      element !== doc.documentElement &&
      !isExcluded(element, fingerprint) &&
      extraFilter(element)
  );
  return withoutNestedRoots(candidates);
}

export function createElementPolicy(
  el: Element,
  fingerprint: FingerprintData
): ElementTreatment {
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
