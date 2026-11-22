import githubJson from "../../fingerprints/github.json" with { type: "json" };
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

const GITHUB_HOST = "github.com";
const TURBO_BODY_SELECTOR = "body[data-turbo-body]";
const GITHUB_DOM_SELECTORS = [
  "header.AppHeader",
  "header.Header",
  "#repository-container-header",
];

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

function isGitHubHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === GITHUB_HOST || normalized.endsWith(`.${GITHUB_HOST}`);
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

function hasHeaderOrFooterAncestor(el: Element): boolean {
  let current: Element | null = el;
  while (current) {
    if (current.tagName === "HEADER" || current.tagName === "FOOTER") {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function withoutNestedRoots(elements: readonly Element[]): Element[] {
  return elements.filter(
    (element) =>
      !elements.some(
        (candidate) => candidate !== element && candidate.contains(element)
      )
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
      !hasHeaderOrFooterAncestor(element) &&
      !isExcluded(element, fingerprint)
  );
  return withoutNestedRoots(candidates);
}

export function createGitHubAdapter(
  fingerprint: FingerprintData = githubJson as FingerprintData
): SiteStructureAdapter {
  function detect({ host, doc }: StructureAdapterContext): boolean {
    if (isGitHubHost(host)) {
      return true;
    }

    const hasGitHubMeta = fingerprint.detectSelectors.some(
      (selector) => selector !== TURBO_BODY_SELECTOR && hasMatch(doc, selector)
    );
    if (hasGitHubMeta) {
      return true;
    }

    // Turbo alone is not GitHub evidence; require a GitHub-specific DOM root.
    return GITHUB_DOM_SELECTORS.some((selector) => hasMatch(doc, selector));
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

export const githubAdapter: SiteStructureAdapter = createGitHubAdapter();
