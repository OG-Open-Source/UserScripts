import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Window } from "happy-dom";
import { mergeLocaleTables } from "../../src/dict/store";
import type { SiteLocaleTable } from "../../src/dict/template";
import type { TranslatorConfig } from "../../src/platform/config";
import { DEFAULT_CONFIG } from "../../src/platform/config";
import { MESSAGES_EN } from "../../src/platform/i18n";
import { createPtrMetrics } from "../../src/platform/metrics";
import { resolveAdapter } from "../../src/structure/registry";
import { parseSiteDelta } from "../../src/structure/site-rules";
import { createBasicController } from "../../src/ui/basic";
import { createStudioWorkspaceController } from "../../src/ui/studio/workspace";
import { getSharedPanelCss } from "../../src/ui/theme";

function setup(url = "https://github.com/og-open-source/UserScripts") {
  const win = new Window({ url });
  win.document.body.innerHTML = "<main><p>Hello translator world.</p></main>";
  const doc = win.document as unknown as Document;
  const getStyle = (el: Element) => ({
    display:
      (el as HTMLElement).style.display ||
      (["BODY", "MAIN", "P"].includes(el.tagName) ? "block" : "inline"),
    fontFamily: "system-ui",
    visibility: "visible",
  });
  return { doc, getStyle };
}

function config(patch: Partial<TranslatorConfig> = {}): TranslatorConfig {
  return { ...DEFAULT_CONFIG, ...patch };
}

function commonStudioOptions(doc: Document, getConfig: () => TranslatorConfig) {
  const metrics = createPtrMetrics();
  return {
    doc,
    getAdapter: () => resolveAdapter({ doc, host: "github.com" }),
    getConfig,
    getDelta: () => parseSiteDelta(""),
    getHostRawDelta: () => "",
    getLocalLocaleTable: () => null,
    getMetrics: () => metrics,
    getSiteLocaleTable: () => null,
    getTargetLang: () => getConfig().targetLang,
    hostname: "github.com",
    isTranslated: () => false,
    onExitStudio: () => undefined,
    onOpenSettings: () => undefined,
    onSaveHostDelta: () => undefined,
    onSyncLocalTable: () => undefined,
    onToggleTranslate: () => undefined,
  };
}

test("Basic renders only minimalist pill controls and hides when Studio mounts", () => {
  const { doc } = setup();
  let cfg = config();
  let mounts = 0;
  let unmounts = 0;
  const controller = createBasicController({
    doc,
    getConfig: () => cfg,
    setUiTier: (uiTier) => {
      cfg = { ...cfg, uiTier };
    },
    onStudioMount: () => {
      mounts += 1;
    },
    onStudioUnmount: () => {
      unmounts += 1;
    },
  });

  controller.syncFromConfig();
  const host = doc.querySelector("#ptr-basic-ui") as HTMLElement;
  expect(host.getAttribute("data-us-ui")).toBe("ptr");
  expect(host.getAttribute("translate")).toBe("no");
  expect(host.hidden).toBe(false);
  expect(host.shadowRoot?.querySelectorAll("button").length).toBe(3);
  expect(
    host.shadowRoot?.querySelector("[data-basic-action='translate']")
  ).not.toBeNull();
  expect(
    host.shadowRoot?.querySelector("[data-basic-action='settings']")
  ).not.toBeNull();
  expect(host.shadowRoot?.querySelector("#ptr-basic-studio")).not.toBeNull();
  expect(host.shadowRoot?.querySelectorAll("[data-basic-field]").length).toBe(
    0
  );
  expect(doc.querySelector("#ptr-inspect-hud")).toBeNull();
  expect(doc.querySelector("#ptr-volunteer-workbench")).toBeNull();
  expect(mounts).toBe(0);

  const studioToggle = host.shadowRoot?.querySelector(
    "#ptr-basic-studio"
  ) as HTMLButtonElement;
  studioToggle.click();
  expect(cfg.uiTier).toBe("studio");
  expect(mounts).toBe(1);
  expect(host.hidden).toBe(true);
  expect(doc.querySelector("#ptr-basic-ui")).toBe(host);

  studioToggle.click();
  expect(cfg.uiTier).toBe("basic");
  expect(unmounts).toBe(1);
  expect(host.hidden).toBe(false);
  controller.stop();
});

test("Studio Workspace controller mounts #ptr-studio-shell only when uiTier is studio", () => {
  const { doc } = setup();
  let cfg = config();
  const studio = createStudioWorkspaceController(
    commonStudioOptions(doc, () => cfg)
  );

  studio.syncFromConfig();
  expect(doc.querySelector("#ptr-studio-shell")).toBeNull();
  expect(studio.isActive()).toBe(false);

  cfg = { ...cfg, uiTier: "studio" };
  studio.syncFromConfig();
  expect(doc.querySelector("#ptr-studio-shell")).not.toBeNull();
  expect(studio.isActive()).toBe(true);

  cfg = { ...cfg, uiTier: "basic" };
  studio.syncFromConfig();
  expect(doc.querySelector("#ptr-studio-shell")).toBeNull();
  expect(studio.isActive()).toBe(false);
  studio.stop();
});

