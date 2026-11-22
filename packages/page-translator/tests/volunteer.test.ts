import { expect, test } from "bun:test";
import { configureGmApi } from "@userscripts/shared";
import { Window } from "happy-dom";
import type { SiteLocaleTable } from "../src/legacy/transform/template";
import { mergeLocaleTables } from "../src/legacy/translations-remote";
import { createVolunteerController } from "../src/legacy/volunteer";

function getShadowRoot(win: Window): ShadowRoot {
  const host = win.document.querySelector("[data-ptr-ui]");
  if (!host?.shadowRoot) {
    throw new Error("Expected [data-ptr-ui] host with shadowRoot");
  }
  return host.shadowRoot;
}

function noop(): void {
  // Intentional no-op callback for test fixtures
}

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
    setEnabled: noop,
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
      visibility: "visible",
    }),
  });

  vol.syncFromConfig();
  const sr = getShadowRoot(win);
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
    setEnabled: noop,
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
  const sr = getShadowRoot(win);
  (sr.querySelector("#ptr-v-suggest-scope") as HTMLElement).click();
  const scopeInput = sr.querySelector("#ptr-v-scope") as HTMLInputElement;
  expect(scopeInput.value).toBe('section[aria-label="Insights Nav"]');
  (sr.querySelector("#ptr-v-val") as HTMLInputElement).value = "脈動";
  (sr.querySelector("#ptr-v-save") as HTMLElement).click();
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
    setEnabled: noop,
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
      visibility: "visible",
    }),
  });

  vol.syncFromConfig();
  const sr = getShadowRoot(win);

  // 1. No in-popup close button (Monkey menu is single source of truth)
  expect(sr.querySelector("#ptr-v-close")).toBeNull();

  // 2. Dynamic / <x> entry is pre-filled with template key
  const input = sr.querySelector("#ptr-v-val") as HTMLInputElement;
  expect(input.value).toBe("Type {v0} to search");

  // 3. Before saving any translation, export JSON must be empty (no stale keys, no empty "" dumps)
  const emptyExport = JSON.parse(vol.getExportJson());
  expect(emptyExport.locales["zh-Hant-TW"].static).toEqual({});
  expect(emptyExport.locales["zh-Hant-TW"].dynamic).toEqual({});

  // 4. Edit & save the pre-filled dynamic entry -> ONLY that entry is exported
  input.value = "按 {v0} 搜尋";
  (sr.querySelector("#ptr-v-save") as HTMLElement).click();
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

  const link = win.document.querySelector("#nav-link") as HTMLAnchorElement;
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
  const sr = getShadowRoot(win);
  expect(sr.querySelector("#ptr-v-stat-hits")?.textContent).toBe("1");

  // Turn ON click lock inside panel
  const lockBtn = sr.querySelector("#ptr-v-block-clicks") as HTMLButtonElement;
  expect(lockBtn.getAttribute("aria-pressed")).toBe("false");
  lockBtn.click();
  expect(vol.isClickBlocked()).toBe(true);
  expect(lockBtn.getAttribute("aria-pressed")).toBe("true");
  expect(registered.get("ptr-volunteer-block-clicks")).toBe(
    "Volunteer Click Lock: ON"
  );

  // Clicking a page link while click-locked prevents navigation/page handler AND still selects the segment
  (sr.querySelector("#ptr-v-next") as HTMLElement).click();
  expect(sr.querySelector("#ptr-v-pos")?.textContent).toBe("#2/2");
  const evLocked = new win.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  link.dispatchEvent(evLocked);
  expect(evLocked.defaultPrevented).toBe(true);
  expect(pageLinkHandlerFired).toBe(1);
  expect(sr.querySelector("#ptr-v-pos")?.textContent).toBe("#1/2");

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
    setEnabled: noop,
    isClickBlocked: () => true,
    setClickBlocked: noop,
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
  const dlBtn = win.document.querySelector("#dl-now") as HTMLButtonElement;
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

