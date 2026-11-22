import {
  isCodeOrMonospace,
  isNonProsePrimitive,
} from "../capture/display-role";
import type {
  ElementTreatment,
  SiteStructureAdapter,
  StructureRegionMap,
} from "./adapter";

function documentScope(doc: Document): Element[] {
  return doc.body ? [doc.body] : [];
}

function fallbackPolicy(el: Element): ElementTreatment {
  if (isCodeOrMonospace(el)) {
    return "skip";
  }
  return isNonProsePrimitive(el) ? "atomic" : "prose";
}

export const fallbackAdapter: SiteStructureAdapter = {
  id: "fallback",
  detect: () => true,
  regions(doc): StructureRegionMap {
    return { content: documentScope(doc) };
  },
  captureScope: documentScope,
  onSpaNavigate: documentScope,
  elementPolicy: fallbackPolicy,
};
