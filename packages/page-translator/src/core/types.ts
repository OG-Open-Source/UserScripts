import type { TranslatorConfig } from "../legacy/config";
import type { PtrMetrics } from "../legacy/metrics";
import type { CompiledSiteDelta, SiteModifier } from "../structure/site-rules";

export interface TranslationSegment {
  container: Element;
  displayContents?: boolean;
  id: string;
  modifiers: Set<SiteModifier>;
  nodes: Node[];
  sourceRule: "auto" | "+";
}

export interface TranslationContext {
  cfg: TranslatorConfig;
  delta: CompiledSiteDelta;
  doc: Document;
  metrics: PtrMetrics;
}

export type StageResult =
  | "skip"
  | "normalize"
  | "opencc"
  | "dict"
  | "upstream"
  | "provider";
