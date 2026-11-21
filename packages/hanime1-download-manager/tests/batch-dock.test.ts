import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createBatch } from "../src/batch";
import { MESSAGES } from "../src/i18n";
import { buildStylesheetText, getBatchDockCss } from "../src/styles";

const BORDER_1PX_RE = /border:\s*1px/u;
const SCALE_FN_RE = /scale\(/u;
const noop = () => {
  // no-op in test
};

test("buildStylesheetText and getBatchDockCss emit borderless NovaKit oklch() tokens without 1px boxes or scale()", () => {
  const globalCss = buildStylesheetText(
    {
      panelBg: "rgb(40, 40, 40)",
      panelColor: "rgb(255, 255, 255)",
      itemHover: "rgba(255, 255, 255, 0.2)",
      actionBg: "rgb(30, 30, 30)",
    },
    "host"
  );
  const dockCss = getBatchDockCss();

  for (const css of [globalCss, dockCss]) {
    expect(css).toContain("oklch(");
    expect(css).toContain("--us-radius-lg: 12px");
    expect(css).not.toMatch(BORDER_1PX_RE);
    expect(css).not.toMatch(SCALE_FN_RE);
  }
});

test("slim Curved-Outside batch dock mounts with data-us-ui=h1dl, toggles flyout, and merges Select All/None", () => {
  const win = new Window();
  const prevDoc = (globalThis as Record<string, unknown>).document;
  const prevWin = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).document = win.document;
  (globalThis as Record<string, unknown>).window = win;

  try {
    win.document.body.innerHTML = `
      <div class="video-item-container"><div class="title">Ep 1</div></div>
      <div class="video-item-container"><div class="title">Ep 2</div></div>
    `;
    const cards = Array.from(
      win.document.querySelectorAll(".video-item-container")
    ) as unknown as HTMLElement[];

    const batch = createBatch(
      (k) => MESSAGES[k as keyof typeof MESSAGES] ?? k,
      () => Promise.resolve("1080p"),
      noop
    );

    const c1 = win.document.createElement("div");
    c1.innerHTML = '<i class="material-icons"></i>';
    const c2 = win.document.createElement("div");
    c2.innerHTML = '<i class="material-icons"></i>';
    const [card0, card1] = cards;
    expect(card0).toBeDefined();
    expect(card1).toBeDefined();
    if (!(card0 && card1)) {
      return;
    }
    const e1 = batch.addEntry(card0, "v1", c1 as unknown as HTMLElement);
    batch.addEntry(card1, "v2", c2 as unknown as HTMLElement);

    batch.setMode(true);
    const dock = batch.element();
    expect(dock).not.toBeNull();
    if (!dock) {
      return;
    }
    expect(dock.getAttribute("data-us-ui")).toBe("h1dl");
    expect(dock.getAttribute("translate")).toBe("no");

    const sr = dock.shadowRoot;
    expect(sr).not.toBeNull();
    if (!sr) {
      return;
    }
    const flyout = sr.querySelector("#h1dl-dock-flyout") as HTMLElement | null;
    expect(flyout?.dataset.open).toBe("false");

    const queueBtn = sr.querySelector("#h1dl-btn-queue") as HTMLElement | null;
    queueBtn?.click();
    expect(flyout?.dataset.open).toBe("true");
    queueBtn?.click();
    expect(flyout?.dataset.open).toBe("false");

    batch.setChecked(e1, true);
    expect(sr.querySelector("#h1dl-count")?.textContent).toBe("1");

    const selectAllBtn = sr.querySelector(
      "#h1dl-select-all"
    ) as HTMLElement | null;
    const selectNoneBtn = sr.querySelector(
      "#h1dl-select-none"
    ) as HTMLElement | null;
    expect(selectAllBtn).not.toBeNull();
    expect(selectNoneBtn).not.toBeNull();

    // With 1 of 2 checked, Select All must select the remaining item -> 2
    selectAllBtn?.click();
    expect(sr.querySelector("#h1dl-count")?.textContent).toBe("2");

    // Select None clears all and exits batch mode
    selectNoneBtn?.click();
    expect(batch.isOn()).toBe(false);
  } finally {
    (globalThis as Record<string, unknown>).document = prevDoc;
    (globalThis as Record<string, unknown>).window = prevWin;
  }
});
