import type { EncodedInlineSegment } from "../capture/inline-codec";
import { encodeInlineNodes } from "../capture/inline-codec";
import type { TranslationSegment } from "../capture/segmenter";
import type { OpenCCMode, TranslatorConfig } from "../config";
import { resolveSpacingMode } from "../config";
import type { PtrMetrics } from "../metrics";
import { recordApiBatch } from "../metrics";
import type { InspectKind } from "../renderer";
import {
  renderError,
  renderInspectMarker,
  renderPending,
  renderTranslated,
} from "../renderer";
import type { CompiledSiteDelta } from "../site-rules";
import { extractPageKeywords, maskKeywordsInHtml } from "../transform/keywords";
import { routeSegment } from "../transform/lang-route";
import type { OpenCCConverter } from "../transform/opencc";
import type { SiteLocaleTable } from "../transform/template";
import { extractTemplate, matchSiteTranslation } from "../transform/template";
import type { GroupedTranslateItem, TranslationProvider } from "./provider";

export interface BatchRunnerOptions {
  coalesceMs?: number;
  delta: CompiledSiteDelta;
  doc: Document;
  getConfig: () => TranslatorConfig;
  getGlossary?: () => readonly string[];
  getOpenCC?: (mode: Exclude<OpenCCMode, "off">) => Promise<OpenCCConverter>;
  getProvider: (cfg: TranslatorConfig) => TranslationProvider;
  getSiteLocaleTable?: () => SiteLocaleTable | null;
  metrics?: PtrMetrics;
}

interface QueuedApiJob {
  cacheKey: string;
  encoded: EncodedInlineSegment;
  maskedPayload: string;
  seg: TranslationSegment;
}

interface PendingFlushEntry {
  cfg: TranslatorConfig;
  gen: number;
  jobs: QueuedApiJob[];
  reject: (err: unknown) => void;
  resolve: () => void;
}

interface UniquePayloadMeta {
  id: string;
  maskedPayload: string;
  parent: Element | null;
}

interface ImmediateHit {
  encoded: EncodedInlineSegment;
  html: string;
  needsOpenCC: boolean;
  seg: TranslationSegment;
}

interface OpenccJob {
  encoded: EncodedInlineSegment;
  mode: Exclude<OpenCCMode, "off">;
  seg: TranslationSegment;
}

interface PostBase {
  debugSpacingMarks: boolean;
  punctNorm: TranslatorConfig["punctNorm"];
  spacingMode: ReturnType<typeof resolveSpacingMode>;
}

const MAX_GROUP_ITEMS = 8;
const MAX_GROUP_CHARS = 2400;

function resolveInspectKind(
  sourceRule: TranslationSegment["sourceRule"],
  hasManualHit: boolean,
  payloadHtml: string
): InspectKind {
  if (sourceRule === "+") {
    return "+";
  }
  if (hasManualHit) {
    return "manual";
  }
  return extractTemplate(payloadHtml).kind === "dynamic"
    ? "auto-dynamic"
    : "auto-static";
}

function buildContextGroups(
  uniqueEntries: UniquePayloadMeta[]
): GroupedTranslateItem[][] {
  const byParent = new Map<Element | null, GroupedTranslateItem[]>();
  for (const entry of uniqueEntries) {
    const list = byParent.get(entry.parent) ?? [];
    list.push({ id: entry.id, html: entry.maskedPayload });
    byParent.set(entry.parent, list);
  }
  const groups: GroupedTranslateItem[][] = [];
  for (const items of byParent.values()) {
    let cur: GroupedTranslateItem[] = [];
    let curChars = 0;
    for (const item of items) {
      if (
        cur.length > 0 &&
        (cur.length >= MAX_GROUP_ITEMS ||
          curChars + item.html.length > MAX_GROUP_CHARS)
      ) {
        groups.push(cur);
        cur = [];
        curChars = 0;
      }
      cur.push(item);
      curChars += item.html.length;
    }
    if (cur.length > 0) {
      groups.push(cur);
    }
  }
  return groups;
}

