import { expect, mock, test } from "bun:test";
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

test("getBatchDockCss uses variable-driven hover states on .co-group-btn and bounds queue item width", () => {
  const css = getBatchDockCss();
  const groupBtnSection = css.slice(css.indexOf(".co-group-btn {"));
  expect(groupBtnSection).toContain("--_btn-bg");
  expect(groupBtnSection).toContain("--_btn-hover-bg");
  expect(groupBtnSection).toContain("--_btn-hover-fg");
  expect(css).toContain("grid-template-columns: minmax(0, 1fr)");
  expect(css).toContain("min-width: 0");
  expect(css).toContain(".h1dl-pct");
});

test("buildStylesheetText uses --us-overlay-bg on .h1dl-check and positions .h1dl-card-capsule at bottom-right", () => {
  const css = buildStylesheetText(
    {
      panelBg: "rgb(40, 40, 40)",
      panelColor: "rgb(255, 255, 255)",
      itemHover: "rgba(255, 255, 255, 0.2)",
      actionBg: "rgb(30, 30, 30)",
    },
    "host"
  );
  const checkSection = css.slice(css.indexOf(".h1dl-check {"));
  expect(checkSection).toContain("var(--us-overlay-bg)");
  expect(checkSection).toContain("var(--us-overlay-hover)");
  expect(css).toContain(".h1dl-card-capsule");
  expect(css).toContain("bottom: 6px");
  expect(css).toContain("right: 6px");
});

test("createInject mounts bottom-right .h1dl-card-capsule on .video-meta-data cards and keeps standard placement otherwise", async () => {
  mock.module("$", () => ({ GM_download: noop }));
  const { createInject } = await import("../src/inject");
  const { createStateMachine } = await import("../src/download");

  const win = new Window();
  const prevDoc = (globalThis as Record<string, unknown>).document;
  const prevWin = (globalThis as Record<string, unknown>).window;
  const prevLoc = (globalThis as Record<string, unknown>).location;
  (globalThis as Record<string, unknown>).document = win.document;
  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).location = {
    pathname: "/playlists",
    href: "https://hanime1.me/playlists",
  };

  try {
    win.document.body.innerHTML = `
      <div class="video-item-container" id="playlist-card">
        <div class="playlist-hover-wrap">
          <a href="/watch?v=101"><img src="thumb1.jpg" /></a>
        </div>
        <div class="video-meta-data">meta</div>
      </div>
      <div class="video-item-container" id="search-card">
        <div class="video-thumb-wrap">
          <a href="/watch?v=202"><img src="thumb2.jpg" /></a>
        </div>
        <div class="subtitle">subtitle</div>
      </div>
    `;

    const t = (k: string) => MESSAGES[k as keyof typeof MESSAGES] ?? k;
    const batch = createBatch(t, () => Promise.resolve("1080p"), noop);
    const setState = createStateMachine(t);
    const menu = {
      askQuality: () => Promise.resolve("1080p"),
      close: noop,
      element: () => null,
      isOpen: () => false,
      open: noop,
    };
    const inject = createInject(t, menu, batch, setState);
    inject.scan();

    const playlistCard = win.document.querySelector("#playlist-card");
    expect(playlistCard).not.toBeNull();
    const capsule = playlistCard?.querySelector(".h1dl-card-capsule") ?? null;
    expect(capsule).not.toBeNull();
    expect(capsule?.getAttribute("data-us-ui")).toBe("h1dl");
    expect(capsule?.getAttribute("translate")).toBe("no");
    expect(capsule?.querySelector(".h1dl-check")).not.toBeNull();
    const iconBtn = capsule?.querySelector(".h1dl-list-btn.h1dl-icon-only");
    expect(iconBtn).not.toBeNull();
    expect(iconBtn?.querySelector(".h1dl-label")).toBeNull();
    expect(
      playlistCard?.querySelector(".h1dl-thumb-wrap .h1dl-check")
    ).toBeNull();

    const searchCard = win.document.querySelector("#search-card");
    expect(searchCard).not.toBeNull();
    expect(searchCard?.querySelector(".h1dl-card-capsule")).toBeNull();
    expect(
      searchCard?.querySelector(".h1dl-thumb-wrap .h1dl-check")
    ).not.toBeNull();
    expect(
      searchCard?.querySelector(".subtitle .h1dl-list-btn")
    ).not.toBeNull();
  } finally {
    (globalThis as Record<string, unknown>).document = prevDoc;
    (globalThis as Record<string, unknown>).window = prevWin;
    (globalThis as Record<string, unknown>).location = prevLoc;
  }
});

test("createStateMachine updates btn.title on icon-only buttons when .h1dl-label is absent", async () => {
  mock.module("$", () => ({ GM_download: noop }));
  const { createStateMachine } = await import("../src/download");

  const win = new Window();
  const btn = win.document.createElement("div") as unknown as HTMLElement;
  btn.className = "h1dl-list-btn h1dl-icon-only";
  btn.innerHTML = '<i class="material-icons h1dl-icon">download</i>';

  const t = (k: string) => MESSAGES[k as keyof typeof MESSAGES] ?? k;
  const setState = createStateMachine(t);

  setState(btn, "fetching");
  expect(btn.title).toBe(MESSAGES.fetching);

  setState(btn, "downloading", 42);
  expect(btn.title).toBe("42%");

  setState(btn, "done");
  expect(btn.title).toBe(MESSAGES.done);
});
