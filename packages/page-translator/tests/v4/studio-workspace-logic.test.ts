import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type {
  CaptureCandidate,
  LiveCaptureCandidate,
} from "../../src/capture/export";
import {
  buildRawNodesExportJson,
  createStudioBreakpointGate,
  filterStudioCandidates,
  findCandidateIndexForElement,
} from "../../src/ui/studio/workspace/logic";
import {
  projectCandidateBoxes,
  renderOverlayBoxes,
} from "../../src/ui/studio/workspace/overlay";
import {
  buildStudioStageCss,
  computeStudioStageGeometry,
  mountStudioStage,
} from "../../src/ui/studio/workspace/stage";

function makeCandidate(
  overrides: Partial<CaptureCandidate> = {}
): CaptureCandidate {
  return {
    classification: "translate",
    computedStyleSummary: {
      display: "block",
      fontFamily: "sans-serif",
      visibility: "visible",
    },
    domPath: "html > body > main > p",
    excludeReason: null,
    included: true,
    region: "main",
    textPreview: "Sample text",
    ...overrides,
  };
}

function mockRect(
  el: Element,
  rect: { height: number; left: number; top: number; width: number }
): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      bottom: rect.top + rect.height,
      height: rect.height,
      left: rect.left,
      right: rect.left + rect.width,
      toJSON: () => rect,
      top: rect.top,
      width: rect.width,
      x: rect.left,
      y: rect.top,
    }) as DOMRect;
}

describe("studio stage geometry and mount", () => {
  test("computeStudioStageGeometry computes top-center stage rect, collapsed bottom, and zoom presets", () => {
    const fit = computeStudioStageGeometry(1440, 900, { zoom: "fit" });
    expect(fit.topHeight).toBe(40);
    expect(fit.leftWidth).toBe(300);
    expect(fit.rightWidth).toBe(340);
    expect(fit.bottomHeight).toBe(190);
    expect(fit.stageLeft).toBe(300);
    expect(fit.stageTop).toBe(40);
    expect(fit.stageWidth).toBe(800);
    expect(fit.stageHeight).toBe(670);
    expect(fit.scale).toBeGreaterThanOrEqual(0.35);
    expect(fit.scale).toBeLessThanOrEqual(0.92);

    const collapsed = computeStudioStageGeometry(1440, 900, {
      bottomCollapsed: true,
    });
    expect(collapsed.bottomHeight).toBe(36);
    expect(collapsed.stageHeight).toBe(824);

    expect(computeStudioStageGeometry(1440, 900, { zoom: "50" }).scale).toBe(
      0.5
    );
    expect(computeStudioStageGeometry(1440, 900, { zoom: "75" }).scale).toBe(
      0.75
    );
    expect(computeStudioStageGeometry(1440, 900, { zoom: "100" }).scale).toBe(
      1
    );
  });

  test("mountStudioStage sets attribute and style tag, and unmount removes both cleanly", () => {
    const win = new Window({ url: "https://example.com/" });
    const doc = win.document as unknown as Document;

    const handle = mountStudioStage(doc, { zoom: "75" });
    expect(doc.documentElement.getAttribute("data-ptr-studio-active")).toBe(
      "1"
    );
    const styleEl = doc.querySelector("#ptr-studio-stage-css");
    expect(styleEl).not.toBeNull();
    expect(styleEl?.textContent).toContain(
      'html[data-ptr-studio-active="1"] > body'
    );
    expect(styleEl?.textContent).toContain("transform: scale(0.75)");

    const css = buildStudioStageCss(handle.getGeometry());
    expect(css).toContain("position: fixed");
    expect(css).toContain("transform-origin: top left");
    expect(css).toContain("overflow: auto");

    const updated = handle.update({ bottomCollapsed: true, zoom: "50" });
    expect(updated.bottomHeight).toBe(36);
    expect(updated.scale).toBe(0.5);
    expect(doc.querySelector("#ptr-studio-stage-css")?.textContent).toContain(
      "transform: scale(0.5)"
    );

    handle.unmount();
    expect(
      doc.documentElement.getAttribute("data-ptr-studio-active")
    ).toBeNull();
    expect(doc.querySelector("#ptr-studio-stage-css")).toBeNull();
  });
});