function dedupeApiJobs(allJobs: QueuedApiJob[]): {
  payloadToIdx: Map<string, number>;
  uniqueMeta: UniquePayloadMeta[];
  uniquePayloads: string[];
} {
  const uniquePayloads: string[] = [];
  const payloadToIdx = new Map<string, number>();
  const uniqueMeta: UniquePayloadMeta[] = [];

  for (const job of allJobs) {
    if (!payloadToIdx.has(job.maskedPayload)) {
      const uIdx = uniquePayloads.length;
      payloadToIdx.set(job.maskedPayload, uIdx);
      uniquePayloads.push(job.maskedPayload);
      uniqueMeta.push({
        id: `u${uIdx}`,
        maskedPayload: job.maskedPayload,
        parent: job.seg.container.parentElement,
      });
    }
  }

  return { uniquePayloads, payloadToIdx, uniqueMeta };
}

async function translateUniquePayloads(
  provider: TranslationProvider,
  uniquePayloads: string[],
  uniqueMeta: UniquePayloadMeta[],
  targetLang: string
): Promise<Map<number, string>> {
  const groups = buildContextGroups(uniqueMeta);
  const hasMultiGroup = groups.some((g) => g.length > 1);
  let translatedByPayloadIdx = new Map<number, string>();

  if (provider.translateGrouped && hasMultiGroup) {
    try {
      const groupedMap = await provider.translateGrouped(groups, {
        targetLang,
      });
      for (const [i, meta] of uniqueMeta.entries()) {
        const val = groupedMap.get(meta.id);
        if (val !== undefined) {
          translatedByPayloadIdx.set(i, val);
        }
      }
    } catch {
      // Fall back to flat translateBatch below
      translatedByPayloadIdx = new Map<number, string>();
    }
  }

  const missingIndices: number[] = [];
  const missingPayloads: string[] = [];
  for (const [i, payload] of uniquePayloads.entries()) {
    if (!translatedByPayloadIdx.has(i)) {
      missingIndices.push(i);
      missingPayloads.push(payload);
    }
  }

  if (missingPayloads.length > 0) {
    const flatResults = await provider.translateBatch(missingPayloads, {
      targetLang,
    });
    for (const [k, idx] of missingIndices.entries()) {
      const fallback = uniquePayloads[idx] ?? "";
      translatedByPayloadIdx.set(idx, flatResults[k] ?? fallback);
    }
  }

  return translatedByPayloadIdx;
}

function resolvePendingEntries(entries: PendingFlushEntry[]): void {
  for (const entry of entries) {
    entry.resolve();
  }
}

function recordRouteMetric(
  metrics: PtrMetrics | undefined,
  action: "opencc" | "skip" | "translate"
): void {
  if (!metrics) {
    return;
  }
  if (action === "skip") {
    metrics.routing.skip += 1;
  } else if (action === "opencc") {
    metrics.routing.opencc += 1;
  } else {
    metrics.routing.api += 1;
  }
}

function recordManualMetrics(
  metrics: PtrMetrics | undefined,
  scope?: string
): void {
  if (!metrics) {
    return;
  }
  metrics.segments.manual += 1;
  if (scope) {
    metrics.segments.scopedHits += 1;
  }
}