test("importAiJson immediately syncs non-conflicting entries and getExportJson includes persisted local entries across controllers", () => {
  const win = new Window();
  win.document.body.innerHTML = `
    <div id="a">Settings</div>
    <div id="b">Stars 42</div>
  `;

  let localTable: SiteLocaleTable | null = null;
  const syncedPatches: SiteLocaleTable[] = [];
  let dictUpdatedCalls = 0;

  const vol = createVolunteerController({
    doc: win.document as unknown as Document,
    hostname: "github.com",
    getTargetLang: () => "zh-Hant-TW",
    getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
    getSiteLocaleTable: () => localTable,
    getLocalLocaleTable: () => localTable,
    onSyncLocalTable: (patch) => {
      syncedPatches.push(patch);
      localTable = mergeLocaleTables(localTable, patch);
    },
    onSiteDictUpdated: () => {
      dictUpdatedCalls += 1;
    },
    isEnabled: () => true,
    setEnabled: noop,
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
      visibility: "visible",
    }),
  });

  vol.syncFromConfig();
  const res = vol.importAiJson(
    JSON.stringify({
      translations: {
        Settings: "設定",
        "Stars {v0}": "星標 {v0}",
      },
    })
  );

  expect(res).toEqual({ synced: 2, conflicts: 0, applied: 2 });
  expect(syncedPatches).toEqual([
    {
      static: { Settings: "設定" },
      dynamic: { "Stars {v0}": "星標 {v0}" },
    },
  ]);
  expect(dictUpdatedCalls).toBe(1);
  expect(vol.getPendingConflicts()).toEqual([]);

  const exported1 = JSON.parse(vol.getExportJson());
  expect(exported1.locales["zh-Hant-TW"].static).toEqual({ Settings: "設定" });
  expect(exported1.locales["zh-Hant-TW"].dynamic).toEqual({
    "Stars {v0}": "星標 {v0}",
  });
  vol.stop();

  const vol2 = createVolunteerController({
    doc: win.document as unknown as Document,
    hostname: "github.com",
    getTargetLang: () => "zh-Hant-TW",
    getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
    getSiteLocaleTable: () => localTable,
    getLocalLocaleTable: () => localTable,
    isEnabled: () => true,
    setEnabled: noop,
  });
  const exported2 = JSON.parse(vol2.getExportJson());
  expect(exported2.locales["zh-Hant-TW"].static).toEqual({ Settings: "設定" });
  expect(exported2.locales["zh-Hant-TW"].dynamic).toEqual({
    "Stars {v0}": "星標 {v0}",
  });
  vol2.stop();
});

