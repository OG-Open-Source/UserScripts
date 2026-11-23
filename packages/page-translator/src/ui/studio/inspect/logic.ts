import type { StyleReader } from "../../../capture/display-role";
import { encodeInlineNodes } from "../../../capture/inline-codec";
import { collectSegments } from "../../../capture/segmenter";
import { routePrimary } from "../../../core/router";
import type { SiteLocaleTable } from "../../../dict/template";
import { extractTemplate, matchSiteTranslation } from "../../../dict/template";
import type { TranslatorConfig } from "../../../platform/config";
import type { PtrMetrics, PtrMetricsSnapshot } from "../../../platform/metrics";
import {
  getMetricsSnapshot,
  recordScanTiming,
} from "../../../platform/metrics";
import { resolveAdapter } from "../../../structure/registry";
import type { CompiledSiteDelta } from "../../../structure/site-rules";
import {
  extractVisibleText,
  normalizeChineseText,
} from "../../../text/normalize";

export type InspectKind = "static" | "dynamic" | "plus" | "manual";

export interface SegmentHoverMeta {
  kind: InspectKind;
  mods: string[];
  route: string;
  scope: string | null;
  snippet: string;
  spacingDiff: string;
  spacingMode: string;
  spacingSummary: string;
  template: string;
  values: string[];
}

export interface InspectCounts {
  dynamic: number;
  manual: number;
  plus: number;
  static: number;
  total: number;
}

export interface InspectScanResult {
  adapterId: string;
  counts: InspectCounts;
  hoverMap: WeakMap<Element, SegmentHoverMeta>;
  metrics: PtrMetricsSnapshot;
}

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export function resolveInspectAdapterId(doc: Document): string {
  const host = doc.location?.hostname ?? "";
  return resolveAdapter({ host, doc }).id;
}

export function scanInspectSegments(
  doc: Document,
  delta: CompiledSiteDelta,
  cfg: Pick<
    TranslatorConfig,
    | "debugSpacingMarks"
    | "openccMode"
    | "punctNorm"
    | "spacingMode"
    | "targetLang"
  >,
  metrics: PtrMetrics,
  options: {
    getStyle?: StyleReader;
    siteTable?: SiteLocaleTable | null;
  } = {}
): InspectScanResult {
  const adapterId = resolveInspectAdapterId(doc);
  const root = doc.body ?? doc.documentElement;
  const t0 = nowMs();
  const segments = root
    ? collectSegments(
        root,
        delta,
        options.getStyle ? { getStyle: options.getStyle } : undefined
      )
    : [];
  const elapsed = Math.max(0, Math.round(nowMs() - t0));
  recordScanTiming(metrics, elapsed, segments.length);

  const counts: InspectCounts = {
    total: segments.length,
    static: 0,
    dynamic: 0,
    plus: 0,
    manual: 0,
  };
  const hoverMap = new WeakMap<Element, SegmentHoverMeta>();

  metrics.routing.api = 0;
  metrics.routing.opencc = 0;
  metrics.routing.skip = 0;

  for (const seg of segments) {
    const enc = encodeInlineNodes(seg.nodes, delta);
    const ext = extractTemplate(enc.payloadHtml);
    const manualHit = matchSiteTranslation(
      enc.payloadHtml,
      options.siteTable,
      seg.container
    );

    let kind: InspectKind;
    if (manualHit) {
      kind = "manual";
      counts.manual += 1;
    } else if (seg.sourceRule === "+") {
      kind = "plus";
      counts.plus += 1;
    } else if (ext.kind === "dynamic") {
      kind = "dynamic";
      counts.dynamic += 1;
    } else {
      kind = "static";
      counts.static += 1;
    }

    const visible = extractVisibleText(enc.payloadHtml);
    const route = routePrimary(visible, cfg.targetLang);
    if (route === "translate") {
      metrics.routing.api += 1;
    } else if (route === "zh-subsystem") {
      metrics.routing.opencc += 1;
    } else {
      metrics.routing.skip += 1;
    }

    const normalized = normalizeChineseText(visible, {
      spacingMode: cfg.spacingMode,
      punctNorm: cfg.punctNorm,
      debugSpacingMarks: cfg.debugSpacingMarks,
    });
    const spacingDiff =
      normalized === visible ? "unchanged" : `${visible} -> ${normalized}`;

    hoverMap.set(seg.container, {
      kind,
      mods: Array.from(seg.modifiers),
      route,
      scope: manualHit?.scope ?? null,
      snippet: visible.slice(0, 80),
      spacingDiff,
      spacingMode: cfg.spacingMode,
      spacingSummary: normalized.slice(0, 80),
      template: ext.template,
      values: ext.values,
    });
  }

  metrics.segments.total = counts.total;
  metrics.segments.autoStatic = counts.static;
  metrics.segments.autoDynamic = counts.dynamic;
  metrics.segments.plus = counts.plus;
  metrics.segments.manual = counts.manual;

  return {
    adapterId,
    counts,
    hoverMap,
    metrics: getMetricsSnapshot(metrics),
  };
}

export function buildInspectDiagnostics(
  adapterId: string,
  scan: InspectScanResult,
  url: string
): string {
  return JSON.stringify(
    {
      adapterId,
      detectedFramework: adapterId,
      url,
      counts: scan.counts,
      metrics: scan.metrics,
    },
    null,
    2
  );
}
