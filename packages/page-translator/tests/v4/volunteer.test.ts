import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { mergeLocaleTables } from "../../src/dict/store";
import type { SiteLocaleTable } from "../../src/dict/template";
import { DEFAULT_CONFIG } from "../../src/platform/config";
import { createPtrMetrics } from "../../src/platform/metrics";
import { resolveAdapter } from "../../src/structure/registry";
import { parseSiteDelta } from "../../src/structure/site-rules";
import { parseAiTranslationImport } from "../../src/ui/export-ai";
import {
  buildConflictResolutionPatch,
  buildDraftPatch,
  buildVolunteerExportJson,
  diffImportConflicts,
  resolveInitialEntryValue,
  scanVolunteerEntries,
  suggestEntryScope,
} from "../../src/ui/studio/volunteer/logic";
import { createStudioWorkspaceController } from "../../src/ui/studio/workspace";

function getShadowRoot(win: Window): ShadowRoot {
  const host = win.document.querySelector("#ptr-studio-shell");
  if (!host?.shadowRoot) {
    throw new Error("Expected #ptr-studio-shell shadowRoot");
  }
  return host.shadowRoot;
}

function mountStudioDictTab(
  win: Window,
  opts: {
    getDelta?: () => ReturnType<typeof parseSiteDelta>;
    getLocalLocaleTable?: () => SiteLocaleTable | null;
    getSiteLocaleTable?: () => SiteLocaleTable | null;
    getTargetLang?: () => string;
    onSiteDictUpdated?: () => void;
    onSyncLocalTable?: (patch: SiteLocaleTable) => void;
  } = {}
) {
  const doc = win.document as unknown as Document;
  const metrics = createPtrMetrics();
  const cfg = { ...DEFAULT_CONFIG, uiTier: "studio" as const };
  const studio = createStudioWorkspaceController({
    doc,
    getAdapter: () => resolveAdapter({ doc, host: "github.com" }),
    getConfig: () => cfg,
    getDelta: opts.getDelta ?? (() => parseSiteDelta("")),
    getHostRawDelta: () => "",
    getLocalLocaleTable: opts.getLocalLocaleTable ?? (() => null),
    getMetrics: () => metrics,
    getSiteLocaleTable: opts.getSiteLocaleTable ?? (() => null),
    getTargetLang: opts.getTargetLang ?? (() => "zh-Hant-TW"),
    hostname: "github.com",
    isTranslated: () => false,
    onExitStudio: () => undefined,
    onOpenSettings: () => undefined,
    onSaveHostDelta: () => undefined,
    onSiteDictUpdated: opts.onSiteDictUpdated,
    onSyncLocalTable: opts.onSyncLocalTable ?? (() => undefined),
    onToggleTranslate: () => undefined,
  });
  studio.syncFromConfig();
  const sr = getShadowRoot(win);
  (
    sr.querySelector('[data-studio-right-tab="dict"]') as HTMLButtonElement
  ).click();
  return { studio, sr };
}

test("Studio Dict panel escapes targetLang safely without HTML injection", () => {
  const win = new Window({ url: "https://github.com/" });
  win.document.body.innerHTML =
    '<div>Type <span class="key">/</span> to search</div>';

  const { studio, sr } = mountStudioDictTab(win, {
    getTargetLang: () => 'zh-TW"><img src=x onerror=alert(1)>',
  });

  expect(sr.querySelector("img")).toBeNull();
  studio.stop();
});

