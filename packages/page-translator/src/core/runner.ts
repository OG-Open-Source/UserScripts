import type { EncodedInlineSegment } from "../capture/inline-codec";
import { encodeInlineNodes } from "../capture/inline-codec";
import type { TranslationSegment } from "../capture/segmenter";
import { pickLocaleTable } from "../dict/store";
import type { SiteLocaleTable } from "../dict/template";
import { extractTemplate, matchSiteTranslation } from "../dict/template";
import type { UpstreamClient } from "../dict/upstream";
import type { OpenCCMode, TranslatorConfig } from "../platform/config";
import type { PtrMetrics } from "../platform/metrics";
import { recordApiBatch } from "../platform/metrics";
import type { InspectKind, RenderPostProcess } from "../render/renderer";
import {
  renderError,
  renderInspectMarker,
  renderPending,
  renderTranslated,
} from "../render/renderer";
import type { CompiledSiteDelta } from "../structure/site-rules";
import { extractPageKeywords, maskKeywordsInHtml } from "../text/keywords";
import { normalizeChineseText } from "../text/normalize";
import type { OpenCCConverter } from "../text/opencc";
import { scheduleOpenCC } from "../text/opencc";
import type { PrimaryRoute } from "./router";
import { parseBcp47, routePrimary } from "./router";
import type { GroupedTranslateItem, TranslationProvider } from "./types";

