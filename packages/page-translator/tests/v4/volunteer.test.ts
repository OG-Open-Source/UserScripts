import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { mergeLocaleTables } from "../../src/dict/store";
import type { SiteLocaleTable } from "../../src/dict/template";
import { DEFAULT_CONFIG } from "../../src/platform/config";
import { parseAiTranslationImport } from "../../src/ui/export-ai";
import { createVolunteerController } from "../../src/ui/studio/volunteer";
import {
  buildVolunteerExportJson,
  diffImportConflicts,
} from "../../src/ui/studio/volunteer/logic";

function getShadowRoot(win: Window): ShadowRoot {
  const host = win.document.querySelector("#ptr-volunteer-workbench");
  if (!host?.shadowRoot) {
    throw new Error("Expected #ptr-volunteer-workbench shadowRoot");
  }
  return host.shadowRoot;
}

function getStyle(el: Element) {
  return {
    display:
      el.tagName === "DIV" ||
      el.tagName === "BODY" ||
      el.tagName === "SECTION" ||
      el.tagName === "NAV" ||
      el.tagName === "H2" ||
      el.tagName === "A"
        ? "block"
        : "inline",
    visibility: "visible",
  };
}

test("volunteer panel escapes targetLang safely without HTML injection and has no close button", () => {
  const win = new Window();
  win.document.body.innerHTML =
    '<div>Type <span class="key">/</span> to search</div>';

  const vol = createVolunteerController({
    doc: win.document as unknown as Document,
    hostname: "github.com",
    getConfig: () => ({
      ...DEFAULT_CONFIG,
      uiTier: "studio",
      defaultVolunteer: true,
    }),
    getTargetLang: () => 'zh-TW"><img src=x onerror=alert(1)>',
    getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
    getSiteLocaleTable: () => null,
    storage: null,
    getStyle,
  });

  vol.syncFromConfig();
  const sr = getShadowRoot(win);
  expect(sr.querySelector("img")).toBeNull();
  expect(sr.querySelector("#ptr-v-close")).toBeNull();
  vol.stop();
});

test("volunteer mode supports scoped CSS selector suggestion, single-item Save & Preview, and scoped-only JSON export", () => {
  const win = new Window();
  win.document.body.innerHTML = `<section aria-label="Insights Nav"><div id="i1">Pulse</div></section>`;

  let localTable: SiteLocaleTable | null = null;
  const syncedPatches: SiteLocaleTable[] = [];
  let dictUpdatedCalls = 0;

  const vol = createVolunteerController({
    doc: win.document as unknown as Document,
    hostname: "github.com",
    getConfig: () => ({
      ...DEFAULT_CONFIG,
      uiTier: "studio",
      defaultVolunteer: true,
    }),
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
    storage: null,
    getStyle,
  });

  vol.syncFromConfig();
  const sr = getShadowRoot(win);
  const suggestBtn = Array.from(sr.querySelectorAll("button")).find(
    (b) => b.textContent === "Suggest"
  ) as HTMLButtonElement;
  suggestBtn.click();

  const inputs = Array.from(sr.querySelectorAll("input"));
  const scopeInput = inputs[0] as HTMLInputElement;
  const valInput = inputs[1] as HTMLInputElement;
  expect(scopeInput.value).toBe('section[aria-label="Insights Nav"]');

  valInput.value = "脈動";
  const saveBtn = Array.from(sr.querySelectorAll("button")).find(
    (b) => b.textContent === "Save & Preview"
  ) as HTMLButtonElement;
  saveBtn.click();

  expect(syncedPatches).toEqual([
    {
      scoped: {
        'section[aria-label="Insights Nav"]': {
          static: { Pulse: "脈動" },
        },
      },
    },
  ]);
  expect(dictUpdatedCalls).toBe(1);

  const exported = JSON.parse(
    buildVolunteerExportJson("github.com", "zh-Hant-TW", localTable, null)
  );
  expect(exported.pathname).toBeUndefined();
  expect(
    exported.locales["zh-Hant-TW"].scoped['section[aria-label="Insights Nav"]']
      .static
  ).toEqual({ Pulse: "脈動" });
  vol.stop();
});

