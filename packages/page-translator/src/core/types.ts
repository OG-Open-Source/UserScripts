import type { TranslatorConfig } from "../platform/config";
import type { PtrMetrics } from "../platform/metrics";
import type { CompiledSiteDelta, SiteModifier } from "../structure/site-rules";

export type ProviderId = "translate-pa" | "inspect" | "human-only";

export interface TranslationRequestOptions {
  signal?: AbortSignal;
  sourceLang?: string;
  targetLang: string;
}

export interface GroupedTranslateItem {
  html: string;
  id: string;
}

export interface TranslationProvider {
  readonly id: ProviderId;
  translateBatch: (
    items: string[],
    opts: TranslationRequestOptions
  ) => Promise<string[]>;
  translateGrouped?: (
    groups: readonly (readonly GroupedTranslateItem[])[],
    opts: TranslationRequestOptions
  ) => Promise<Map<string, string>>;
}

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