test("Studio Workspace displays the detected adapter and diagnostics include adapterId", () => {
  const { doc } = setup();
  const cfg = config({ uiTier: "studio" });
  const studio = createStudioWorkspaceController(
    commonStudioOptions(doc, () => cfg)
  );
  studio.syncFromConfig();

  const host = doc.querySelector("#ptr-studio-shell") as HTMLElement;
  expect(host.getAttribute("data-us-ui")).toBe("ptr");
  expect(host.getAttribute("translate")).toBe("no");
  expect(
    host.shadowRoot?.querySelector("[data-studio-adapter]")?.textContent
  ).toContain("github");
  expect(host.getAttribute("data-theme-mode")).toBe("system");
  const diagnostics = JSON.parse(studio.getDiagnostics()) as {
    adapterId: string;
    detectedFramework: string;
  };
  expect(diagnostics.adapterId).toBe("github");
  expect(diagnostics.detectedFramework).toBe("github");
  studio.stop();
});

const ONE_PIXEL_BORDER_RE = /\bborder(?:-[a-z]+)?:\s*1px\b/iu;
const LEGACY_IMPORT_RE = /from\s+["'][^"']*legacy\//u;

test("panel CSS has no host override, one-pixel border, or scale transform", () => {
  const css = getSharedPanelCss();
  expect(css).not.toContain('data-theme-mode="host"');
  expect(css).not.toMatch(ONE_PIXEL_BORDER_RE);
  expect(css).not.toContain("scale(");
  expect(css).toContain("oklch(");
  expect(css).toContain("--us-radius-lg: 12px");
  expect(css).toContain("--us-radius-md: 8px");
  expect(css).toContain("--us-radius-sm: 6px");
});

test("settings exposes Studio, human-only, and new-tab defaults without retired controls", () => {
  const html = readFileSync(
    resolve(import.meta.dir, "../../../../settings/translate/index.html"),
    "utf8"
  );
  expect(html).not.toContain("spaceSkippedCjk");
  expect(html).not.toContain('value: "host"');
  expect(html).not.toContain("themeHost");
  expect(html).toContain('id="studioMode"');
  expect(html).toContain('value: "human-only"');
  expect(html).toContain('id="defaultInspect"');
  expect(html).toContain('id="defaultVolunteer"');
  expect(html).toContain('data-tier="studio"');
  expect(html).toContain("providerHumanOnly");
});

test("locale files translate every v4 message key", () => {
  const locales = JSON.parse(
    readFileSync(resolve(import.meta.dir, "../../locales.json"), "utf8")
  ) as {
    languages: Array<{ code: string; messages?: Record<string, string> }>;
  };
  const expectedKeys = Object.keys(MESSAGES_EN).sort((a, b) =>
    a.localeCompare(b)
  );
  for (const code of ["zh-Hant-TW", "zh-Hans-CN"]) {
    const language = locales.languages.find((entry) => entry.code === code);
    expect(
      Object.keys(language?.messages ?? {}).sort((a, b) => a.localeCompare(b))
    ).toEqual(expectedKeys);
    for (const value of Object.values(language?.messages ?? {})) {
      expect(value.trim().length).toBeGreaterThan(0);
    }
  }
});

test("v4 UI modules never import legacy source", async () => {
  const uiRoot = resolve(import.meta.dir, "../../src/ui");
  async function sourceFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          return sourceFiles(path);
        }
        return Promise.resolve(entry.name.endsWith(".ts") ? [path] : []);
      })
    );
    return nested.flat();
  }

  for (const file of await sourceFiles(uiRoot)) {
    expect(readFileSync(file, "utf8")).not.toMatch(LEGACY_IMPORT_RE);
  }
});

