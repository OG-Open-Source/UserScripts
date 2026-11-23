import discourseJson from "../../fingerprints/discourse.json" with {
  type: "json",
};
import type { SiteStructureAdapter, StructureAdapterContext } from "./adapter";
import {
  createCaptureScope,
  createElementPolicy,
  createRegions,
  createSpaRegions,
  hasMatch,
} from "./fingerprint-adapter";
import type { FingerprintData } from "./fingerprints";

export function createDiscourseAdapter(
  fingerprint: FingerprintData = discourseJson as FingerprintData
): SiteStructureAdapter {
  function detect({ doc }: StructureAdapterContext): boolean {
    return (
      fingerprint.detectSelectors.some((selector) => hasMatch(doc, selector)) ||
      (hasMatch(doc, "#main-outlet") && hasMatch(doc, "header.d-header"))
    );
  }

  return {
    id: fingerprint.id,
    detect,
    regions: (doc) => createRegions(doc, fingerprint),
    captureScope: (doc) => createCaptureScope(doc, fingerprint),
    onSpaNavigate: (doc) => createSpaRegions(doc, fingerprint),
    elementPolicy: (el) => createElementPolicy(el, fingerprint),
  };
}

export const discourseAdapter: SiteStructureAdapter = createDiscourseAdapter();
