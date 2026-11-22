export type ElementTreatment =
  | "menu"
  | "button"
  | "title"
  | "badge"
  | "prose"
  | "atomic"
  | "skip";

export interface StructureAdapterContext {
  doc: Document;
  host: string;
}

export type StructureRegionMap = Record<string, Element[]>;

export interface SiteStructureAdapter {
  captureScope: (doc: Document) => Element[];
  detect: (ctx: StructureAdapterContext) => boolean;
  elementPolicy: (el: Element) => ElementTreatment;
  id: string;
  onSpaNavigate: (prev: Document) => Element[];
  regions: (doc: Document) => StructureRegionMap;
}