export interface BatchRunnerOptions {
  beforeApiDispatch?: () => Promise<void>;
  coalesceMs?: number;
  delta: CompiledSiteDelta;
  doc: Document;
  getConfig: () => TranslatorConfig;
  getGlossary?: () => readonly string[];
  getOpenCC?: (mode: Exclude<OpenCCMode, "off">) => Promise<OpenCCConverter>;
  getProvider: (cfg: TranslatorConfig) => TranslationProvider;
  getSiteLocaleTable?: () => SiteLocaleTable | null;
  host?: string;
  isInspectActive?: () => boolean;
  metrics?: PtrMetrics;
  upstream?: UpstreamClient;
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

interface TranslateMiss {
  encoded: EncodedInlineSegment;
  seg: TranslationSegment;
}

const MAX_GROUP_ITEMS = 8;
const MAX_GROUP_CHARS = 2400;

const NO_OP_POST: RenderPostProcess = {
  punctNorm: "off",
  spacingMode: "off",
  spacing: false,
};

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
  route: PrimaryRoute,
  openccEnabled: boolean
): void {
  if (!metrics) {
    return;
  }
  if (route === "skip") {
    metrics.routing.skip += 1;
  } else if (route === "zh-subsystem") {
    if (openccEnabled) {
      metrics.routing.opencc += 1;
    } else {
      metrics.routing.skip += 1;
    }
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

function buildZhPostProcess(cfg: TranslatorConfig): RenderPostProcess {
  return {
    spacingMode: cfg.spacingMode,
    punctNorm: cfg.punctNorm,
    debugSpacingMarks: cfg.debugSpacingMarks,
  };
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
    postBase: RenderPostProcess,
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

  async function awaitBeforeDispatch(gen: number): Promise<boolean> {
    if (!options.beforeApiDispatch) {
      return true;
    }
    await options.beforeApiDispatch();
    return gen === generation;
  }

  async function runFlushEntries(
    active: PendingFlushEntry[],
    lastActive: PendingFlushEntry,
    gen: number
  ): Promise<void> {
    const { cfg } = lastActive;
    const { getOpenCC, metrics } = options;
    const isZhTarget = parseBcp47(cfg.targetLang).lang === "zh";
    const postBase = isZhTarget ? buildZhPostProcess(cfg) : NO_OP_POST;
    const openccSchedule = scheduleOpenCC(cfg);
    const provider = options.getProvider(cfg);
    const allJobs = active.flatMap((entry) => entry.jobs);
    const { uniquePayloads, payloadToIdx, uniqueMeta } = dedupeApiJobs(allJobs);

    if (metrics) {
      metrics.apiTotalJobs += allJobs.length;
      metrics.apiUniquePayloads += uniquePayloads.length;
    }

    const openccPromise =
      isZhTarget && openccSchedule.enabled && getOpenCC
        ? getOpenCC(openccSchedule.mode)
        : undefined;

    try {
      if (options.beforeApiDispatch && !(await awaitBeforeDispatch(gen))) {
        return;
      }
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
    cfg: TranslatorConfig
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
      renderInspectMarker(seg, options.doc, {
        kind,
        spacingMode: cfg.spacingMode,
      });
    }
  }

  function collectApiOrCachedSegment(
    seg: TranslationSegment,
    encoded: EncodedInlineSegment,
    cfg: TranslatorConfig,
    providerId: string,
    keywords: readonly string[],
    isZhTarget: boolean,
    openccEnabled: boolean,
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
        needsOpenCC: isZhTarget && openccEnabled,
      });
      return;
    }
    out.apiJobs.push({ seg, encoded, maskedPayload, cacheKey });
    if (metrics) {
      metrics.cacheMisses += 1;
    }
  }

  function renderImmediateHitsSync(
    immediateHits: ImmediateHit[],
    postBase: RenderPostProcess,
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
    postBase: RenderPostProcess,
    gen: number
  ): Promise<boolean> {
    const { getOpenCC, metrics } = options;
    const modes = Array.from(new Set(openccJobs.map((j) => j.mode)));
    const convMap = new Map<Exclude<OpenCCMode, "off">, OpenCCConverter>();
    if (getOpenCC) {
      const openccInitStart = Date.now();
      await Promise.all(
        modes.map(async (m) => {
          convMap.set(m, await getOpenCC(m));
        })
      );
      if (metrics) {
        metrics.openccInitMs = Date.now() - openccInitStart;
      }
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

  function handleZhSubsystem(
    seg: TranslationSegment,
    encoded: EncodedInlineSegment,
    cfg: TranslatorConfig,
    openccSchedule: ReturnType<typeof scheduleOpenCC>,
    out: { immediateHits: ImmediateHit[]; openccJobs: OpenccJob[] }
  ): void {
    if (openccSchedule.enabled && options.getOpenCC) {
      out.openccJobs.push({ seg, encoded, mode: openccSchedule.mode });
      return;
    }
    const normalized = normalizeChineseText(encoded.payloadHtml, {
      debugSpacingMarks: cfg.debugSpacingMarks,
      punctNorm: cfg.punctNorm,
      spacingMode: seg.modifiers.has("no-spacing") ? "off" : cfg.spacingMode,
    });
    if (normalized === encoded.payloadHtml) {
      return;
    }
    out.immediateHits.push({
      seg,
      encoded,
      html: encoded.payloadHtml,
      needsOpenCC: false,
    });
  }

  function collectInitialRoutes(
    segments: TranslationSegment[],
    cfg: TranslatorConfig,
    siteTable: SiteLocaleTable | null,
    openccSchedule: ReturnType<typeof scheduleOpenCC>,
    isZhTarget: boolean
  ) {
    const { plainTexts, keywords } = prepareBatchKeywords(segments);
    const openccJobs: OpenccJob[] = [];
    const immediateHits: ImmediateHit[] = [];
    const translateMisses: TranslateMiss[] = [];

    for (const [i, seg] of segments.entries()) {
      const encoded = encodeInlineNodes(seg.nodes, options.delta);
      const plain = plainTexts[i] ?? "";
      const route = routePrimary(plain, cfg.targetLang);
      recordRouteMetric(options.metrics, route, openccSchedule.enabled);

      if (route === "skip") {
        continue;
      }
      if (route === "zh-subsystem") {
        handleZhSubsystem(seg, encoded, cfg, openccSchedule, {
          immediateHits,
          openccJobs,
        });
        continue;
      }
      const manualHit = matchSiteTranslation(
        encoded.payloadHtml,
        siteTable,
        seg.container
      );
      if (manualHit) {
        recordManualMetrics(options.metrics, manualHit.scope);
        immediateHits.push({
          seg,
          encoded,
          html: manualHit.html,
          needsOpenCC: isZhTarget && openccSchedule.enabled,
        });
        continue;
      }
      translateMisses.push({ seg, encoded });
    }

    return { keywords, openccJobs, immediateHits, translateMisses };
  }

  function partitionTranslateMisses(
    translateMisses: TranslateMiss[],
    upstreamTable: SiteLocaleTable | null,
    cfg: TranslatorConfig,
    providerId: string,
    keywords: readonly string[],
    isZhTarget: boolean,
    openccEnabled: boolean,
    out: { apiJobs: QueuedApiJob[]; immediateHits: ImmediateHit[] }
  ): void {
    const humanOnly =
      cfg.provider === "human-only" || providerId === "human-only";

    for (const miss of translateMisses) {
      const upstreamHit = upstreamTable
        ? matchSiteTranslation(
            miss.encoded.payloadHtml,
            upstreamTable,
            miss.seg.container
          )
        : null;
      if (upstreamHit) {
        recordManualMetrics(options.metrics, upstreamHit.scope);
        out.immediateHits.push({
          seg: miss.seg,
          encoded: miss.encoded,
          html: upstreamHit.html,
          needsOpenCC: isZhTarget && openccEnabled,
        });
        continue;
      }
      if (humanOnly) {
        continue;
      }
      collectApiOrCachedSegment(
        miss.seg,
        miss.encoded,
        cfg,
        providerId,
        keywords,
        isZhTarget,
        openccEnabled,
        out
      );
    }
    for (const job of out.apiJobs) {
      renderPending(job.seg, options.doc);
    }
  }

  async function fetchUpstreamTable(
    upstream: UpstreamClient,
    host: string,
    targetLang: string,
    gen: number
  ): Promise<{ aborted: boolean; table: SiteLocaleTable | null }> {
    const upstreamFile = await upstream.ensureHost(host);
    if (gen !== generation) {
      return { aborted: true, table: null };
    }
    return { aborted: false, table: pickLocaleTable(upstreamFile, targetLang) };
  }

  function getImmediateOpenccMode(
    immediateHits: ImmediateHit[],
    cfg: TranslatorConfig,
    isZhTarget: boolean
  ): Exclude<OpenCCMode, "off"> | null {
    const opencc = scheduleOpenCC(cfg);
    if (!(isZhTarget && opencc.enabled && options.getOpenCC)) {
      return null;
    }
    if (!immediateHits.some((h) => h.needsOpenCC)) {
      return null;
    }
    return opencc.mode;
  }

  async function executeBatchJobs(
    cfg: TranslatorConfig,
    gen: number,
    isZhTarget: boolean,
    immediateHits: ImmediateHit[],
    openccJobs: OpenccJob[],
    apiJobs: QueuedApiJob[]
  ): Promise<void> {
    const postBase = isZhTarget ? buildZhPostProcess(cfg) : NO_OP_POST;
    const immediateMode = getImmediateOpenccMode(
      immediateHits,
      cfg,
      isZhTarget
    );
    const immediateConv =
      immediateMode && options.getOpenCC
        ? await options.getOpenCC(immediateMode)
        : undefined;
    if (gen !== generation) {
      return;
    }

    renderImmediateHitsSync(immediateHits, postBase, immediateConv);

    if (openccJobs.length > 0 && options.getOpenCC) {
      const okOpencc = await processOpenccJobs(openccJobs, postBase, gen);
      if (!okOpencc) {
        return;
      }
    }

    if (apiJobs.length > 0) {
      await enqueueApiJobs(apiJobs, gen, cfg);
    }
  }

  async function translateBatch(segments: TranslationSegment[]): Promise<void> {
    if (segments.length === 0) {
      return;
    }
    const gen = generation;
    const cfg = options.getConfig();
    const siteTable = options.getSiteLocaleTable?.() ?? null;
    const provider = options.getProvider(cfg);
    const openccSchedule = scheduleOpenCC(cfg);
    const isZhTarget = parseBcp47(cfg.targetLang).lang === "zh";

    if (
      (options.isInspectActive?.() ?? cfg.defaultInspect) &&
      cfg.provider === "inspect"
    ) {
      renderInspectOnly(segments, siteTable, cfg);
      return;
    }

    const { keywords, openccJobs, immediateHits, translateMisses } =
      collectInitialRoutes(
        segments,
        cfg,
        siteTable,
        openccSchedule,
        isZhTarget
      );

    let upstreamTable: SiteLocaleTable | null = null;
    if (translateMisses.length > 0 && options.upstream && options.host) {
      const upstreamRes = await fetchUpstreamTable(
        options.upstream,
        options.host,
        cfg.targetLang,
        gen
      );
      if (upstreamRes.aborted) {
        return;
      }
      upstreamTable = upstreamRes.table;
    }

    const apiJobs: QueuedApiJob[] = [];
    partitionTranslateMisses(
      translateMisses,
      upstreamTable,
      cfg,
      provider.id,
      keywords,
      isZhTarget,
      openccSchedule.enabled,
      { apiJobs, immediateHits }
    );

    await executeBatchJobs(
      cfg,
      gen,
      isZhTarget,
      immediateHits,
      openccJobs,
      apiJobs
    );
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