test("importAiJson separates conflicts from new entries and resolves them via inline conflict UI", () => {
  const win = new Window();
  win.document.body.innerHTML = `
    <nav aria-label="Repo"><div id="a">Insights</div></nav>
    <div id="b">Settings</div>
    <div id="c">Issues</div>
    <div id="d">Count 5</div>
  `;

  let siteTable: SiteLocaleTable = {
    static: {
      Settings: "設定（舊）",
      Issues: "議題",
    },
    dynamic: {
      "Count {v0}": "數量 {v0}",
    },
    scoped: {
      'nav[aria-label="Repo"]': {
        static: { Insights: "洞察（舊）" },
      },
    },
  };
  let localTable: SiteLocaleTable | null = null;
  const syncedPatches: SiteLocaleTable[] = [];
  let dictUpdatedCalls = 0;

  const vol = createVolunteerController({
    doc: win.document as unknown as Document,
    hostname: "github.com",
    getTargetLang: () => "zh-Hant-TW",
    getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
    getSiteLocaleTable: () => siteTable,
    getLocalLocaleTable: () => localTable,
    onSyncLocalTable: (patch) => {
      syncedPatches.push(patch);
      localTable = mergeLocaleTables(localTable, patch);
      siteTable = mergeLocaleTables(siteTable, patch) ?? {};
    },
    onSiteDictUpdated: () => {
      dictUpdatedCalls += 1;
    },
    isEnabled: () => true,
    setEnabled: noop,
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" || el.tagName === "NAV"
          ? "block"
          : "inline",
      visibility: "visible",
    }),
  });

  vol.syncFromConfig();
  const sr = getShadowRoot(win);
  const conflictBox = sr.querySelector("#ptr-v-conflicts") as HTMLElement;
  expect(conflictBox.hidden).toBe(true);

  const res = vol.importAiJson(
    JSON.stringify({
      version: 1,
      host: "github.com",
      locales: {
        "zh-Hant-TW": {
          static: {
            Settings: "設定（新）",
            Issues: "議題",
            Pulls: "拉取請求",
          },
          dynamic: {
            "Count {v0}": "總數 {v0}",
          },
          scoped: {
            'nav[aria-label="Repo"]': {
              static: { Insights: "分析（新）" },
            },
          },
        },
      },
    })
  );

  expect(res).toEqual({ synced: 1, conflicts: 3, applied: 1 });
  expect(syncedPatches).toEqual([{ static: { Pulls: "拉取請求" } }]);
  expect(dictUpdatedCalls).toBe(1);

  expect(vol.getPendingConflicts()).toHaveLength(3);
  expect(conflictBox.hidden).toBe(false);
  expect(conflictBox.textContent).toContain("設定（舊）");
  expect(conflictBox.textContent).toContain("設定（新）");

  const firstUseImported = conflictBox.querySelector(
    '[data-conflict-action="imported"]'
  ) as HTMLButtonElement;
  expect(firstUseImported).toBeTruthy();
  firstUseImported.click();
  expect(vol.getPendingConflicts()).toHaveLength(2);
  expect(syncedPatches).toHaveLength(2);
  expect(dictUpdatedCalls).toBe(2);
  expect(conflictBox.hidden).toBe(false);

  const nextKeepExisting = conflictBox.querySelector(
    '[data-conflict-action="existing"]'
  ) as HTMLButtonElement;
  expect(nextKeepExisting).toBeTruthy();
  nextKeepExisting.click();
  expect(vol.getPendingConflicts()).toHaveLength(1);
  expect(dictUpdatedCalls).toBe(3);

  const overwriteAllBtn = sr.querySelector(
    "#ptr-v-conflict-overwrite-all"
  ) as HTMLButtonElement;
  overwriteAllBtn.click();
  expect(vol.getPendingConflicts()).toHaveLength(0);
  expect(conflictBox.hidden).toBe(true);
  expect(syncedPatches).toHaveLength(3);
  expect(dictUpdatedCalls).toBe(4);

  vol.importAiJson(
    JSON.stringify({ translations: { Settings: "設定（第三次）" } })
  );
  expect(vol.getPendingConflicts()).toHaveLength(1);
  expect(conflictBox.hidden).toBe(false);
  const keepAllBtn = sr.querySelector(
    "#ptr-v-conflict-keep-all"
  ) as HTMLButtonElement;
  keepAllBtn.click();
  expect(vol.getPendingConflicts()).toHaveLength(0);
  expect(conflictBox.hidden).toBe(true);
  vol.stop();
});

test("single-item Save & Preview invokes onSyncLocalTable and onSiteDictUpdated", () => {
  const win = new Window();
  win.document.body.innerHTML = `<div id="a">Overview</div>`;

  const syncedPatches: SiteLocaleTable[] = [];
  let dictUpdatedCalls = 0;

  const vol = createVolunteerController({
    doc: win.document as unknown as Document,
    hostname: "github.com",
    getTargetLang: () => "zh-Hant-TW",
    getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
    getSiteLocaleTable: () => null,
    onSyncLocalTable: (patch) => {
      syncedPatches.push(patch);
    },
    onSiteDictUpdated: () => {
      dictUpdatedCalls += 1;
    },
    isEnabled: () => true,
    setEnabled: noop,
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
      visibility: "visible",
    }),
  });

  vol.syncFromConfig();
  const sr = getShadowRoot(win);
  (sr.querySelector("#ptr-v-val") as HTMLInputElement).value = "總覽";
  (sr.querySelector("#ptr-v-save") as HTMLButtonElement).click();

  expect(syncedPatches).toEqual([{ static: { Overview: "總覽" } }]);
  expect(dictUpdatedCalls).toBe(1);
  vol.stop();
});
