import { expect, test } from "bun:test";
import { configureGmApi } from "@userscripts/shared";
import { Window } from "happy-dom";
import { createInspectController } from "../src/inspect";

test("auto-marks page on startup when debugInspect is already true across page loads", () => {
  const win = new Window();
  win.document.body.innerHTML =
    "<div>Paragraph one on new page.</div><div>Paragraph two.</div>";
  const controller = createInspectController({
    doc: win.document as unknown as Document,
    getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
    isEnabled: () => true,
    setEnabled: () => {},
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
      visibility: "visible",
    }),
  });

  controller.syncFromConfig();
  const marked = win.document.querySelectorAll("[data-tr-inspect]");
  expect(marked.length).toBe(2);
  controller.stop();
});

test("toggle flips debugInspect state, updates menu caption via id, and clears/restores markers", () => {
  const win = new Window();
  win.document.body.innerHTML = "<div>Hello world paragraph.</div>";

  let enabled = false;
  const registered: Array<{ caption: string; opts?: unknown }> = [];
  configureGmApi({
    GM_registerMenuCommand(
      caption: string,
      _onClick: () => void,
      opts?: unknown
    ) {
      registered.push({ caption, opts });
      return "ptr-inspect";
    },
    GM_unregisterMenuCommand() {},
  });

  const controller = createInspectController({
    doc: win.document as unknown as Document,
    getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
    isEnabled: () => enabled,
    setEnabled: (v) => {
      enabled = v;
    },
    formatLabel: (on) => `Capture Preview: ${on ? "ON" : "OFF"}`,
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
      visibility: "visible",
    }),
  });

  controller.registerMenu();
  expect(registered.at(-1)?.caption).toBe("Capture Preview: OFF");
  expect(win.document.querySelectorAll("[data-tr-inspect]").length).toBe(0);

  controller.toggle();
  expect(enabled).toBe(true);
  expect(registered.at(-1)?.caption).toBe("Capture Preview: ON");
  expect(win.document.querySelectorAll("[data-tr-inspect]").length).toBe(1);

  controller.toggle();
  expect(enabled).toBe(false);
  expect(registered.at(-1)?.caption).toBe("Capture Preview: OFF");
  expect(win.document.querySelectorAll("[data-tr-inspect]").length).toBe(0);
  controller.stop();
});

test("classifies inspect markers into auto-static, auto-dynamic, +, and manual kinds", () => {
  const win = new Window();
  win.document.body.innerHTML = `
    <div id="s1">Plain static heading</div>
    <div id="s2">Updated 5 hours ago</div>
    <div id="s3"><button class="num">42</button></div>
    <div id="s4">Pull requests</div>
  `;
  const controller = createInspectController({
    doc: win.document as unknown as Document,
    getDelta: () => ({
      addSelectors: ["button.num"],
      removeSelectors: [],
      modRules: [],
    }),
    isEnabled: () => true,
    setEnabled: () => {},
    getSiteLocaleTable: () => ({
      static: { "Pull requests": "拉取請求" },
      dynamic: {},
    }),
    getSpacingMode: () => "both",
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
      visibility: "visible",
    }),
  });

  controller.syncFromConfig();
  expect(
    win.document.getElementById("s1")?.getAttribute("data-tr-inspect-kind")
  ).toBe("auto-static");
  expect(
    win.document.getElementById("s2")?.getAttribute("data-tr-inspect-kind")
  ).toBe("auto-dynamic");
  expect(
    win.document
      .querySelector("button.num")
      ?.getAttribute("data-tr-inspect-kind")
  ).toBe("+");
  expect(
    win.document.getElementById("s4")?.getAttribute("data-tr-inspect-kind")
  ).toBe("manual");
  expect(
    win.document.getElementById("s1")?.getAttribute("data-tr-inspect-space")
  ).toBe("both");
  controller.stop();
});

test("inspect HUD displays capability and performance telemetry and toggles compact/detailed views", async () => {
  const { createPtrMetrics } = await import("../src/metrics");
  const win = new Window();
  win.document.body.innerHTML = `<nav aria-label="Repository"><div id="m1">Insights</div></nav><div id="d1">Updated 5 hours ago</div>`;
  const metrics = createPtrMetrics();
  metrics.cacheHits = 3;
  metrics.cacheMisses = 1;
  const controller = createInspectController({
    doc: win.document as unknown as Document,
    metrics,
    getTargetLang: () => "zh-TW",
    getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
    getSiteLocaleTable: () => ({
      scoped: {
        "nav[aria-label='Repository']": { static: { Insights: "洞察分析" } },
      },
    }),
    isEnabled: () => true,
    setEnabled: () => {},
    getSpacingMode: () => "both",
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" || el.tagName === "NAV"
          ? "block"
          : "inline",
      visibility: "visible",
    }),
  });
  controller.syncFromConfig();
  const sr = win.document.getElementById("ptr-inspect-hud")!.shadowRoot!;
  expect(sr.getElementById("ptr-h-copy")).not.toBeNull();
  expect(metrics.routing).toEqual({ api: 2, opencc: 0, skip: 0 });
  expect(sr.textContent).toContain("manual");
  expect(sr.textContent).toContain("`ms");
  expect(
    win.document.getElementById("ptr-inspect-hud")?.getAttribute("data-us-ui")
  ).toBe("ptr");
  // Details drawer starts collapsed to avoid DOM writes until expanded
  expect(sr.getElementById("ptr-h-details")?.dataset.collapsed).toBe("true");
  (sr.getElementById("ptr-h-toggle") as HTMLElement).click();
  expect(sr.getElementById("ptr-h-details")?.dataset.collapsed).toBe("false");
  expect(sr.getElementById("ptr-h-toggle")?.getAttribute("aria-expanded")).toBe(
    "true"
  );
  expect(sr.textContent).toContain("75");
  (sr.getElementById("ptr-h-toggle") as HTMLElement).click();
  expect(sr.getElementById("ptr-h-details")?.dataset.collapsed).toBe("true");
  controller.stop();
});

test("inspect mode renders floating legend/hover HUD and cleans up when toggled off", () => {
  const win = new Window();
  win.document.body.innerHTML = `<div id="d1">Updated 5 hours ago</div>`;
  const controller = createInspectController({
    doc: win.document as unknown as Document,
    getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
    isEnabled: () => true,
    setEnabled: () => {},
    getSpacingMode: () => "both",
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
      visibility: "visible",
    }),
  });

  controller.syncFromConfig();
  const hud = win.document.getElementById("ptr-inspect-hud");
  expect(hud).not.toBeNull();
  expect(hud?.hasAttribute("data-ptr-ui")).toBe(true);
  expect(hud?.shadowRoot?.textContent).toContain("both");

  const d1 = win.document.getElementById("d1")!;
  expect(d1.getAttribute("data-tr-inspect-label")).toContain("auto-dynamic");

  controller.stop();
  expect(win.document.getElementById("ptr-inspect-hud")).toBeNull();
});
