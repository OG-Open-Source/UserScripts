import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Window } from "happy-dom";
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

test("Basic renders only basic controls and Studio mounts without reload", () => {
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
  expect(
    host.shadowRoot?.querySelector("[data-basic-action='translate']")
  ).not.toBeNull();
  expect(
    host.shadowRoot?.querySelector("[data-basic-field='targetLang']")
  ).not.toBeNull();
  expect(
    host.shadowRoot?.querySelector("[data-basic-field='presentation']")
  ).not.toBeNull();
  expect(
    host.shadowRoot?.querySelector("[data-basic-field='font']")
  ).not.toBeNull();
  expect(
    host.shadowRoot?.querySelector("[data-tier='studio-controls']")?.hidden
  ).toBe(true);
  expect(doc.querySelector("#ptr-inspect-hud")).toBeNull();
  expect(doc.querySelector("#ptr-volunteer-workbench")).toBeNull();
  expect(mounts).toBe(0);

  const studioToggle = host.shadowRoot?.querySelector(
    "#ptr-basic-studio"
  ) as HTMLButtonElement;
  studioToggle.click();
  expect(cfg.uiTier).toBe("studio");
  expect(mounts).toBe(1);
  expect(
    host.shadowRoot?.querySelector("[data-tier='studio-controls']")?.hidden
  ).toBe(false);
  expect(doc.querySelector("#ptr-basic-ui")).toBe(host);

  studioToggle.click();
  expect(cfg.uiTier).toBe("basic");
  expect(unmounts).toBe(1);
  expect(
    host.shadowRoot?.querySelector("[data-tier='studio-controls']")?.hidden
  ).toBe(true);
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