describe("studio bounding-box overlay", () => {
  test("projectCandidateBoxes filters by boxMode, skips zero/out-of-stage rects, clamps overlaps, and retains selected/hovered", () => {
    const win = new Window({ url: "https://example.com/" });
    const doc = win.document as unknown as Document;
    doc.body.innerHTML = `
      <p id="in-1">Included 1</p>
      <p id="ex-1">Excluded 1</p>
      <p id="zero">Zero</p>
      <p id="outside">Outside</p>
      <p id="overlap">Overlap</p>
    `;
    const in1 = doc.querySelector("#in-1") as Element;
    const ex1 = doc.querySelector("#ex-1") as Element;
    const zero = doc.querySelector("#zero") as Element;
    const outside = doc.querySelector("#outside") as Element;
    const overlap = doc.querySelector("#overlap") as Element;

    mockRect(in1, { height: 24, left: 320, top: 60, width: 200 });
    mockRect(ex1, { height: 20, left: 340, top: 100, width: 180 });
    mockRect(zero, { height: 0, left: 350, top: 140, width: 100 });
    mockRect(outside, { height: 20, left: 10, top: 60, width: 100 });
    mockRect(overlap, { height: 40, left: 280, top: 20, width: 100 });

    const stage = computeStudioStageGeometry(1440, 900, { zoom: "fit" });
    const entries: LiveCaptureCandidate[] = [
      { candidate: makeCandidate({ included: true }), element: in1, index: 0 },
      {
        candidate: makeCandidate({ excludeReason: "hidden", included: false }),
        element: ex1,
        index: 1,
      },
      { candidate: makeCandidate({ included: true }), element: zero, index: 2 },
      {
        candidate: makeCandidate({ included: true }),
        element: outside,
        index: 3,
      },
      {
        candidate: makeCandidate({ included: true }),
        element: overlap,
        index: 4,
      },
    ];

    expect(
      projectCandidateBoxes(entries, stage, {
        boxMode: "off",
        hoveredIndex: null,
        selectedIndex: null,
      })
    ).toEqual([]);

    const includedOnly = projectCandidateBoxes(entries, stage, {
      boxMode: "included",
      hoveredIndex: 4,
      selectedIndex: 0,
    });
    expect(includedOnly.map((b) => b.index)).toEqual([0, 4]);
    expect(includedOnly[0]?.selected).toBe(true);
    expect(includedOnly[0]?.hovered).toBe(false);
    expect(includedOnly[1]?.hovered).toBe(true);
    expect(includedOnly[1]?.left).toBe(300);
    expect(includedOnly[1]?.top).toBe(40);
    expect(includedOnly[1]?.width).toBe(80);
    expect(includedOnly[1]?.height).toBe(20);

    const excludedOnly = projectCandidateBoxes(entries, stage, {
      boxMode: "excluded",
      hoveredIndex: null,
      selectedIndex: 1,
    });
    expect(excludedOnly.map((b) => b.index)).toEqual([1]);

    const capped = projectCandidateBoxes(entries, stage, {
      boxMode: "all",
      hoveredIndex: 4,
      maxBoxes: 2,
      selectedIndex: 1,
    });
    expect(capped).toHaveLength(2);
    expect(capped.map((b) => b.index)).toEqual([1, 4]);

    const layer = doc.createElement("div");
    renderOverlayBoxes(layer, doc, capped);
    expect(layer.children).toHaveLength(2);
    expect(layer.children[0]?.textContent).toContain("p");
  });
});