test("Studio Workspace Dict tab resets translation input on Next/Prev and restores saved entries", () => {
  const { doc } = setup();
  doc.body.innerHTML =
    "<main><p>First static line.</p><p>Second item 42 items</p><p>Third static line.</p></main>";
  const cfg = config({ uiTier: "studio" });
  let localTable: SiteLocaleTable | null = null;
  const studio = createStudioWorkspaceController({
    ...commonStudioOptions(doc, () => cfg),
    getLocalLocaleTable: () => localTable,
    getSiteLocaleTable: () => localTable,
    onSyncLocalTable: (patch) => {
      localTable = mergeLocaleTables(localTable ?? undefined, patch) ?? null;
    },
  });

  studio.syncFromConfig();
  const host = doc.querySelector("#ptr-studio-shell") as HTMLElement;
  const shadow = host.shadowRoot as ShadowRoot;
  const dictTabBtn = shadow.querySelector(
    '[data-studio-right-tab="dict"]'
  ) as HTMLButtonElement;
  dictTabBtn.click();

  const nextBtn = shadow.querySelector(
    '[data-studio-dict="next"]'
  ) as HTMLButtonElement;
  const prevBtn = shadow.querySelector(
    '[data-studio-dict="prev"]'
  ) as HTMLButtonElement;
  const saveBtn = shadow.querySelector(
    '[data-studio-dict="save"]'
  ) as HTMLButtonElement;
  const valInput = shadow.querySelector(
    '[data-studio-dict="trans"]'
  ) as HTMLInputElement;

  expect(valInput.value).toBe("");
  valInput.value = "Unsaved draft";
  nextBtn.click();
  expect(valInput.value).toBe("Second item {v0} items");

  nextBtn.click();
  expect(valInput.value).toBe("");

  prevBtn.click();
  prevBtn.click();
  expect(valInput.value).toBe("");

  valInput.value = "第一行譯文";
  saveBtn.click();
  nextBtn.click();
  expect(valInput.value).toBe("Second item {v0} items");
  prevBtn.click();
  expect(valInput.value).toBe("第一行譯文");

  studio.stop();
});

test("settings pages load external Simple.css before tokens.css, omit createCustomSelect, and have no inline styles", () => {
  const root = resolve(import.meta.dir, "../../../..");
  const pages = [
    { file: "index.html", tokensPath: "./settings/shared/tokens.css" },
    {
      file: "settings/language/index.html",
      tokensPath: "../shared/tokens.css",
    },
    {
      file: "settings/translate/index.html",
      tokensPath: "../shared/tokens.css",
    },
  ];
  const simpleCssUrl = "https://cdn.simplecss.org/simple.min.css";

  for (const { file, tokensPath } of pages) {
    const html = readFileSync(resolve(root, file), "utf8");
    const win = new Window({ url: "https://example.com/" });
    win.document.write(html);
    const links = Array.from(
      win.document.querySelectorAll('link[rel="stylesheet"]')
    ).map((el) => el.getAttribute("href"));

    const simpleIdx = links.indexOf(simpleCssUrl);
    const tokensIdx = links.indexOf(tokensPath);
    expect(simpleIdx).toBeGreaterThanOrEqual(0);
    expect(tokensIdx).toBeGreaterThan(simpleIdx);
    expect(win.document.querySelector("style")).toBeNull();
    expect(win.document.querySelector("[style]")).toBeNull();
    expect(html).not.toContain("createCustomSelect");
  }

  const bridgeJs = readFileSync(
    resolve(root, "settings/shared/bridge.js"),
    "utf8"
  );
  expect(bridgeJs).not.toContain("createCustomSelect");

  const langHtml = readFileSync(
    resolve(root, "settings/language/index.html"),
    "utf8"
  );
  const langWin = new Window({ url: "https://example.com/settings/language/" });
  langWin.document.write(langHtml);
  expect(langWin.document.querySelector("select#langSelect")).not.toBeNull();
});

test("settings/translate uses native selects and keeps Typography, CJK Spacing, and #apply outside studio tier", () => {
  const html = readFileSync(
    resolve(import.meta.dir, "../../../../settings/translate/index.html"),
    "utf8"
  );
  const win = new Window({ url: "https://example.com/settings/translate/" });
  win.document.write(html);
  const doc = win.document;

  for (const id of [
    "providerSelect",
    "themeSelect",
    "spacingSelect",
    "punctSelect",
    "openccSelect",
    "localFontSelect",
  ]) {
    expect(doc.querySelector(`select#${id}`)).not.toBeNull();
  }

  for (const id of [
    "customFont",
    "customCss",
    "spacingSelect",
    "punctSelect",
    "openccSelect",
    "apply",
    "note",
  ]) {
    const el = doc.querySelector(`#${id}`);
    expect(el).not.toBeNull();
    expect(el?.closest('[data-tier="studio"]')).toBeNull();
  }

  for (const id of [
    "defaultInspect",
    "defaultVolunteer",
    "siteDeltas",
    "dictBody",
  ]) {
    const el = doc.querySelector(`#${id}`);
    expect(el).not.toBeNull();
    const studioSection = el?.closest(
      '[data-tier="studio"]'
    ) as HTMLElement | null;
    expect(studioSection).not.toBeNull();
    expect(studioSection?.hasAttribute("hidden")).toBe(true);
  }
});

test("settings decouples volunteerBlockClicks from defaultVolunteer", () => {
  const html = readFileSync(
    resolve(import.meta.dir, "../../../../settings/translate/index.html"),
    "utf8"
  );
  expect(html).not.toContain("syncLockAvailability");
  expect(html).not.toContain("lockInput.disabled");
  expect(html).toContain("volunteerBlockClicks: lockInput.checked");
  expect(html).not.toContain(
    "volunteerBlockClicks: volInput.checked ? lockInput.checked : false"
  );
});
