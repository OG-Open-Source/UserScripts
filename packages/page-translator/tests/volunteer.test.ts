import { expect, test } from "bun:test";
import { configureGmApi } from "@userscripts/shared";
import { Window } from "happy-dom";
import { createVolunteerController } from "../src/volunteer";

test("volunteer panel renders atomic <x id='0'/> and escapes targetLang safely without HTML injection", () => {
  const win = new Window();
  win.document.body.innerHTML = "<div>Type <kbd>/</kbd> to search</div>";

  const vol = createVolunteerController({
    doc: win.document as unknown as Document,
    hostname: "github.com",
    getTargetLang: () => 'zh-TW"><img src=x onerror=alert(1)>',
    getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
    getSiteLocaleTable: () => null,
    isEnabled: () => true,
    setEnabled: () => {},
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
      visibility: "visible",
    }),
  });

  vol.syncFromConfig();
  const host = win.document.querySelector("[data-ptr-ui]")!;
  const sr = host.shadowRoot!;
  expect(sr.querySelector("img")).toBeNull();
  expect(sr.textContent).toContain('<x id="0"/>');
  vol.stop();
});

test("volunteer mode supports scoped CSS selector suggestion and scoped-only JSON export", () => {
  const win = new Window();
  win.document.body.innerHTML = `<section aria-label="Insights Nav"><div id="i1">Pulse</div></section>`;

  const vol = createVolunteerController({
    doc: win.document as unknown as Document,
    hostname: "github.com",
    getTargetLang: () => "zh-Hant-TW",
    getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
    getSiteLocaleTable: () => null,
    isEnabled: () => true,
    setEnabled: () => {},
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" ||
        el.tagName === "BODY" ||
        el.tagName === "SECTION"
          ? "block"
          : "inline",
      visibility: "visible",
    }),
  });

  vol.syncFromConfig();
  const sr = win.document.querySelector("[data-ptr-ui]")!.shadowRoot!;
  (sr.getElementById("ptr-v-suggest-scope") as HTMLElement).click();
  const scopeInput = sr.getElementById("ptr-v-scope") as HTMLInputElement;
  expect(scopeInput.value).toBe('section[aria-label="Insights Nav"]');
  (sr.getElementById("ptr-v-val") as HTMLInputElement).value = "脈動";
  (sr.getElementById("ptr-v-save") as HTMLElement).click();
  const exported = JSON.parse(vol.getExportJson());
  expect(exported.pathname).toBeUndefined();
  expect(
    exported.locales["zh-Hant-TW"].scoped['section[aria-label="Insights Nav"]']
      .static
  ).toEqual({ Pulse: "脈動" });
  vol.stop();
});

test("volunteer mode pre-fills dynamic/<x> input, removes close button, and exports ONLY translated drafts", () => {
  const win = new Window();
  win.document.body.innerHTML = `
    <div id="a">Type <kbd>/</kbd> to search</div>
    <div id="b">Untranslated static line</div>
  `;

  const vol = createVolunteerController({
    doc: win.document as unknown as Document,
    hostname: "github.com",
    pathname: "/Tufalabs/tufazip",
    getTargetLang: () => "zh-Hant-TW",
    getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
    getSiteLocaleTable: () => ({
      static: { "Old Stale Key": "舊資料" },
      dynamic: {},
    }),
    isEnabled: () => true,
    setEnabled: () => {},
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
      visibility: "visible",
    }),
  });

  vol.syncFromConfig();
  const sr = win.document.querySelector("[data-ptr-ui]")!.shadowRoot!;

  // 1. No in-popup close button (Monkey menu is single source of truth)
  expect(sr.getElementById("ptr-v-close")).toBeNull();

  // 2. Dynamic / <x> entry is pre-filled with template key
  const input = sr.getElementById("ptr-v-val") as HTMLInputElement;
  expect(input.value).toBe("Type {v0} to search");

  // 3. Before saving any translation, export JSON must be empty (no stale keys, no empty "" dumps)
  const emptyExport = JSON.parse(vol.getExportJson());
  expect(emptyExport.locales["zh-Hant-TW"].static).toEqual({});
  expect(emptyExport.locales["zh-Hant-TW"].dynamic).toEqual({});

  // 4. Edit & save the pre-filled dynamic entry -> ONLY that entry is exported
  input.value = "按 {v0} 搜尋";
  (sr.getElementById("ptr-v-save") as HTMLElement).click();
  const savedExport = JSON.parse(vol.getExportJson());
  expect(savedExport.locales["zh-Hant-TW"].dynamic).toEqual({
    "Type {v0} to search": "按 {v0} 搜尋",
  });
  expect(savedExport.locales["zh-Hant-TW"].static).toEqual({});

  vol.stop();
});

