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
import { parseSiteDelta } from "../../src/structure/site-rules";
import { createBasicController } from "../../src/ui/basic";
import { createInspectController } from "../../src/ui/studio/inspect";
import { createVolunteerController } from "../../src/ui/studio/volunteer";
import { getSharedPanelCss } from "../../src/ui/theme";

class MemoryTabStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

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

function commonStudioOptions(
  doc: Document,
  getStyle: (el: Element) => {
    display: string;
    fontFamily: string;
    visibility: string;
  },
  getConfig: () => TranslatorConfig
) {
  return {
    doc,
    getConfig,
    getDelta: () => parseSiteDelta(""),
    getStyle,
    storage: new MemoryTabStorage(),
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

test("Studio controllers gate Inspect and Volunteer on tier and tab activation", () => {
  const { doc, getStyle } = setup();
  let cfg = config({ defaultInspect: true, defaultVolunteer: true });
  const storage = new MemoryTabStorage();
  const inspect = createInspectController({
    ...commonStudioOptions(doc, getStyle, () => cfg),
    storage,
  });
  const volunteer = createVolunteerController({
    ...commonStudioOptions(doc, getStyle, () => cfg),
    storage,
    hostname: "github.com",
    getSiteLocaleTable: () => null,
    getTargetLang: () => cfg.targetLang,
  });

  inspect.syncFromConfig();
  volunteer.syncFromConfig();
  expect(doc.querySelector("#ptr-inspect-hud")).toBeNull();
  expect(doc.querySelector("#ptr-volunteer-workbench")).toBeNull();

  cfg = { ...cfg, uiTier: "studio" };
  inspect.syncFromConfig();
  volunteer.syncFromConfig();
  expect(doc.querySelector("#ptr-inspect-hud")).not.toBeNull();
  expect(doc.querySelector("#ptr-volunteer-workbench")).not.toBeNull();

  inspect.toggle();
  volunteer.toggle();
  expect(doc.querySelector("#ptr-inspect-hud")).toBeNull();
  expect(doc.querySelector("#ptr-volunteer-workbench")).toBeNull();
  inspect.stop();
  volunteer.stop();
});

test("Inspect HUD displays the detected adapter and diagnostics include adapterId", () => {
  const { doc, getStyle } = setup();
  const cfg = config({ uiTier: "studio", defaultInspect: true });
  const inspect = createInspectController(
    commonStudioOptions(doc, getStyle, () => cfg)
  );
  inspect.syncFromConfig();

  const host = doc.querySelector("#ptr-inspect-hud") as HTMLElement;
  expect(host.getAttribute("data-us-ui")).toBe("ptr");
  expect(host.getAttribute("translate")).toBe("no");
  expect(
    host.shadowRoot?.querySelector("#ptr-h-adapter")?.textContent
  ).toContain("github");
  expect(host.getAttribute("data-theme-mode")).toBe("system");
  const diagnostics = JSON.parse(inspect.getDiagnostics()) as {
    adapterId: string;
    detectedFramework: string;
  };
  expect(diagnostics.adapterId).toBe("github");
  expect(diagnostics.detectedFramework).toBe("github");
  inspect.stop();
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

test("Volunteer workbench resets translation input on Next/Prev and restores saved entries", () => {
  const { doc, getStyle } = setup();
  doc.body.innerHTML =
    "<main><p>First static line.</p><p>Second item 42 items</p><p>Third static line.</p></main>";
  const cfg = config({ uiTier: "studio", defaultVolunteer: true });
  let localTable: SiteLocaleTable | null = null;
  const volunteer = createVolunteerController({
    ...commonStudioOptions(doc, getStyle, () => cfg),
    hostname: "github.com",
    getLocalLocaleTable: () => localTable,
    getSiteLocaleTable: () => localTable,
    getTargetLang: () => cfg.targetLang,
    onSyncLocalTable: (patch) => {
      localTable = mergeLocaleTables(localTable ?? undefined, patch) ?? null;
    },
  });

  volunteer.syncFromConfig();
  const host = doc.querySelector("#ptr-volunteer-workbench") as HTMLElement;
  const shadow = host.shadowRoot as ShadowRoot;
  const buttons = Array.from(shadow.querySelectorAll("button"));
  const nextBtn = buttons.find(
    (btn) => btn.textContent === MESSAGES_EN.volNext
  ) as HTMLButtonElement;
  const prevBtn = buttons.find(
    (btn) => btn.textContent === MESSAGES_EN.volPrev
  ) as HTMLButtonElement;
  const saveBtn = buttons.find(
    (btn) => btn.textContent === MESSAGES_EN.volSave
  ) as HTMLButtonElement;
  const valInput = shadow.querySelector(
    ".ptr-vol-editor > input.ptr-input"
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

  volunteer.stop();
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
