import { isForeignUi } from "@userscripts/shared";
import type { TranslationSegment } from "../capture/segmenter";
import { collectSegments } from "../capture/segmenter";
import type { PtrMetrics } from "../metrics";
import { recordMutationBatch, recordScanTiming } from "../metrics";
import type { CompiledSiteDelta } from "../site-rules";

export interface ViewportObserverHandle {
  scan(target?: Element): void;
  stop(): void;
}

const OBSERVE_CONFIG: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: [
    "style",
    "class",
    "hidden",
    "open",
    "aria-hidden",
    "aria-expanded",
  ],
};

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function isTranslatorNode(node: Node): boolean {
  if (node.nodeType !== 1) {
    return false;
  }
  const el = node as Element;
  return (
    el.id === "ptr-user-css" ||
    el.id === "ptr-inspect-hud" ||
    el.hasAttribute("data-tr-block") ||
    el.hasAttribute("data-tr-orig") ||
    el.hasAttribute("data-tr-dst") ||
    el.closest?.("[data-tr-block]") !== null ||
    isForeignUi(el)
  );
}

export function createViewportObserver(options: {
  root: Element;
  delta: CompiledSiteDelta;
  onVisibleSegments: (segments: TranslationSegment[]) => void;
  onShadowRoots?: (roots: Set<ShadowRoot>) => void;
  metrics?: PtrMetrics;
  rootMargin?: string;
}): ViewportObserverHandle {
  const metrics = options.metrics;
  const seenContainers = new WeakSet<Element>();
  const observedRoots = new WeakSet<Node>();
  const pendingByContainer = new Map<Element, TranslationSegment[]>();
  let stopped = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingMutationRoots = new Set<Element>();

  const intersectionObserver =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          (entries) => {
            if (stopped) {
              return;
            }
            const ready: TranslationSegment[] = [];
            for (const entry of entries) {
              if (!entry.isIntersecting) {
                continue;
              }
              const segs = pendingByContainer.get(entry.target);
              if (segs) {
                ready.push(...segs);
                pendingByContainer.delete(entry.target);
              }
              intersectionObserver?.unobserve(entry.target);
            }
            if (ready.length > 0) {
              if (metrics) {
                metrics.viewportTriggered += ready.length;
                metrics.viewportPending = pendingByContainer.size;
              }
              options.onVisibleSegments(ready);
            }
          },
          { rootMargin: options.rootMargin ?? "300px 0px" }
        );

  const mutationObserver =
    typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver((records) => {
          if (stopped) {
            return;
          }
          for (const rec of records) {
            if (isTranslatorNode(rec.target)) {
              continue;
            }
            if (rec.type === "attributes" && rec.target.nodeType === 1) {
              pendingMutationRoots.add(rec.target as Element);
              continue;
            }
            if (rec.type === "childList") {
              for (const added of Array.from(rec.addedNodes)) {
                if (added.nodeType === 1 && !isTranslatorNode(added)) {
                  pendingMutationRoots.add(added as Element);
                } else if (added.nodeType === 3 && rec.target.nodeType === 1) {
                  pendingMutationRoots.add(rec.target as Element);
                }
              }
            }
          }
          if (pendingMutationRoots.size > 0 && flushTimer === null) {
            flushTimer = setTimeout(() => {
              flushTimer = null;
              const roots = Array.from(pendingMutationRoots);
              pendingMutationRoots.clear();
              // Coalesce: skip nodes whose ancestor is already queued in this batch
              const rootSet = new Set(roots);
              const scanStartedAt = nowMs();
              for (const r of roots) {
                if (!r.isConnected) {
                  continue;
                }
                let hasQueuedAncestor = false;
                let p = r.parentElement;
                while (p) {
                  if (rootSet.has(p)) {
                    hasQueuedAncestor = true;
                    break;
                  }
                  p = p.parentElement;
                }
                if (!hasQueuedAncestor) {
                  scan(r);
                }
              }
              if (metrics) {
                recordMutationBatch(metrics, nowMs() - scanStartedAt);
              }
            }, 120);
          }
        });

  function ensureObserved(node: Node): void {
    if (!mutationObserver || observedRoots.has(node)) {
      return;
    }
    observedRoots.add(node);
    mutationObserver.observe(node, OBSERVE_CONFIG);
  }

  function scan(target: Element = options.root): void {
    if (stopped || isTranslatorNode(target)) {
      return;
    }
    const shadowRoots = new Set<ShadowRoot>();
    const scanStartedAt = nowMs();
    const segs = collectSegments(target, options.delta, {
      shadowRoots,
      onExcluded: () => {
        if (metrics) {
          metrics.excludedCount += 1;
        }
      },
    });
    if (metrics) {
      recordScanTiming(
        metrics,
        nowMs() - scanStartedAt,
        segs.reduce((n, s) => n + s.nodes.length, 0)
      );
    }

    if (shadowRoots.size > 0) {
      if (metrics) {
        metrics.shadowRootCount += shadowRoots.size;
      }
      for (const sr of shadowRoots) {
        ensureObserved(sr);
      }
      options.onShadowRoots?.(shadowRoots);
    }

    if (segs.length === 0) {
      if (metrics) {
        metrics.viewportPending = pendingByContainer.size;
      }
      return;
    }

    const immediate: TranslationSegment[] = [];
    for (const seg of segs) {
      if (
        seenContainers.has(seg.container) &&
        seg.nodes.every(
          (n) =>
            n.parentNode &&
            (n.parentNode as Element).closest?.("[data-tr-block]") !== null
        )
      ) {
        continue;
      }
      seenContainers.add(seg.container);

      const isContents =
        seg.displayContents ??
        (typeof getComputedStyle === "function" &&
          getComputedStyle(seg.container).display === "contents");

      if (intersectionObserver && !isContents) {
        const list = pendingByContainer.get(seg.container);
        if (list) {
          list.push(seg);
        } else {
          pendingByContainer.set(seg.container, [seg]);
          intersectionObserver.observe(seg.container);
        }
      } else {
        immediate.push(seg);
      }
    }

    if (metrics) {
      metrics.viewportPending = pendingByContainer.size;
    }

    if (immediate.length > 0) {
      options.onVisibleSegments(immediate);
    }
  }

  ensureObserved(options.root);

  return {
    scan,
    stop() {
      stopped = true;
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      pendingMutationRoots.clear();
      pendingByContainer.clear();
      intersectionObserver?.disconnect();
      mutationObserver?.disconnect();
    },
  };
}