describe("studio pure workspace logic", () => {
  test("filterStudioCandidates filters by tab and case-insensitive query", () => {
    const win = new Window({ url: "https://example.com/" });
    const doc = win.document as unknown as Document;
    doc.body.innerHTML = `<p id="a">A</p><p id="b">B</p><p id="c">C</p>`;
    const elA = doc.querySelector("#a") as Element;
    const elB = doc.querySelector("#b") as Element;
    const elC = doc.querySelector("#c") as Element;

    const entries: LiveCaptureCandidate[] = [
      {
        candidate: makeCandidate({
          domPath: "html > body > p#a",
          included: true,
          region: "article",
          textPreview: "Hello Alpha",
        }),
        element: elA,
        index: 0,
      },
      {
        candidate: makeCandidate({
          domPath: "html > body > p#b",
          excludeReason: "mono",
          included: false,
          region: "code",
          textPreview: "const beta = 1",
        }),
        element: elB,
        index: 1,
      },
      {
        candidate: makeCandidate({
          domPath: "html > body > p#c",
          included: true,
          region: ["sidebar", "nav"],
          textPreview: "Gamma Manual",
        }),
        element: elC,
        index: 2,
      },
    ];

    expect(
      filterStudioCandidates(entries, { query: "", tab: "all" })
    ).toHaveLength(3);
    expect(
      filterStudioCandidates(entries, { query: "", tab: "captured" }).map(
        (e) => e.index
      )
    ).toEqual([0, 2]);
    expect(
      filterStudioCandidates(entries, { query: "", tab: "excluded" }).map(
        (e) => e.index
      )
    ).toEqual([1]);
    expect(
      filterStudioCandidates(entries, {
        manualElements: new Set([elC]),
        query: "",
        tab: "manual",
      }).map((e) => e.index)
    ).toEqual([2]);

    expect(
      filterStudioCandidates(entries, { query: "ALPHA", tab: "all" }).map(
        (e) => e.index
      )
    ).toEqual([0]);
    expect(
      filterStudioCandidates(entries, { query: "p#b", tab: "all" }).map(
        (e) => e.index
      )
    ).toEqual([1]);
    expect(
      filterStudioCandidates(entries, { query: "sidebar", tab: "all" }).map(
        (e) => e.index
      )
    ).toEqual([2]);
    expect(
      filterStudioCandidates(entries, { query: "MONO", tab: "all" }).map(
        (e) => e.index
      )
    ).toEqual([1]);
  });

  test("findCandidateIndexForElement walks up ancestors to nearest LiveCaptureCandidate", () => {
    const win = new Window({ url: "https://example.com/" });
    const doc = win.document as unknown as Document;
    doc.body.innerHTML = `<div id="outer"><p id="para"><span id="inner">Text</span></p></div><div id="unrelated">X</div>`;
    const outer = doc.querySelector("#outer") as Element;
    const para = doc.querySelector("#para") as Element;
    const inner = doc.querySelector("#inner") as Element;
    const unrelated = doc.querySelector("#unrelated") as Element;

    const entries: LiveCaptureCandidate[] = [
      { candidate: makeCandidate(), element: outer, index: 0 },
      { candidate: makeCandidate(), element: para, index: 1 },
    ];

    expect(findCandidateIndexForElement(entries, inner)).toBe(1);
    expect(findCandidateIndexForElement(entries, outer)).toBe(0);
    expect(findCandidateIndexForElement(entries, unrelated)).toBeNull();
    expect(findCandidateIndexForElement(entries, null)).toBeNull();
  });

  test("buildRawNodesExportJson emits valid JSON with host, url, adapterId, count, and candidates", () => {
    const candidates = [makeCandidate(), makeCandidate({ included: false })];
    const json = buildRawNodesExportJson({
      adapterId: "generic",
      candidates,
      host: "example.com",
      url: "https://example.com/page",
    });
    const parsed = JSON.parse(json) as {
      adapterId: string;
      candidates: CaptureCandidate[];
      count: number;
      host: string;
      url: string;
    };
    expect(parsed.host).toBe("example.com");
    expect(parsed.url).toBe("https://example.com/page");
    expect(parsed.adapterId).toBe("generic");
    expect(parsed.count).toBe(2);
    expect(parsed.candidates).toHaveLength(2);
  });

  test("createStudioBreakpointGate resolves immediately when unpaused, blocks when paused, and resolves cleanly on step/setPaused/releaseAll", async () => {
    const gate = createStudioBreakpointGate();
    let changes = 0;
    const unsub = gate.onStateChange(() => {
      changes += 1;
    });

    expect(gate.isPaused()).toBe(false);
    expect(gate.isWaiting()).toBe(false);
    await gate.waitIfPaused();

    gate.setPaused(true);
    expect(gate.isPaused()).toBe(true);

    let resolved1 = false;
    let resolved2 = false;
    const p1 = gate.waitIfPaused().then(() => {
      resolved1 = true;
    });
    const p2 = gate.waitIfPaused().then(() => {
      resolved2 = true;
    });

    expect(gate.isWaiting()).toBe(true);
    expect(resolved1).toBe(false);
    expect(resolved2).toBe(false);

    gate.step();
    await p1;
    expect(resolved1).toBe(true);
    expect(resolved2).toBe(false);
    expect(gate.isWaiting()).toBe(true);

    gate.releaseAll();
    await p2;
    expect(resolved2).toBe(true);
    expect(gate.isWaiting()).toBe(false);

    let resolved3 = false;
    const p3 = gate.waitIfPaused().then(() => {
      resolved3 = true;
    });
    expect(resolved3).toBe(false);
    gate.setPaused(false);
    await p3;
    expect(resolved3).toBe(true);
    expect(gate.isPaused()).toBe(false);
    expect(gate.isWaiting()).toBe(false);
    expect(changes).toBeGreaterThan(0);

    unsub();
  });
});