test("volunteer mode pre-fills dynamic/<x> input and exports ONLY translated drafts", () => {
  const win = new Window();
  win.document.body.innerHTML = `
    <div id="a">Type <span class="tok">/</span> to search</div>
    <div id="b">Untranslated static line</div>
  `;

  let localTable: SiteLocaleTable | null = null;
  const vol = createVolunteerController({
    doc: win.document as unknown as Document,
    hostname: "github.com",
    getConfig: () => ({
      ...DEFAULT_CONFIG,
      uiTier: "studio",
      defaultVolunteer: true,
    }),
    getTargetLang: () => "zh-Hant-TW",
    getDelta: () => parseDelta("* .tok : inline-atomic"),
    getSiteLocaleTable: () => ({
      static: { "Old Stale Key": "舊資料" },
      dynamic: {},
    }),
    getLocalLocaleTable: () => localTable,
    onSyncLocalTable: (patch) => {
      localTable = mergeLocaleTables(localTable, patch);
    },
    storage: null,
    getStyle,
  });

  vol.syncFromConfig();
  const sr = getShadowRoot(win);
  const inputs = Array.from(sr.querySelectorAll("input"));
  const valInput = inputs[1] as HTMLInputElement;
  expect(valInput.value).toBe("Type {v0} to search");

  // Before saving, local export has no stale remote keys
  const emptyExport = JSON.parse(
    buildVolunteerExportJson("github.com", "zh-Hant-TW", localTable, null)
  );
  expect(emptyExport.locales["zh-Hant-TW"]).toEqual({});

  valInput.value = "按 {v0} 搜尋";
  const saveBtn = Array.from(sr.querySelectorAll("button")).find(
    (b) => b.textContent === "Save & Preview"
  ) as HTMLButtonElement;
  saveBtn.click();

  const savedExport = JSON.parse(
    buildVolunteerExportJson("github.com", "zh-Hant-TW", localTable, null)
  );
  expect(savedExport.locales["zh-Hant-TW"].dynamic).toEqual({
    "Type {v0} to search": "按 {v0} 搜尋",
  });
  expect(savedExport.locales["zh-Hant-TW"].static).toBeUndefined();
  vol.stop();
});

function parseDelta(src: string) {
  const { parseSiteDelta } =
    require("../../src/structure/site-rules") as typeof import("../../src/structure/site-rules");
  return parseSiteDelta(src);
}

