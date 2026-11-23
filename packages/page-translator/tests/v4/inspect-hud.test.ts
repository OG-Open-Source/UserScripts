import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { collectSegments } from "../../src/capture/segmenter";
import { DEFAULT_CONFIG } from "../../src/platform/config";
import { createPtrMetrics } from "../../src/platform/metrics";
import { renderInspectMarker, restoreAll } from "../../src/render/renderer";
import { resolveAdapter } from "../../src/structure/registry";
import { parseSiteDelta } from "../../src/structure/site-rules";
import { buildAiTranslationExport } from "../../src/ui/export-ai";
import {
  buildInspectDiagnostics,
  scanInspectSegments,
} from "../../src/ui/studio/inspect/logic";
import { createStudioWorkspaceController } from "../../src/ui/studio/workspace";

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

test("Studio Workspace and buildInspectDiagnostics report telemetry, toggle bottom dock, and clean up on stop", () => {
  const win = new Window({ url: "https://example.com/" });
  win.document.body.innerHTML = `<nav aria-label="Repository"><div id="m1">Insights</div></nav><div id="d1">Updated 5 hours ago</div>`;
  const doc = win.document as unknown as Document;
  const metrics = createPtrMetrics();
  const delta = parseSiteDelta("");
  const cfg = {
    ...DEFAULT_CONFIG,
    uiTier: "studio" as const,
    targetLang: "zh-TW",
    spacingMode: "both" as const,
  };
  const siteTable = {
    scoped: {
      "nav[aria-label='Repository']": { static: { Insights: "洞察分析" } },
    },
  };
  const scan = scanInspectSegments(doc, delta, cfg, metrics, {
    getStyle,
    siteTable,
  });
  const diag = JSON.parse(
    buildInspectDiagnostics("fallback", scan, "https://example.com/")
  ) as {
    adapterId: string;
    counts: { manual: number; dynamic: number };
  };
  expect(diag.adapterId).toBe("fallback");
  expect(diag.counts.manual).toBe(1);
  expect(diag.counts.dynamic).toBe(1);

  const studio = createStudioWorkspaceController({
    doc,
    getAdapter: () => resolveAdapter({ doc, host: "example.com" }),
    getConfig: () => cfg,
    getDelta: () => delta,
    getHostRawDelta: () => "",
    getLocalLocaleTable: () => null,
    getMetrics: () => metrics,
    getSiteLocaleTable: () => siteTable,
    getTargetLang: () => cfg.targetLang,
    hostname: "example.com",
    isTranslated: () => false,
    onExitStudio: () => undefined,
    onOpenSettings: () => undefined,
    onSaveHostDelta: () => undefined,
    onSyncLocalTable: () => undefined,
    onToggleTranslate: () => undefined,
  });

  studio.syncFromConfig();
  const shellHost = win.document.querySelector("#ptr-studio-shell");
  if (!shellHost?.shadowRoot) {
    throw new Error("expected #ptr-studio-shell shadowRoot");
  }
  const sr = shellHost.shadowRoot;
  expect(shellHost.getAttribute("data-us-ui")).toBe("ptr");
  expect(sr.querySelector("[data-studio-adapter]")?.textContent).toContain(
    "fallback"
  );

  const shellEl = sr.querySelector(".ptr-studio-shell") as HTMLElement;
  const collapseBtn = sr.querySelector(
    '[data-studio-action="collapse-bottom"]'
  ) as HTMLButtonElement;
  expect(shellEl.getAttribute("data-bottom-collapsed")).toBe("0");
  collapseBtn.click();
  expect(shellEl.getAttribute("data-bottom-collapsed")).toBe("1");
  collapseBtn.click();
  expect(shellEl.getAttribute("data-bottom-collapsed")).toBe("0");

  studio.stop();
  expect(win.document.querySelector("#ptr-studio-shell")).toBeNull();
});

test("scanInspectSegments and buildAiTranslationExport respect Discourse adapter captureScope and exclude header/footer chrome", () => {
  const win = new Window();
  win.document.body.innerHTML = `
    <header class="d-header"><div id="hdr">Header Nav</div></header>
    <main id="main-outlet"><div id="topic">Topic Body</div></main>
    <footer><div id="ftr">Footer Link</div></footer>
  `;

  const discourseStyle = (el: Element) => ({
    display:
      el.tagName === "DIV" ||
      el.tagName === "BODY" ||
      el.tagName === "MAIN" ||
      el.tagName === "HEADER" ||
      el.tagName === "FOOTER"
        ? "block"
        : "inline",
    visibility: "visible",
  });

  const delta = parseSiteDelta("");
  const metrics = createPtrMetrics();
  const scan = scanInspectSegments(
    win.document as unknown as Document,
    delta,
    DEFAULT_CONFIG,
    metrics,
    { getStyle: discourseStyle }
  );
  expect(scan.adapterId).toBe("discourse");
  expect(scan.counts.total).toBe(1);
  expect(
    scan.hoverMap.has(win.document.querySelector("#topic") as Element)
  ).toBe(true);
  expect(scan.hoverMap.has(win.document.querySelector("#hdr") as Element)).toBe(
    false
  );
  expect(scan.hoverMap.has(win.document.querySelector("#ftr") as Element)).toBe(
    false
  );

  const exported = buildAiTranslationExport(
    win.document as unknown as Document,
    delta,
    {
      getStyle: discourseStyle,
      hostname: "meta.discourse.org",
      targetLang: "zh-TW",
    }
  );
  expect(exported.count).toBe(1);
  expect(exported.markdown).toContain("Topic Body");
  expect(exported.markdown).not.toContain("Header Nav");
  expect(exported.markdown).not.toContain("Footer Link");
});
