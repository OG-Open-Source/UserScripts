import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { watchSpaNavigation } from "../src/lifecycle";

test("watchSpaNavigation triggers onBeforeLeave synchronously on pushState and onSettled after debounce", async () => {
  const win = new Window({ url: "https://github.com/owner/repo" });
  const events: string[] = [];

  const handle = watchSpaNavigation({
    win: win as unknown as Window,
    settleMs: 25,
    onBeforeLeave: () => events.push("before"),
    onSettled: () => events.push("settled"),
  });

  win.history.pushState({}, "", "/owner/repo/pulls");
  expect(events).toEqual(["before"]);

  await new Promise((r) => setTimeout(r, 50));
  expect(events).toEqual(["before", "settled"]);

  // Replacing state with identical URL does not trigger spurious reset
  win.history.replaceState({}, "", "/owner/repo/pulls");
  await new Promise((r) => setTimeout(r, 40));
  expect(events).toEqual(["before", "settled"]);

  handle.stop();
});

test("async navigation.navigate waits for pushState/navigatesuccess without dropping real swap", async () => {
  const navListeners = new Map<string, Set<(e: unknown) => void>>();
  const win = new Window({ url: "https://github.com/owner/repo" });
  const winAny = win as unknown as Record<string, unknown>;
  winAny.navigation = {
    addEventListener(type: string, cb: (e: unknown) => void) {
      if (!navListeners.has(type)) {
        navListeners.set(type, new Set());
      }
      navListeners.get(type)!.add(cb);
    },
    removeEventListener(type: string, cb: (e: unknown) => void) {
      navListeners.get(type)?.delete(cb);
    },
  };

  const events: string[] = [];
  const handle = watchSpaNavigation({
    win: win as unknown as Window,
    settleMs: 20,
    onBeforeLeave: () => events.push("before"),
    onSettled: () => events.push("settled"),
  });

  // Turbo starts async fetch: `navigate` fires BEFORE URL/DOM swaps
  for (const cb of navListeners.get("navigate") ?? []) {
    cb({
      canIntercept: true,
      navigationType: "push",
      destination: { url: "https://github.com/owner/repo/issues" },
    });
  }
  expect(events).toEqual(["before"]);
  // Even after settleMs, onSettled must NOT have fired before URL changed!
  await new Promise((r) => setTimeout(r, 35));
  expect(events).toEqual(["before"]);

  // Real swap happens later via pushState -> triggers settled!
  win.history.pushState({}, "", "/owner/repo/issues");
  await new Promise((r) => setTimeout(r, 35));
  expect(events).toContain("settled");

  handle.stop();
});

test("A -> B -> A SPA navigation with turbo:before-cache and turbo:load always triggers before and settled", async () => {
  const win = new Window({ url: "https://github.com/Tufalabs/tufazip" });
  const events: string[] = [];
  const handle = watchSpaNavigation({
    win: win as unknown as Window,
    settleMs: 15,
    onBeforeLeave: () => events.push("before"),
    onSettled: () => events.push("settled"),
  });

  // A -> B
  win.history.pushState({}, "", "/Tufalabs/tufazip/insights");
  win.dispatchEvent(new win.Event("turbo:load"));
  await new Promise((r) => setTimeout(r, 30));

  // B -> A (turbo:before-cache before snapshot, then pushState/popstate, then turbo:load)
  win.dispatchEvent(new win.Event("turbo:before-cache"));
  win.history.pushState({}, "", "/Tufalabs/tufazip");
  win.dispatchEvent(new win.Event("turbo:load"));
  await new Promise((r) => setTimeout(r, 30));

  expect(events).toEqual(["before", "settled", "before", "settled"]);
  handle.stop();
});

test("turbo:frame-load triggers onSettled without breaking non-writable history methods", async () => {
  const win = new Window({ url: "https://github.com/owner/repo/insights" });
  Object.defineProperty(win.history, "pushState", {
    value: () => {},
    writable: false,
    configurable: true,
  });
  const events: string[] = [];
  const handle = watchSpaNavigation({
    win: win as unknown as Window,
    settleMs: 15,
    onBeforeLeave: () => events.push("before"),
    onSettled: () => events.push("settled"),
  });
  win.dispatchEvent(new win.Event("turbo:frame-load"));
  await new Promise((r) => setTimeout(r, 30));
  expect(events).toEqual(["settled"]);
  handle.stop();
});

test("observer ignores [data-ptr-ui] mutations and records scan metrics", async () => {
  const { createViewportObserver } = await import("../src/capture/observer");
  const { createPtrMetrics } = await import("../src/metrics");
  const { parseSiteDelta } = await import("../src/site-rules");
  const win = new Window();
  win.document.body.innerHTML = `<div id="main">Hello</div><div id="hud" data-ptr-ui="1">HUD</div>`;
  const metrics = createPtrMetrics();
  const seen: string[] = [];
  const obs = createViewportObserver({
    root: win.document.body as unknown as Element,
    delta: parseSiteDelta(""),
    metrics,
    onVisibleSegments: (segs) => seen.push(...segs.map((s) => s.container.id)),
  });
  obs.scan();
  win.document.getElementById("hud")!.textContent = "Updated HUD 12ms";
  await new Promise((r) => setTimeout(r, 150));
  expect(seen).toEqual(["main"]);
  expect(metrics.lastScanMs).toBeGreaterThanOrEqual(0);
  expect(metrics.mutationBatches).toBe(0);
  obs.stop();
});
