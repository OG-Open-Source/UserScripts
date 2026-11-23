import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { watchSpaNavigation } from "../../src/platform/lifecycle";

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
      navListeners.get(type)?.add(cb);
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

  for (const cb of navListeners.get("navigate") ?? []) {
    cb({
      canIntercept: true,
      navigationType: "push",
      destination: { url: "https://github.com/owner/repo/issues" },
    });
  }
  expect(events).toEqual(["before"]);
  await new Promise((r) => setTimeout(r, 35));
  expect(events).toEqual(["before"]);

  win.history.pushState({}, "", "/owner/repo/issues");
  await new Promise((r) => setTimeout(r, 35));
  expect(events).toContain("settled");

  handle.stop();
});
