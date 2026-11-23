import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { collectSegments } from "../../src/capture/segmenter";
import { DEFAULT_CONFIG } from "../../src/platform/config";
import { createPtrMetrics } from "../../src/platform/metrics";
import { renderInspectMarker, restoreAll } from "../../src/render/renderer";
import { parseSiteDelta } from "../../src/structure/site-rules";
import { createInspectController } from "../../src/ui/studio/inspect";
import { scanInspectSegments } from "../../src/ui/studio/inspect/logic";

function getStyle(el: Element) {
  return {
    display:
      el.tagName === "DIV" || el.tagName === "BODY" || el.tagName === "NAV"
        ? "block"
        : "inline",
    visibility: "visible",
  };
}

test("classifies inspect markers into auto-static, auto-dynamic, +, and manual kinds with spacingMode", () => {
  const win = new Window();
  win.document.body.innerHTML = `
    <div id="s1">Plain static heading</div>
    <div id="s2">Updated 5 hours ago</div>
    <div id="s3"><button class="num">42</button></div>
    <div id="s4">Pull requests</div>
  `;
  const delta = parseSiteDelta("+ button.num");
  const segs = collectSegments(win.document.body as unknown as Element, delta, {
    getStyle,
  });

  const metrics = createPtrMetrics();
  const scan = scanInspectSegments(
    win.document as unknown as Document,
    delta,
    { ...DEFAULT_CONFIG, spacingMode: "both" },
    metrics,
    {
      getStyle,
      siteTable: { static: { "Pull requests": "拉取請求" }, dynamic: {} },
    }
  );
  expect(scan.counts).toEqual({
    total: 4,
    static: 1,
    dynamic: 1,
    plus: 1,
    manual: 1,
  });

  const [seg1, seg2, seg3, seg4] = segs;
  if (!(seg1 && seg2 && seg3 && seg4)) {
    throw new Error("Expected 4 segments");
  }
  renderInspectMarker(seg1, win.document as unknown as Document, {
    kind: "auto-static",
    spacingMode: "both",
  });
  renderInspectMarker(seg2, win.document as unknown as Document, {
    kind: "auto-dynamic",
    spacingMode: "both",
  });
  renderInspectMarker(seg3, win.document as unknown as Document, {
    kind: "+",
    spacingMode: "both",
  });
  renderInspectMarker(seg4, win.document as unknown as Document, {
    kind: "manual",
    spacingMode: "both",
  });

  expect(
    win.document.querySelector("#s1")?.getAttribute("data-tr-inspect-kind")
  ).toBe("auto-static");
  expect(
    win.document.querySelector("#s2")?.getAttribute("data-tr-inspect-kind")
  ).toBe("auto-dynamic");
  expect(
    win.document
      .querySelector("button.num")
      ?.getAttribute("data-tr-inspect-kind")
  ).toBe("+");
  expect(
    win.document.querySelector("#s4")?.getAttribute("data-tr-inspect-kind")
  ).toBe("manual");
  expect(
    win.document.querySelector("#s1")?.getAttribute("data-tr-inspect-space")
  ).toBe("both");

  restoreAll(win.document.body as unknown as ParentNode);
  expect(win.document.querySelectorAll("[data-tr-inspect]").length).toBe(0);
});

test("Inspect HUD displays telemetry, toggles compact/detailed views, and cleans up on stop", () => {
  const win = new Window();
  win.document.body.innerHTML = `<nav aria-label="Repository"><div id="m1">Insights</div></nav><div id="d1">Updated 5 hours ago</div>`;
  const metrics = createPtrMetrics();
  const controller = createInspectController({
    doc: win.document as unknown as Document,
    getConfig: () => ({
      ...DEFAULT_CONFIG,
      uiTier: "studio",
      defaultInspect: true,
      targetLang: "zh-TW",
      spacingMode: "both",
    }),
    getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
    getMetrics: () => metrics,
    getSiteLocaleTable: () => ({
      scoped: {
        "nav[aria-label='Repository']": { static: { Insights: "洞察分析" } },
      },
    }),
    storage: null,
    getStyle,
  });

  controller.syncFromConfig();
  const hudEl = win.document.querySelector("#ptr-inspect-hud");
  if (!hudEl?.shadowRoot) {
    throw new Error("expected #ptr-inspect-hud shadowRoot");
  }
  const sr = hudEl.shadowRoot;
  expect(hudEl.getAttribute("data-us-ui")).toBe("ptr");
  expect(sr.querySelector("#ptr-h-adapter")?.textContent).toContain("fallback");
  expect(sr.querySelector("#ptr-h-manual")?.textContent).toBe("1");
  expect(sr.querySelector("#ptr-h-dynamic")?.textContent).toBe("1");

  const detailsBox = sr.querySelector(".ptr-hud-details") as HTMLElement;
  const detailsBtn = Array.from(sr.querySelectorAll("button")).find(
    (b) => b.textContent === "Details"
  ) as HTMLButtonElement;
  expect(detailsBox.hidden).toBe(true);
  expect(detailsBtn.getAttribute("aria-pressed")).toBe("false");

  detailsBtn.click();
  expect(detailsBox.hidden).toBe(false);
  expect(detailsBtn.getAttribute("aria-pressed")).toBe("true");
  expect(detailsBox.textContent).toContain("Segments");

  detailsBtn.click();
  expect(detailsBox.hidden).toBe(true);
  expect(detailsBtn.getAttribute("aria-pressed")).toBe("false");

  controller.stop();
  expect(win.document.querySelector("#ptr-inspect-hud")).toBeNull();
});
