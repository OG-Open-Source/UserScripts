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

const MAX_GROUP_ITEMS = 8;
const MAX_GROUP_CHARS = 2400;

export function createBatchRunner(options: BatchRunnerOptions) {
  let generation = 0;
  const pageCache = new Map<string, string>();
  const coalesceMs = options.coalesceMs ?? 0;

  let pendingQueue: PendingFlushEntry[] = [];
  let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

  function buildContextGroups(
    uniqueEntries: Array<{
      id: string;
      maskedPayload: string;
      parent: Element | null;
    }>
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

  async function flushCoalescedQueue(): Promise<void> {
    coalesceTimer = null;
    const batch = pendingQueue;
    pendingQueue = [];
    if (batch.length === 0) {
      return;
    }

    const active = batch.filter((entry) => entry.gen === generation);
    for (const stale of batch) {
      if (stale.gen !== generation) {
        stale.resolve();
      }
    }
    if (active.length === 0) {
      return;
    }

    const gen = generation;
    const cfg = active[active.length - 1]!.cfg;
    const spacingMode = resolveSpacingMode(cfg);
    const postBase = {
      spacingMode,
      punctNorm: cfg.punctNorm,
      debugSpacingMarks: cfg.debugSpacingMarks,
    };
    const provider = options.getProvider(cfg);
    const metrics = options.metrics;

    const allJobs: QueuedApiJob[] = [];
    for (const entry of active) {
      allJobs.push(...entry.jobs);
    }

    const uniquePayloads: string[] = [];
    const payloadToIdx = new Map<string, number>();
    const uniqueMeta: Array<{
      id: string;
      maskedPayload: string;
      parent: Element | null;
    }> = [];

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

    if (metrics) {
      metrics.apiTotalJobs += allJobs.length;
      metrics.apiUniquePayloads += uniquePayloads.length;
    }

    const openccPromise =
      cfg.openccMode !== "off" && options.getOpenCC
        ? options.getOpenCC(cfg.openccMode)
        : undefined;

    try {
      const apiStart = Date.now();
      const groups = buildContextGroups(uniqueMeta);
      const hasMultiGroup = groups.some((g) => g.length > 1);

      let translatedByPayloadIdx = new Map<number, string>();

      if (provider.translateGrouped && hasMultiGroup) {
        try {
          const groupedMap = await provider.translateGrouped(groups, {
            targetLang: cfg.targetLang,
          });
          for (let i = 0; i < uniqueMeta.length; i++) {
            const val = groupedMap.get(uniqueMeta[i]!.id);
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
      for (let i = 0; i < uniquePayloads.length; i++) {
        if (!translatedByPayloadIdx.has(i)) {
          missingIndices.push(i);
          missingPayloads.push(uniquePayloads[i]!);
        }
      }

      if (missingPayloads.length > 0) {
        const flatResults = await provider.translateBatch(missingPayloads, {
          targetLang: cfg.targetLang,
        });
        for (let k = 0; k < missingIndices.length; k++) {
          const idx = missingIndices[k]!;
          translatedByPayloadIdx.set(
            idx,
            flatResults[k] ?? uniquePayloads[idx]!
          );
        }
      }

      const opencc = openccPromise ? await openccPromise : undefined;
      if (metrics) {
        recordApiBatch(metrics, Date.now() - apiStart);
      }

      if (gen !== generation) {
        for (const entry of active) {
          entry.resolve();
        }
        return;
      }

      for (const job of allJobs) {
        const uIdx = payloadToIdx.get(job.maskedPayload)!;
        const translated =
          translatedByPayloadIdx.get(uIdx) ?? job.encoded.payloadHtml;
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
      for (const entry of active) {
        entry.resolve();
      }
    } catch (err) {
      if (gen !== generation) {
        for (const entry of active) {
          entry.resolve();
        }
        return;
      }
      console.error("[ptr] translation failed:", err);
      for (const job of allJobs) {
        renderError(job.seg, options.doc);
      }
      for (const entry of active) {
        entry.resolve();
      }
    }
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

  async function translateBatch(segments: TranslationSegment[]): Promise<void> {
    if (segments.length === 0) {
      return;
    }
    const gen = generation;
    const cfg = options.getConfig();
    const metrics = options.metrics;
    const spacingMode = resolveSpacingMode(cfg);
    const siteTable = options.getSiteLocaleTable?.() ?? null;
    const provider = options.getProvider(cfg);

    if (cfg.debugInspect && cfg.provider === "inspect") {
      for (const seg of segments) {
        const enc = encodeInlineNodes(seg.nodes, options.delta);
        const kind: InspectKind =
          seg.sourceRule === "+"
            ? "+"
            : siteTable && matchSiteTranslation(enc.payloadHtml, siteTable)
              ? "manual"
              : extractTemplate(enc.payloadHtml).kind === "dynamic"
                ? "auto-dynamic"
                : "auto-static";
        renderInspectMarker(seg, options.doc, { kind, spacingMode });
      }
      return;
    }

    const openccJobs: Array<{
      seg: TranslationSegment;
      encoded: EncodedInlineSegment;
      mode: Exclude<OpenCCMode, "off">;
    }> = [];
    const apiJobs: QueuedApiJob[] = [];
    const immediateHits: Array<{
      seg: TranslationSegment;
      encoded: EncodedInlineSegment;
      html: string;
      needsOpenCC: boolean;
    }> = [];

    const plainTexts = segments.map((s) =>
      s.nodes
        .map((n) => n.textContent ?? "")
        .join("")
        .trim()
    );
    const pageKeywords = extractPageKeywords(plainTexts);
    const keywords = [...(options.getGlossary?.() ?? []), ...pageKeywords];
    if (metrics) {
      metrics.keywordsSample = [...keywords];
    }

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const plain = plainTexts[i]!;
      const encoded = encodeInlineNodes(seg.nodes, options.delta);
      const manualHit = matchSiteTranslation(
        encoded.payloadHtml,
        siteTable,
        seg.container
      );

      if (cfg.debugInspect) {
        const kind: InspectKind =
          seg.sourceRule === "+"
            ? "+"
            : manualHit
              ? "manual"
              : extractTemplate(encoded.payloadHtml).kind === "dynamic"
                ? "auto-dynamic"
                : "auto-static";
        renderInspectMarker(seg, options.doc, { kind, spacingMode });
      }

      // Route purely by the segment's own text; page-level <html lang> or
      // ancestor [lang] attributes are intentionally ignored here.
      const route = routeSegment(plain, cfg.targetLang);

      if (metrics) {
        if (route.action === "skip") {
          metrics.routing.skip += 1;
        } else if (route.action === "opencc") {
          metrics.routing.opencc += 1;
        } else {
          metrics.routing.api += 1;
        }
      }

      if (route.action === "skip") {
        if (cfg.spaceSkippedCjk && spacingMode !== "off") {
          immediateHits.push({
            seg,
            encoded,
            html: encoded.payloadHtml,
            needsOpenCC: false,
          });
        }
        continue;
      }

      if (route.action === "opencc") {
        openccJobs.push({ seg, encoded, mode: route.mode });
        continue;
      }

      if (manualHit) {
        if (metrics) {
          metrics.segments.manual += 1;
          if (manualHit.scope) {
            metrics.segments.scopedHits += 1;
          }
        }
        immediateHits.push({
          seg,
          encoded,
          html: manualHit.html,
          needsOpenCC: false,
        });
        continue;
      }

      const maskedPayload =
        provider.id === "inspect"
          ? encoded.payloadHtml
          : maskKeywordsInHtml(encoded.payloadHtml, keywords);
      const cacheKey = `${cfg.targetLang}|${provider.id}|${maskedPayload}`;
      const cached = pageCache.get(cacheKey);
      if (cached !== undefined) {
        if (metrics) {
          metrics.cacheHits += 1;
        }
        immediateHits.push({
          seg,
          encoded,
          html: cached,
          needsOpenCC: cfg.openccMode !== "off",
        });
        continue;
      }

      apiJobs.push({ seg, encoded, maskedPayload, cacheKey });
      if (metrics) {
        metrics.cacheMisses += 1;
      }
    }

    const postBase = {
      spacingMode,
      punctNorm: cfg.punctNorm,
      debugSpacingMarks: cfg.debugSpacingMarks,
    };

    // Synchronously mark API jobs as pending before yielding to micro-batch coalescer.
    for (const job of apiJobs) {
      renderPending(job.seg, options.doc);
    }

    const needsImmediateOpenCC =
      cfg.openccMode !== "off" &&
      Boolean(options.getOpenCC) &&
      immediateHits.some((h) => h.needsOpenCC);
    const immediateConv = needsImmediateOpenCC
      ? await options.getOpenCC!(cfg.openccMode as Exclude<OpenCCMode, "off">)
      : undefined;
    if (gen !== generation) {
      return;
    }

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

    if (openccJobs.length > 0 && options.getOpenCC) {
      const modes = Array.from(new Set(openccJobs.map((j) => j.mode)));
      const convMap = new Map<Exclude<OpenCCMode, "off">, OpenCCConverter>();
      const openccInitStart = Date.now();
      await Promise.all(
        modes.map(async (m) => {
          convMap.set(m, await options.getOpenCC!(m));
        })
      );
      if (metrics) {
        metrics.openccInitMs = Date.now() - openccInitStart;
      }
      if (gen !== generation) {
        return;
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
    }

    if (apiJobs.length === 0) {
      return;
    }

    await enqueueApiJobs(apiJobs, gen, cfg);
  }

  return {
    translateBatch,
    cancelAll() {
      generation++;
      if (coalesceTimer !== null) {
        clearTimeout(coalesceTimer);
        coalesceTimer = null;
      }
      const cancelled = pendingQueue;
      pendingQueue = [];
      for (const entry of cancelled) {
        entry.resolve();
      }
    },
    clearCache() {
      pageCache.clear();
    },
  };
}
