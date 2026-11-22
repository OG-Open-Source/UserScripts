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
  m: PtrMetrics,
  ms: number,
  nodes: number
): void {
  if (m.initialScanMs === null) {
    m.initialScanMs = ms;
  }
  m.lastScanMs = ms;
  m.nodesVisited += nodes;
}

export function recordMutationBatch(m: PtrMetrics, ms: number): void {
  m.mutationBatches += 1;
  m.totalMutationMs += ms;
}

export function recordApiBatch(m: PtrMetrics, ms: number): void {
  m.apiBatches += 1;
  m.lastApiBatchMs = ms;
  m.totalApiBatchMs += ms;
}

export function getMetricsSnapshot(m: PtrMetrics): PtrMetricsSnapshot {
  const totalCache = m.cacheHits + m.cacheMisses;
  return {
    ...m,
    deltaCounts: { ...m.deltaCounts },
    dictCounts: { ...m.dictCounts },
    segments: { ...m.segments },
    routing: { ...m.routing },
    keywordsSample: [...m.keywordsSample],
    avgMutationMs:
      m.mutationBatches > 0 ? m.totalMutationMs / m.mutationBatches : 0,
    avgApiBatchMs: m.apiBatches > 0 ? m.totalApiBatchMs / m.apiBatches : 0,
    cacheHitRatePct:
      totalCache > 0 ? Math.round((m.cacheHits / totalCache) * 1000) / 10 : 0,
  };
}
