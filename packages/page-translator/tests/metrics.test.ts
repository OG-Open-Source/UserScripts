import { expect, test } from "bun:test";
import {
  createPtrMetrics,
  getMetricsSnapshot,
  recordApiBatch,
  recordMutationBatch,
  recordScanTiming,
} from "../src/legacy/metrics";
import { getSharedPanelCss } from "../src/legacy/ui-theme";

const BORDER_1PX_RE = /border:\s*1px/u;

test("getSharedPanelCss exposes borderless NovaKit light/dark CSS tokens", () => {
  const css = getSharedPanelCss();
  expect(css).toContain("color-scheme: light dark");
  expect(css).toContain("--us-bg: oklch(");
  expect(css).toContain("--us-fg: oklch(");
  expect(css).toContain("--us-muted: oklch(");
  expect(css).toContain("--us-surface:");
  expect(css).toContain("--us-mono:");
  expect(css).toContain("prefers-color-scheme: dark");
  expect(css).toContain("--us-radius-lg: 12px");
  expect(css).not.toMatch(BORDER_1PX_RE);
});

test("metrics store tracks scan/mutation timings and cache hit rate accurately", () => {
  const m = createPtrMetrics();
  recordScanTiming(m, 4.5, 120);
  recordScanTiming(m, 2.0, 40);
  recordMutationBatch(m, 1.5);
  recordMutationBatch(m, 2.5);
  m.cacheHits = 3;
  m.cacheMisses = 1;
  const snap = getMetricsSnapshot(m);
  expect(snap.initialScanMs).toBe(4.5);
  expect(snap.lastScanMs).toBe(2.0);
  expect(snap.nodesVisited).toBe(160);
  expect(snap.mutationBatches).toBe(2);
  expect(snap.avgMutationMs).toBe(2);
  expect(snap.cacheHitRatePct).toBe(75);
});

test("metrics store initializes defaults and tracks API batch averages safely", () => {
  const m = createPtrMetrics();
  const emptySnap = getMetricsSnapshot(m);
  expect(emptySnap.initialScanMs).toBeNull();
  expect(emptySnap.avgMutationMs).toBe(0);
  expect(emptySnap.avgApiBatchMs).toBe(0);
  expect(emptySnap.cacheHitRatePct).toBe(0);
  expect(emptySnap.languageDetectorStatus).toBe("unavailable");

  recordApiBatch(m, 12);
  recordApiBatch(m, 18);
  const snap = getMetricsSnapshot(m);
  expect(snap.apiBatches).toBe(2);
  expect(snap.lastApiBatchMs).toBe(18);
  expect(snap.totalApiBatchMs).toBe(30);
  expect(snap.avgApiBatchMs).toBe(15);
});