export function createBatchRunner(options: BatchRunnerOptions) {
  let generation = 0;
  const pageCache = new Map<string, string>();
  const coalesceMs = options.coalesceMs ?? 0;

  let pendingQueue: PendingFlushEntry[] = [];
  let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

  function renderQueuedJobs(
    allJobs: QueuedApiJob[],
    payloadToIdx: Map<string, number>,
    translatedByPayloadIdx: Map<number, string>,
    postBase: PostBase,
    opencc: OpenCCConverter | undefined
  ): void {
    for (const job of allJobs) {
      const uIdx = payloadToIdx.get(job.maskedPayload);
      const translated =
        (uIdx === undefined ? undefined : translatedByPayloadIdx.get(uIdx)) ??
        job.encoded.payloadHtml;
      pageCache.set(job.cacheKey, translated);
      renderTranslated(
        job.seg,
        translated,
        job.encoded.slots,
        {
          ...postBase,
          opencc: opencc ? (s) => opencc.convert(s) : undefined,
        },
        options.doc
      );
    }
  }

  function handleFlushFailure(
    allJobs: QueuedApiJob[],
    gen: number,
    err: unknown
  ): void {
    if (gen !== generation) {
      return;
    }
    console.error("[ptr] translation failed:", err);
    for (const job of allJobs) {
      renderError(job.seg, options.doc);
    }
  }

  async function runFlushEntries(
    active: PendingFlushEntry[],
    lastActive: PendingFlushEntry,
    gen: number
  ): Promise<void> {
    const { cfg } = lastActive;
    const { getOpenCC, metrics } = options;
    const postBase: PostBase = {
      spacingMode: resolveSpacingMode(cfg),
      punctNorm: cfg.punctNorm,
      debugSpacingMarks: cfg.debugSpacingMarks,
    };
    const provider = options.getProvider(cfg);
    const allJobs = active.flatMap((entry) => entry.jobs);
    const { uniquePayloads, payloadToIdx, uniqueMeta } = dedupeApiJobs(allJobs);

    if (metrics) {
      metrics.apiTotalJobs += allJobs.length;
      metrics.apiUniquePayloads += uniquePayloads.length;
    }

    const openccPromise =
      cfg.openccMode !== "off" && getOpenCC
        ? getOpenCC(cfg.openccMode)
        : undefined;

    try {
      const apiStart = Date.now();
      const translatedByPayloadIdx = await translateUniquePayloads(
        provider,
        uniquePayloads,
        uniqueMeta,
        cfg.targetLang
      );
      const opencc = openccPromise ? await openccPromise : undefined;
      if (metrics) {
        recordApiBatch(metrics, Date.now() - apiStart);
      }
      if (gen === generation) {
        renderQueuedJobs(
          allJobs,
          payloadToIdx,
          translatedByPayloadIdx,
          postBase,
          opencc
        );
      }
    } catch (err) {
      handleFlushFailure(allJobs, gen, err);
    } finally {
      resolvePendingEntries(active);
    }
  }

  async function flushCoalescedQueue(): Promise<void> {
    coalesceTimer = null;
    const batch = pendingQueue;
    pendingQueue = [];
    if (batch.length === 0) {
      return;
    }
    const active = batch.filter((entry) => entry.gen === generation);
    resolvePendingEntries(batch.filter((entry) => entry.gen !== generation));
    const lastActive = active.at(-1);
    if (!lastActive) {
      return;
    }
    await runFlushEntries(active, lastActive, generation);
  }

  function enqueueApiJobs(
    jobs: QueuedApiJob[],
    gen: number,
    cfg: TranslatorConfig
  ): Promise<void> {
    if (coalesceMs <= 0) {
      return new Promise<void>((resolve, reject) => {
        pendingQueue.push({ jobs, gen, cfg, resolve, reject });
        void flushCoalescedQueue();
      });
    }
    return new Promise<void>((resolve, reject) => {
      pendingQueue.push({ jobs, gen, cfg, resolve, reject });
      if (coalesceTimer === null) {
        coalesceTimer = setTimeout(() => {
          void flushCoalescedQueue();
        }, coalesceMs);
      }
    });
  }

  function renderInspectOnly(
    segments: TranslationSegment[],
    siteTable: SiteLocaleTable | null,
    spacingMode: ReturnType<typeof resolveSpacingMode>
  ): void {
    for (const seg of segments) {
      const enc = encodeInlineNodes(seg.nodes, options.delta);
      const hasManual = Boolean(
        siteTable && matchSiteTranslation(enc.payloadHtml, siteTable)
      );
      const kind = resolveInspectKind(
        seg.sourceRule,
        hasManual,
        enc.payloadHtml
      );
      renderInspectMarker(seg, options.doc, { kind, spacingMode });
    }
  }

  function collectApiOrCachedSegment(
    seg: TranslationSegment,
    encoded: EncodedInlineSegment,
    cfg: TranslatorConfig,
    providerId: string,
    keywords: readonly string[],
    out: { apiJobs: QueuedApiJob[]; immediateHits: ImmediateHit[] }
  ): void {
    const { metrics } = options;
    const maskedPayload =
      providerId === "inspect"
        ? encoded.payloadHtml
        : maskKeywordsInHtml(encoded.payloadHtml, keywords);
    const cacheKey = `${cfg.targetLang}|${providerId}|${maskedPayload}`;
    const cached = pageCache.get(cacheKey);
    if (cached !== undefined) {
      if (metrics) {
        metrics.cacheHits += 1;
      }
      out.immediateHits.push({
        seg,
        encoded,
        html: cached,
        needsOpenCC: cfg.openccMode !== "off",
      });
      return;
    }
    out.apiJobs.push({ seg, encoded, maskedPayload, cacheKey });
    if (metrics) {
      metrics.cacheMisses += 1;
    }
  }

  function routeAndCollectSegment(
    seg: TranslationSegment,
    plain: string,
    cfg: TranslatorConfig,
    siteTable: SiteLocaleTable | null,
    spacingMode: ReturnType<typeof resolveSpacingMode>,
    providerId: string,
    keywords: readonly string[],
    out: {
      apiJobs: QueuedApiJob[];
      immediateHits: ImmediateHit[];
      openccJobs: OpenccJob[];
    }
  ): void {
    const { metrics } = options;
    const encoded = encodeInlineNodes(seg.nodes, options.delta);
    const manualHit = matchSiteTranslation(
      encoded.payloadHtml,
      siteTable,
      seg.container
    );

    if (cfg.debugInspect) {
      const kind = resolveInspectKind(
        seg.sourceRule,
        Boolean(manualHit),
        encoded.payloadHtml
      );
      renderInspectMarker(seg, options.doc, { kind, spacingMode });
    }

    // Route purely by the segment's own text; page-level <html lang> or
    // ancestor [lang] attributes are intentionally ignored here.
    const route = routeSegment(plain, cfg.targetLang);
    recordRouteMetric(metrics, route.action);

    if (manualHit) {
      recordManualMetrics(metrics, manualHit.scope);
      out.immediateHits.push({
        seg,
        encoded,
        html: manualHit.html,
        needsOpenCC: false,
      });
      return;
    }

    if (route.action === "skip") {
      if (cfg.spaceSkippedCjk && spacingMode !== "off") {
        out.immediateHits.push({
          seg,
          encoded,
          html: encoded.payloadHtml,
          needsOpenCC: false,
        });
      }
      return;
    }

    if (route.action === "opencc") {
      out.openccJobs.push({ seg, encoded, mode: route.mode });
      return;
    }

    collectApiOrCachedSegment(seg, encoded, cfg, providerId, keywords, out);
  }

  function renderImmediateHitsSync(
    immediateHits: ImmediateHit[],
    postBase: PostBase,
    immediateConv: OpenCCConverter | undefined
  ): void {
    for (const hit of immediateHits) {
      renderPending(hit.seg, options.doc);
      renderTranslated(
        hit.seg,
        hit.html,
        hit.encoded.slots,
        {
          ...postBase,
          ...(hit.needsOpenCC && immediateConv
            ? { opencc: (s: string) => immediateConv.convert(s) }
            : {}),
        },
        options.doc
      );
    }
  }

  async function processOpenccJobs(
    openccJobs: OpenccJob[],
    postBase: PostBase,
    gen: number
  ): Promise<boolean> {
    const { getOpenCC, metrics } = options;
    if (!getOpenCC) {
      return true;
    }
    const modes = Array.from(new Set(openccJobs.map((j) => j.mode)));
    const convMap = new Map<Exclude<OpenCCMode, "off">, OpenCCConverter>();
    const openccInitStart = Date.now();
    await Promise.all(
      modes.map(async (m) => {
        convMap.set(m, await getOpenCC(m));
      })
    );
    if (metrics) {
      metrics.openccInitMs = Date.now() - openccInitStart;
    }
    if (gen !== generation) {
      return false;
    }
    for (const job of openccJobs) {
      const conv = convMap.get(job.mode);
      renderPending(job.seg, options.doc);
      renderTranslated(
        job.seg,
        job.encoded.payloadHtml,
        job.encoded.slots,
        { ...postBase, opencc: conv ? (s) => conv.convert(s) : undefined },
        options.doc
      );
    }
    return true;
  }

  function prepareBatchKeywords(segments: TranslationSegment[]): {
    keywords: string[];
    plainTexts: string[];
  } {
    const plainTexts = segments.map((s) =>
      s.nodes
        .map((n) => n.textContent ?? "")
        .join("")
        .trim()
    );
    const pageKeywords = extractPageKeywords(plainTexts);
    const keywords = [...(options.getGlossary?.() ?? []), ...pageKeywords];
    if (options.metrics) {
      options.metrics.keywordsSample = [...keywords];
    }
    return { plainTexts, keywords };
  }

  function collectBatchRoutes(
    segments: TranslationSegment[],
    cfg: TranslatorConfig,
    siteTable: SiteLocaleTable | null,
    spacingMode: ReturnType<typeof resolveSpacingMode>
  ) {
    const provider = options.getProvider(cfg);
    const { plainTexts, keywords } = prepareBatchKeywords(segments);
    const out = {
      openccJobs: [] as OpenccJob[],
      apiJobs: [] as QueuedApiJob[],
      immediateHits: [] as ImmediateHit[],
    };
    for (const [i, seg] of segments.entries()) {
      routeAndCollectSegment(
        seg,
        plainTexts[i] ?? "",
        cfg,
        siteTable,
        spacingMode,
        provider.id,
        keywords,
        out
      );
    }
    // Synchronously mark API jobs as pending before yielding to micro-batch coalescer.
    for (const job of out.apiJobs) {
      renderPending(job.seg, options.doc);
    }
    return out;
  }

  function needsImmediateOpenCC(
    immediateHits: ImmediateHit[],
    cfg: TranslatorConfig
  ): boolean {
    return (
      cfg.openccMode !== "off" &&
      Boolean(options.getOpenCC) &&
      immediateHits.some((h) => h.needsOpenCC)
    );
  }

  async function translateBatch(segments: TranslationSegment[]): Promise<void> {
    if (segments.length === 0) {
      return;
    }
    const gen = generation;
    const cfg = options.getConfig();
    const spacingMode = resolveSpacingMode(cfg);
    const siteTable = options.getSiteLocaleTable?.() ?? null;

    if (cfg.debugInspect && cfg.provider === "inspect") {
      renderInspectOnly(segments, siteTable, spacingMode);
      return;
    }

    const out = collectBatchRoutes(segments, cfg, siteTable, spacingMode);
    const postBase: PostBase = {
      spacingMode,
      punctNorm: cfg.punctNorm,
      debugSpacingMarks: cfg.debugSpacingMarks,
    };

    const immediateConv =
      needsImmediateOpenCC(out.immediateHits, cfg) && options.getOpenCC
        ? await options.getOpenCC(cfg.openccMode as Exclude<OpenCCMode, "off">)
        : undefined;
    if (gen !== generation) {
      return;
    }
    renderImmediateHitsSync(out.immediateHits, postBase, immediateConv);

    if (out.openccJobs.length > 0 && options.getOpenCC) {
      const okOpencc = await processOpenccJobs(out.openccJobs, postBase, gen);
      if (!okOpencc) {
        return;
      }
    }

    if (out.apiJobs.length > 0) {
      await enqueueApiJobs(out.apiJobs, gen, cfg);
    }
  }

  return {
    translateBatch,
    cancelAll() {
      generation += 1;
      if (coalesceTimer !== null) {
        clearTimeout(coalesceTimer);
        coalesceTimer = null;
      }
      const cancelled = pendingQueue;
      pendingQueue = [];
      resolvePendingEntries(cancelled);
    },
    clearCache() {
      pageCache.clear();
    },
  };
}