test("volunteer click-lock blocks page links while allowing sibling [data-us-ui] controls and resets on toggle off", () => {
  const win = new Window();
  win.document.body.innerHTML = `
    <div id="h1dl-btn" data-us-ui="h1dl" translate="no"><button id="dl-now" type="button">Download</button></div>
    <nav aria-label="Repo"><a id="nav-link" href="/owner/repo/insights">Insights</a></nav>
  `;

  let clickBlocked = false;
  const vol = createVolunteerController({
    doc: win.document as unknown as Document,
    hostname: "github.com",
    getConfig: () => ({
      ...DEFAULT_CONFIG,
      uiTier: "studio",
      defaultVolunteer: true,
    }),
    getTargetLang: () => "zh-Hant-TW",
    getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
    getSiteLocaleTable: () => null,
    isClickBlocked: () => clickBlocked,
    setClickBlocked: (next) => {
      clickBlocked = next;
    },
    storage: null,
    getStyle,
  });

  vol.syncFromConfig();
  const sr = getShadowRoot(win);
  const lockBtn = Array.from(sr.querySelectorAll("button")).find(
    (b) => b.textContent === "Lock: OFF"
  ) as HTMLButtonElement;
  expect(lockBtn.getAttribute("aria-pressed")).toBe("false");

  lockBtn.click();
  expect(clickBlocked).toBe(true);
  expect(lockBtn.getAttribute("aria-pressed")).toBe("true");

  const link = win.document.querySelector("#nav-link") as HTMLAnchorElement;
  const evLocked = new win.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  link.dispatchEvent(evLocked);
  expect(evLocked.defaultPrevented).toBe(true);

  const dlBtn = win.document.querySelector("#dl-now") as HTMLButtonElement;
  const evSibling = new win.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  dlBtn.dispatchEvent(evSibling);
  expect(evSibling.defaultPrevented).toBe(false);

  // Turning OFF Volunteer mode resets click lock and restores normal clicks
  vol.toggle();
  expect(clickBlocked).toBe(false);
  const evAfter = new win.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  link.dispatchEvent(evAfter);
  expect(evAfter.defaultPrevented).toBe(false);
  vol.stop();
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
    static: { Settings: "設定（舊）", Issues: "議題" },
    dynamic: { "Count {v0}": "數量 {v0}" },
    scoped: {
      'nav[aria-label="Repo"]': { static: { Insights: "洞察（舊）" } },
    },
  };
  let localTable: SiteLocaleTable | null = null;
  const syncedPatches: SiteLocaleTable[] = [];
  let dictUpdatedCalls = 0;

  const vol = createVolunteerController({
    doc: win.document as unknown as Document,
    hostname: "github.com",
    getConfig: () => ({
      ...DEFAULT_CONFIG,
      uiTier: "studio",
      defaultVolunteer: true,
    }),
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
    storage: null,
    getStyle,
  });

  vol.syncFromConfig();
  const sr = getShadowRoot(win);
  const importToggle = Array.from(sr.querySelectorAll("button")).find(
    (b) => b.textContent === "Import AI"
  ) as HTMLButtonElement;
  importToggle.click();

  const textarea = sr.querySelector("textarea") as HTMLTextAreaElement;
  const payload = JSON.stringify({
    version: 1,
    host: "github.com",
    locales: {
      "zh-Hant-TW": {
        static: {
          Settings: "設定（新）",
          Issues: "議題",
          Pulls: "拉取請求",
        },
        dynamic: { "Count {v0}": "總數 {v0}" },
        scoped: {
          'nav[aria-label="Repo"]': { static: { Insights: "分析（新）" } },
        },
      },
    },
  });

  const parsed = parseAiTranslationImport(payload, "zh-Hant-TW");
  const diff = diffImportConflicts(parsed, siteTable);
  expect(diff.conflicts).toHaveLength(3);
  expect(diff.patch).toEqual({
    static: { Issues: "議題", Pulls: "拉取請求" },
  });

  textarea.value = payload;
  const applyBtn = Array.from(sr.querySelectorAll("button")).find(
    (b) => b.textContent === "Apply Import"
  ) as HTMLButtonElement;
  applyBtn.click();

  const conflictBox = sr.querySelector(".ptr-vol-conflicts") as HTMLElement;
  expect(conflictBox.hidden).toBe(false);
  expect(conflictBox.textContent).toContain("設定（舊）");
  expect(conflictBox.textContent).toContain("設定（新）");

  const firstOverwrite = conflictBox.querySelector(
    '[data-conflict-action="imported"]'
  ) as HTMLButtonElement;
  firstOverwrite.click();
  expect(
    conflictBox.querySelectorAll('[data-conflict-action="imported"]').length
  ).toBe(2);

  const firstKeep = conflictBox.querySelector(
    '[data-conflict-action="existing"]'
  ) as HTMLButtonElement;
  firstKeep.click();
  expect(
    conflictBox.querySelectorAll('[data-conflict-action="imported"]').length
  ).toBe(1);

  const overwriteAll = conflictBox.querySelector(
    '[data-conflict-bulk="overwrite"]'
  ) as HTMLButtonElement;
  overwriteAll.click();
  expect(conflictBox.hidden).toBe(true);
  expect(dictUpdatedCalls).toBeGreaterThanOrEqual(3);

  // Second import + Keep All
  textarea.value = JSON.stringify({
    translations: { Pulls: "提取請求（第三次）" },
  });
  applyBtn.click();
  expect(conflictBox.hidden).toBe(false);
  const keepAll = conflictBox.querySelector(
    '[data-conflict-bulk="keep"]'
  ) as HTMLButtonElement;
  keepAll.click();
  expect(conflictBox.hidden).toBe(true);
  vol.stop();
});
