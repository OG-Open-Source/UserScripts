export interface PtrMetrics {
  apiBatches: number;
  apiTotalJobs: number;
  apiUniquePayloads: number;
  cacheHits: number;
  cacheMisses: number;
  deltaCounts: { add: number; remove: number; mod: number };
  dictCounts: { static: number; dynamic: number; scoped: number };
  dictLoaded: boolean;
  excludedCount: number;
  initialScanMs: number | null;
  keywordsSample: string[];
  languageDetectorStatus: "available" | "unavailable";
  lastApiBatchMs: number;
  lastScanMs: number;
  mutationBatches: number;
  nodesVisited: number;
  openccInitMs: number | null;
  routing: { api: number; opencc: number; skip: number };
  segments: {
    total: number;
    autoStatic: number;
    autoDynamic: number;
    plus: number;
    manual: number;
    scopedHits: number;
  };
  shadowRootCount: number;
  totalApiBatchMs: number;
  totalMutationMs: number;
  viewportPending: number;
  viewportTriggered: number;
}

export interface PtrMetricsSnapshot extends PtrMetrics {
  avgApiBatchMs: number;
  avgMutationMs: number;
  cacheHitRatePct: number;
}

export function createPtrMetrics(): PtrMetrics {
  return {
    deltaCounts: { add: 0, remove: 0, mod: 0 },
    excludedCount: 0,
    shadowRootCount: 0,
    dictLoaded: false,
    dictCounts: { static: 0, dynamic: 0, scoped: 0 },
    segments: {
      total: 0,
      autoStatic: 0,
      autoDynamic: 0,
      plus: 0,
      manual: 0,
      scopedHits: 0,
    },
    routing: { api: 0, opencc: 0, skip: 0 },
    languageDetectorStatus: "unavailable",
    keywordsSample: [],
    initialScanMs: null,
    lastScanMs: 0,
    nodesVisited: 0,
    mutationBatches: 0,
    totalMutationMs: 0,
    viewportPending: 0,
    viewportTriggered: 0,
    cacheHits: 0,
    cacheMisses: 0,
    apiUniquePayloads: 0,
    apiTotalJobs: 0,
    openccInitMs: null,
    apiBatches: 0,
    lastApiBatchMs: 0,
    totalApiBatchMs: 0,
  };
}

export function recordScanTiming(
  metrics: PtrMetrics,
  ms: number,
  nodes: number
): void {
  if (metrics.initialScanMs === null) {
    metrics.initialScanMs = ms;
  }
  metrics.lastScanMs = ms;
  metrics.nodesVisited += nodes;
}

export function recordMutationBatch(metrics: PtrMetrics, ms: number): void {
  metrics.mutationBatches += 1;
  metrics.totalMutationMs += ms;
}

export function recordApiBatch(metrics: PtrMetrics, ms: number): void {
  metrics.apiBatches += 1;
  metrics.lastApiBatchMs = ms;
  metrics.totalApiBatchMs += ms;
}

export function getMetricsSnapshot(metrics: PtrMetrics): PtrMetricsSnapshot {
  const totalCache = metrics.cacheHits + metrics.cacheMisses;
  return {
    ...metrics,
    deltaCounts: { ...metrics.deltaCounts },
    dictCounts: { ...metrics.dictCounts },
    segments: { ...metrics.segments },
    routing: { ...metrics.routing },
    keywordsSample: [...metrics.keywordsSample],
    avgMutationMs:
      metrics.mutationBatches > 0
        ? metrics.totalMutationMs / metrics.mutationBatches
        : 0,
    avgApiBatchMs:
      metrics.apiBatches > 0 ? metrics.totalApiBatchMs / metrics.apiBatches : 0,
    cacheHitRatePct:
      totalCache > 0
        ? Math.round((metrics.cacheHits / totalCache) * 1000) / 10
        : 0,
  };
}
