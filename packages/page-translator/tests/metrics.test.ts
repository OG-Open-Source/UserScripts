import { expect, test } from "bun:test";
import {
	createPtrMetrics,
	getMetricsSnapshot,
	recordApiBatch,
	recordMutationBatch,
	recordScanTiming,
} from "../src/metrics";
import { getSharedPanelCss } from "../src/ui-theme";

test("getSharedPanelCss exposes settings light/dark CSS tokens", () => {
	const css = getSharedPanelCss();
	expect(css).toContain("color-scheme: light dark");
	expect(css).toContain("--us-bg: #ffffff");
	expect(css).toContain("--us-fg: #141414");
	expect(css).toContain("--us-muted: #666666");
	expect(css).toContain("--us-line: #e4e4e4");
	expect(css).toContain("--us-surface:");
	expect(css).toContain("--us-mono:");
	expect(css).toContain("prefers-color-scheme: dark");
	expect(css).toContain("--us-bg: #141414");
	expect(css).toContain("--us-fg: #ededed");
	expect(css).toContain("--us-muted: #8e8e93");
	expect(css).toContain("--us-line: #2a2a2c");
	expect(css).toContain("1px solid var(--us-line)");
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
