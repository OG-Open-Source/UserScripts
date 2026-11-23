import githubJson from "../../fingerprints/github.json" with { type: "json" };
import type { SiteStructureAdapter, StructureAdapterContext } from "./adapter";
import {
  createCaptureScope,
  createElementPolicy,
  createRegions,
  createSpaRegions,
  hasMatch,
} from "./fingerprint-adapter";
import type { FingerprintData } from "./fingerprints";

const GITHUB_HOST = "github.com";
const TURBO_BODY_SELECTOR = "body[data-turbo-body]";
const GITHUB_DOM_SELECTORS = [
  "header.AppHeader",
  "#repository-container-header",
  "#repo-content-turbo-frame",
];

function isGitHubHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === GITHUB_HOST || normalized.endsWith(`.${GITHUB_HOST}`);
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

    return (
      hasMatch(doc, TURBO_BODY_SELECTOR) &&
      GITHUB_DOM_SELECTORS.some((selector) => hasMatch(doc, selector))
    );
  }

  return {
    id: fingerprint.id,
    detect,
    regions: (doc) => createRegions(doc, fingerprint),
    captureScope: (doc) => createCaptureScope(doc, fingerprint),
    onSpaNavigate: (doc) =>
      createSpaRegions(
        doc,
        fingerprint,
        (element) => !hasHeaderOrFooterAncestor(element)
      ),
    elementPolicy: (el) => createElementPolicy(el, fingerprint),
  };
}

export const githubAdapter: SiteStructureAdapter = createGitHubAdapter();