test("volunteer click-lock blocks page link/submit interaction only while volunteer mode is enabled", () => {
  const win = new Window();
  win.document.body.innerHTML = `
    <nav aria-label="Repo">
      <a id="nav-link" href="/owner/repo/insights">Insights</a>
    </nav>
    <div id="other">Repository overview</div>
  `;

  let enabled = false;
  let clickBlocked = false;
  const registered = new Map<string, string>();
  configureGmApi({
    GM_registerMenuCommand(
      caption: string,
      _onClick: () => void,
      opts?: { id?: string }
    ) {
      const id = opts?.id ?? caption;
      registered.set(id, caption);
      return id;
    },
    GM_unregisterMenuCommand(id: string | number) {
      registered.delete(String(id));
    },
  });

  const vol = createVolunteerController({
    doc: win.document as unknown as Document,
    hostname: "github.com",
    getTargetLang: () => "zh-Hant-TW",
    getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
    getSiteLocaleTable: () => ({
      scoped: {
        "nav[aria-label='Repo']": { static: { Insights: "洞察分析" } },
      },
    }),
    isEnabled: () => enabled,
    setEnabled: (next) => {
      enabled = next;
    },
    isClickBlocked: () => clickBlocked,
    setClickBlocked: (next) => {
      clickBlocked = next;
    },
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" ||
        el.tagName === "BODY" ||
        el.tagName === "NAV" ||
        el.tagName === "A"
          ? "block"
          : "inline",
      visibility: "visible",
    }),
  });

  vol.registerMenu();
  // Outside Volunteer Mode: click-lock menu item is not available and toggleClickBlock is ignored
  expect(registered.has("ptr-volunteer-block-clicks")).toBe(false);
  vol.toggleClickBlock();
  expect(vol.isClickBlocked()).toBe(false);

  const link = win.document.getElementById("nav-link") as HTMLAnchorElement;
  let pageLinkHandlerFired = 0;
  link.addEventListener("click", () => {
    pageLinkHandlerFired += 1;
  });

  // Normal click outside Volunteer Mode still reaches link
  const evOff = new win.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  link.dispatchEvent(evOff);
  expect(evOff.defaultPrevented).toBe(false);
  expect(pageLinkHandlerFired).toBe(1);

  // Enable Volunteer Mode -> scoped manual hit is counted, click-lock toggle & menu become available
  vol.toggle();
  expect(enabled).toBe(true);
  expect(registered.get("ptr-volunteer-block-clicks")).toBe(
    "Volunteer Click Lock: OFF"
  );
  const sr = win.document.querySelector("[data-ptr-ui]")!.shadowRoot!;
  expect(sr.getElementById("ptr-v-stat-hits")?.textContent).toBe("1");

  // Turn ON click lock inside panel
  const lockBtn = sr.getElementById("ptr-v-block-clicks") as HTMLButtonElement;
  expect(lockBtn.getAttribute("aria-pressed")).toBe("false");
  lockBtn.click();
  expect(vol.isClickBlocked()).toBe(true);
  expect(lockBtn.getAttribute("aria-pressed")).toBe("true");
  expect(registered.get("ptr-volunteer-block-clicks")).toBe(
    "Volunteer Click Lock: ON"
  );

  // Clicking a page link while click-locked prevents navigation/page handler AND still selects the segment
  (sr.getElementById("ptr-v-next") as HTMLElement).click();
  expect(sr.getElementById("ptr-v-pos")?.textContent).toBe("#2/2");
  const evLocked = new win.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  link.dispatchEvent(evLocked);
  expect(evLocked.defaultPrevented).toBe(true);
  expect(pageLinkHandlerFired).toBe(1);
  expect(sr.getElementById("ptr-v-pos")?.textContent).toBe("#1/2");

  // Turn OFF Volunteer Mode -> click lock resets, menu command disappears, normal clicks resume
  vol.toggle();
  expect(enabled).toBe(false);
  expect(clickBlocked).toBe(false);
  expect(registered.has("ptr-volunteer-block-clicks")).toBe(false);
  const evAfter = new win.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  link.dispatchEvent(evAfter);
  expect(evAfter.defaultPrevented).toBe(false);
  expect(pageLinkHandlerFired).toBe(2);

  vol.stop();
});

test("volunteer click-lock lets sibling [data-us-ui] userscript buttons work and supports AI export/import", () => {
  const win = new Window();
  win.document.body.innerHTML = `
    <div id="h1dl-btn" data-us-ui="h1dl" translate="no"><button id="dl-now" type="button">Download</button></div>
    <section aria-label="Repo"><h2>Stars</h2><div id="seg1">12 stars</div></section>
  `;
  const vol = createVolunteerController({
    doc: win.document as unknown as Document,
    hostname: "github.com",
    getTargetLang: () => "zh-Hant-TW",
    getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
    getSiteLocaleTable: () => null,
    isEnabled: () => true,
    setEnabled: () => {},
    isClickBlocked: () => true,
    setClickBlocked: () => {},
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" ||
        el.tagName === "BODY" ||
        el.tagName === "SECTION" ||
        el.tagName === "H2"
          ? "block"
          : "inline",
      visibility: "visible",
    }),
  });

  vol.syncFromConfig();
  const dlBtn = win.document.getElementById("dl-now") as HTMLButtonElement;
  const evSibling = new win.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  dlBtn.dispatchEvent(evSibling);
  expect(evSibling.defaultPrevented).toBe(false);

  const bundle = vol.exportForAi();
  expect(bundle.count).toBeGreaterThanOrEqual(1);
  expect(bundle.prompt).toContain("{v0} stars");

  const imported = vol.importAiJson(
    JSON.stringify({ translations: { "{v0} stars": "{v0} 顆星" } })
  );
  expect(imported.applied).toBe(1);
  const exported = JSON.parse(vol.getExportJson());
  expect(exported.locales["zh-Hant-TW"].dynamic["{v0} stars"]).toBe(
    "{v0} 顆星"
  );
  vol.stop();
});
