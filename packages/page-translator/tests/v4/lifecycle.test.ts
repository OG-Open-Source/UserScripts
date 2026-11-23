import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  createSpaRescanController,
  watchSpaNavigation,
} from "../../src/platform/lifecycle";
import type { SiteStructureAdapter } from "../../src/structure/adapter";

function requireElement(root: ParentNode, selector: string): Element {
  const element = root.querySelector(selector);
  if (!element) {
    throw new Error(`Missing fixture element: ${selector}`);
  }
  return element;
}

function createRegionAdapter(): SiteStructureAdapter {
  return {
    id: "region-test",
    detect: () => true,
    regions: (doc) => ({
      content: [requireElement(doc, "#content")],
      topbar: [requireElement(doc, "#topbar")],
    }),
    captureScope: (doc) => [requireElement(doc, "#content")],
    onSpaNavigate: (doc) => [requireElement(doc, "#content")],
    elementPolicy: () => "prose",
  };
}

function createGate() {
  let release: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release?.() };
}

test("rapid SPA navigations generation-cancel the first rescan and apply only the latest", async () => {
  const win = new Window({ url: "https://example.test/start" });
  win.document.body.innerHTML =
    '<header id="topbar">Chrome</header><main id="content">First</main>';
  const doc = win.document as unknown as Document;
  const gates = [createGate(), createGate()];
  const applied: number[] = [];
  const scannedRegions: string[][] = [];
  const controller = createSpaRescanController({
    adapter: createRegionAdapter(),
    rescan: async (regions, { generation }) => {
      scannedRegions.push(regions.map((region) => region.id));
      await gates[generation - 1]?.promise;
      return generation;
    },
    onApplied: (generation) => {
      applied.push(generation);
    },
  });

  const first = controller.onSpaNavigate(doc);
  requireElement(doc, "#content").textContent = "Second";
  const second = controller.onSpaNavigate(doc);
  expect(controller.generation).toBe(2);

  gates[1]?.release();
  expect(await second).toBe(true);
  gates[0]?.release();
  expect(await first).toBe(false);
  expect(applied).toEqual([2]);
  expect(scannedRegions).toEqual([["content"], ["content"]]);
});

test("SPA rescans receive only adapter navigation regions", async () => {
  const win = new Window({ url: "https://example.test/start" });
  win.document.body.innerHTML =
    '<header id="topbar">Chrome</header><main id="content">Content</main><footer id="footer">Footer</footer>';
  const doc = win.document as unknown as Document;
  const batches: string[][] = [];
  const controller = createSpaRescanController({
    adapter: createRegionAdapter(),
    rescan: (regions) => {
      batches.push(regions.map((region) => region.id));
    },
  });

  expect(await controller.onSpaNavigate(doc)).toBe(true);
  expect(batches).toEqual([["content"]]);
});

test("watchSpaNavigation handles history and Turbo SPA events", async () => {
  const win = new Window({ url: "https://example.test/start" });
  const events: string[] = [];
  const handle = watchSpaNavigation({
    win: win as unknown as Window,
    settleMs: 10,
    onBeforeLeave: () => events.push("before"),
    onSettled: () => events.push("settled"),
  });

  win.history.pushState({}, "", "/next");
  expect(events).toEqual(["before"]);
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(events).toEqual(["before", "settled"]);

  win.dispatchEvent(new win.Event("turbo:before-cache"));
  win.dispatchEvent(new win.Event("turbo:load"));
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(events).toEqual(["before", "settled", "before", "settled"]);
  handle.stop();
});

test("createSpaRescanController resolves live adapter via getAdapter() after async swap", async () => {
  const win = new Window({ url: "https://example.test/start" });
  win.document.body.innerHTML =
    '<main id="v1">Old</main><section id="v2">New</section>';
  const doc = win.document as unknown as Document;

  let activeAdapter: SiteStructureAdapter = {
    id: "v1",
    detect: () => true,
    regions: (d) => ({ content: [requireElement(d, "#v1")] }),
    captureScope: (d) => [requireElement(d, "#v1")],
    onSpaNavigate: (d) => [requireElement(d, "#v1")],
    elementPolicy: () => "prose",
  };

  const scannedIds: string[][] = [];
  const controller = createSpaRescanController({
    getAdapter: () => activeAdapter,
    rescan: (regions) => {
      scannedIds.push(regions.map((r) => r.id));
    },
  });

  await controller.onSpaNavigate(doc);
  expect(scannedIds).toEqual([["v1"]]);

  // Simulate async fingerprint SWR update swapping the adapter
  activeAdapter = {
    id: "v2",
    detect: () => true,
    regions: (d) => ({ content: [requireElement(d, "#v2")] }),
    captureScope: (d) => [requireElement(d, "#v2")],
    onSpaNavigate: (d) => [requireElement(d, "#v2")],
    elementPolicy: () => "prose",
  };

  await controller.onSpaNavigate(doc);
  expect(scannedIds).toEqual([["v1"], ["v2"]]);
});