test("Studio Dict tab supports scoped CSS selector suggestion, single-item Save & Preview, and scoped-only JSON export", () => {
  const win = new Window({ url: "https://github.com/" });
  win.document.body.innerHTML = `<section aria-label="Insights Nav"><div id="i1">Pulse</div></section>`;

  let localTable: SiteLocaleTable | null = null;
  const syncedPatches: SiteLocaleTable[] = [];
  let dictUpdatedCalls = 0;

  const { studio, sr } = mountStudioDictTab(win, {
    getLocalLocaleTable: () => localTable,
    getSiteLocaleTable: () => localTable,
    onSyncLocalTable: (patch) => {
      syncedPatches.push(patch);
      localTable = mergeLocaleTables(localTable, patch);
    },
    onSiteDictUpdated: () => {
      dictUpdatedCalls += 1;
    },
  });

  const suggestBtn = sr.querySelector(
    '[data-studio-dict="suggest"]'
  ) as HTMLButtonElement;
  suggestBtn.click();

  const scopeInput = sr.querySelector(
    '[data-studio-dict="scope"]'
  ) as HTMLInputElement;
  const valInput = sr.querySelector(
    '[data-studio-dict="trans"]'
  ) as HTMLInputElement;
  expect(scopeInput.value).toBe('section[aria-label="Insights Nav"]');

  valInput.value = "脈動";
  const saveBtn = sr.querySelector(
    '[data-studio-dict="save"]'
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
  studio.stop();
});

test("Studio Dict tab pre-fills dynamic/{v0} input and exports ONLY translated drafts", () => {
  const win = new Window({ url: "https://github.com/" });
  win.document.body.innerHTML = `
    <div id="a">Type <span class="tok" style="display:inline">/</span> to search</div>
    <div id="b">Untranslated static line</div>
  `;

  let localTable: SiteLocaleTable | null = null;
  const { studio, sr } = mountStudioDictTab(win, {
    getDelta: () => parseSiteDelta("* .tok : inline-atomic"),
    getSiteLocaleTable: () => ({
      static: { "Old Stale Key": "舊資料" },
      dynamic: {},
    }),
    getLocalLocaleTable: () => localTable,
    onSyncLocalTable: (patch) => {
      localTable = mergeLocaleTables(localTable, patch);
    },
  });

  const valInput = sr.querySelector(
    '[data-studio-dict="trans"]'
  ) as HTMLInputElement;
  expect(valInput.value).toBe("Type {v0} to search");

  // Before saving, local export has no stale remote keys
  const emptyExport = JSON.parse(
    buildVolunteerExportJson("github.com", "zh-Hant-TW", localTable, null)
  );
  expect(emptyExport.locales["zh-Hant-TW"]).toEqual({});

  valInput.value = "按 {v0} 搜尋";
  const saveBtn = sr.querySelector(
    '[data-studio-dict="save"]'
  ) as HTMLButtonElement;
  saveBtn.click();

  const savedExport = JSON.parse(
    buildVolunteerExportJson("github.com", "zh-Hant-TW", localTable, null)
  );
  expect(savedExport.locales["zh-Hant-TW"].dynamic).toEqual({
    "Type {v0} to search": "按 {v0} 搜尋",
  });
  expect(savedExport.locales["zh-Hant-TW"].static).toBeUndefined();
  studio.stop();
});

test("volunteer/logic helpers compute scope, initial values, draft patches, and conflict resolution", () => {
  const win = new Window();
  win.document.body.innerHTML = `<section aria-label="Repo"><div id="a">Pulse</div><div id="b">Count 5</div></section>`;
  const scan = scanVolunteerEntries(
    win.document as unknown as Document,
    parseSiteDelta(""),
    null
  );
  expect(scan.entries).toHaveLength(2);
  const [first, second] = scan.entries;
  if (!(first && second)) {
    throw new Error("Expected 2 entries");
  }

  expect(suggestEntryScope(first)).toBe('section[aria-label="Repo"]');
  expect(resolveInitialEntryValue(first, "", null, null)).toBe("");
  expect(resolveInitialEntryValue(second, "", null, null)).toBe("Count {v0}");

  const patch = buildDraftPatch(first, "脈動", 'section[aria-label="Repo"]');
  expect(patch).toEqual({
    scoped: {
      'section[aria-label="Repo"]': { static: { Pulse: "脈動" } },
    },
  });

  const resolved = buildConflictResolutionPatch({
    id: "c1",
    scope: 'section[aria-label="Repo"]',
    bucket: "static",
    key: "Pulse",
    existing: "舊",
    imported: "新",
  });
  expect(resolved).toEqual({
    scoped: {
      'section[aria-label="Repo"]': { static: { Pulse: "新" } },
    },
  });
});

test("importAiJson separates conflicts from new entries and resolves them via Studio Dict conflict UI", () => {
  const win = new Window({ url: "https://github.com/" });
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

  const { studio, sr } = mountStudioDictTab(win, {
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
  });

  const importToggle = sr.querySelector(
    '[data-studio-dict="import-ai"]'
  ) as HTMLButtonElement;
  importToggle.click();

  const textarea = sr.querySelector(
    '[data-studio-dict="import-text"]'
  ) as HTMLTextAreaElement;
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
  const applyBtn = sr.querySelector(
    '[data-studio-dict="import-apply"]'
  ) as HTMLButtonElement;
  applyBtn.click();

  const conflictBox = sr.querySelector(
    '[data-studio-dict="conflicts"]'
  ) as HTMLElement;
  expect(conflictBox.classList.contains("ptr-studio-hidden")).toBe(false);
  expect(conflictBox.textContent).toContain("設定（舊）");
  expect(conflictBox.textContent).toContain("設定（新）");

  const firstOverwrite = conflictBox.querySelector(
    "[data-studio-conflict-overwrite]"
  ) as HTMLButtonElement;
  firstOverwrite.click();
  expect(
    conflictBox.querySelectorAll("[data-studio-conflict-overwrite]").length
  ).toBe(2);

  const firstKeep = conflictBox.querySelector(
    "[data-studio-conflict-keep]"
  ) as HTMLButtonElement;
  firstKeep.click();
  expect(
    conflictBox.querySelectorAll("[data-studio-conflict-overwrite]").length
  ).toBe(1);

  const overwriteAll = conflictBox.querySelector(
    "[data-studio-conflict-overwrite-all]"
  ) as HTMLButtonElement;
  overwriteAll.click();
  expect(conflictBox.classList.contains("ptr-studio-hidden")).toBe(true);
  expect(dictUpdatedCalls).toBeGreaterThanOrEqual(3);

  // Second import + Keep All
  textarea.value = JSON.stringify({
    translations: { Pulls: "提取請求（第三次）" },
  });
  applyBtn.click();
  expect(conflictBox.classList.contains("ptr-studio-hidden")).toBe(false);
  const keepAll = conflictBox.querySelector(
    "[data-studio-conflict-keep-all]"
  ) as HTMLButtonElement;
  keepAll.click();
  expect(conflictBox.classList.contains("ptr-studio-hidden")).toBe(true);
  studio.stop();
});

test("onSaveDraft displays volSavedScoped message when scope is non-empty", () => {
  const win = new Window({ url: "https://github.com/" });
  win.document.body.innerHTML = `<section aria-label="Insights Nav"><div id="i1">Pulse</div></section>`;

  const { studio, sr } = mountStudioDictTab(win);
  const scopeInput = sr.querySelector(
    '[data-studio-dict="scope"]'
  ) as HTMLInputElement;
  const valInput = sr.querySelector(
    '[data-studio-dict="trans"]'
  ) as HTMLInputElement;
  scopeInput.value = 'section[aria-label="Insights Nav"]';
  valInput.value = "脈動";

  const saveBtn = sr.querySelector(
    '[data-studio-dict="save"]'
  ) as HTMLButtonElement;
  saveBtn.click();

  const statusEl = sr.querySelector("[data-studio-status]") as HTMLElement;
  expect(statusEl.textContent).toContain(
    'Saved draft (scoped to section[aria-label="Insights Nav"]). Preview: 脈動'
  );
  studio.stop();
});

test("scanVolunteerEntries respects Discourse adapter captureScope and excludes header/footer chrome", () => {
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

  const scan = scanVolunteerEntries(
    win.document as unknown as Document,
    parseSiteDelta(""),
    null,
    discourseStyle
  );
  expect(scan.entries.map((e) => e.key)).toEqual(["Topic Body"]);
});
