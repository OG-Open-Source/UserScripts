import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import locales from "../../locales.json" with { type: "json" };
import type { TranslatorConfig } from "../../src/platform/config";
import { DEFAULT_CONFIG } from "../../src/platform/config";
import type { PtrMessageKey } from "../../src/platform/i18n";
import { MESSAGES_EN } from "../../src/platform/i18n";
import { createBasicController } from "../../src/ui/basic";

const STUDIO_I18N_KEYS: readonly string[] = [
  "studioTitle",
  "studioExit",
  "studioZoomFit",
  "studioModeSelect",
  "studioModeInteract",
  "studioBoxesAll",
  "studioBoxesIncluded",
  "studioBoxesExcluded",
  "studioBoxesOff",
  "studioExportNodes",
  "studioCopyNodes",
  "studioTabAll",
  "studioTabCaptured",
  "studioTabExcluded",
  "studioTabManual",
  "studioSearchPlaceholder",
  "studioNoNodes",
  "studioInspectorNode",
  "studioInspectorDict",
  "studioSelectPrompt",
  "studioRuleSelector",
  "studioRuleAdd",
  "studioRuleRemove",
  "studioRuleMod",
  "studioRuleApply",
  "studioRuleApplied",
  "studioSiteDeltas",
  "studioBottomDiag",
  "studioBottomRecord",
  "studioCollapse",
  "studioExpand",
  "studioRecordStart",
  "studioRecordStop",
  "studioRecordClear",
  "studioRecordEmpty",
  "studioBpPauseApi",
  "studioBpResume",
  "studioBpWaiting",
  "studioCopiedNodes",
  "studioDownloadedNodes",
  "basicOpenSettings",
];

const BASIC_HARDCODED_RE =
  /["']Translate Page["']|["']Restore Original["']|["']Open Settings["']|["']Studio Mode["']/u;

function setupDoc(): Document {
  const win = new Window({ url: "https://example.com/" });
  win.document.body.innerHTML = "<main><p>Hello world.</p></main>";
  return win.document as unknown as Document;
}

function makeConfig(patch: Partial<TranslatorConfig> = {}): TranslatorConfig {
  return { ...DEFAULT_CONFIG, ...patch };
}

test("Basic UI mounts minimalist 3-button pill with no [data-basic-field] inputs", () => {
  const doc = setupDoc();
  let cfg = makeConfig();
  const controller = createBasicController({
    doc,
    getConfig: () => cfg,
    setUiTier: (uiTier) => {
      cfg = { ...cfg, uiTier };
    },
  });

  controller.syncFromConfig();

  const host = doc.querySelector("#ptr-basic-ui") as HTMLElement;
  expect(host).not.toBeNull();
  expect(host.getAttribute("data-us-ui")).toBe("ptr");
  expect(host.getAttribute("translate")).toBe("no");
  expect(host.hidden).toBe(false);

  const shadow = host.shadowRoot as ShadowRoot;
  expect(shadow.querySelectorAll("button").length).toBe(3);
  expect(
    shadow.querySelector("[data-basic-action='translate']")
  ).not.toBeNull();
  expect(shadow.querySelector("[data-basic-action='settings']")).not.toBeNull();
  expect(shadow.querySelector("#ptr-basic-studio")).not.toBeNull();
  expect(shadow.querySelectorAll("[data-basic-field]").length).toBe(0);

  controller.stop();
  expect(doc.querySelector("#ptr-basic-ui")).toBeNull();
});

test("Basic pill actions fire callbacks and hide pill when uiTier is studio", () => {
  const doc = setupDoc();
  let cfg = makeConfig();
  let translates = 0;
  let settingsOpened = 0;
  let mounts = 0;
  let unmounts = 0;

  const controller = createBasicController({
    doc,
    getConfig: () => cfg,
    setUiTier: (uiTier) => {
      cfg = { ...cfg, uiTier };
    },
    onToggleTranslate: () => {
      translates += 1;
    },
    onOpenSettings: () => {
      settingsOpened += 1;
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
  const shadow = host.shadowRoot as ShadowRoot;

  const translateBtn = shadow.querySelector(
    "[data-basic-action='translate']"
  ) as HTMLButtonElement;
  const settingsBtn = shadow.querySelector(
    "[data-basic-action='settings']"
  ) as HTMLButtonElement;
  const studioBtn = shadow.querySelector(
    "#ptr-basic-studio"
  ) as HTMLButtonElement;

  translateBtn.click();
  expect(translates).toBe(1);

  settingsBtn.click();
  expect(settingsOpened).toBe(1);

  studioBtn.click();
  expect(cfg.uiTier).toBe("studio");
  expect(mounts).toBe(1);
  expect(host.hidden).toBe(true);

  cfg = { ...cfg, uiTier: "basic" };
  controller.syncFromConfig();
  expect(unmounts).toBe(1);
  expect(host.hidden).toBe(false);

  controller.stop();
});

test("MESSAGES_EN and locales.json include all Studio Workspace keys with exact parity", () => {
  const expectedKeys = Object.keys(MESSAGES_EN).sort((a, b) =>
    a.localeCompare(b)
  );
  for (const key of STUDIO_I18N_KEYS) {
    expect(expectedKeys).toContain(key);
  }

  for (const code of ["zh-Hant-TW", "zh-Hans-CN"]) {
    const entry = locales.languages.find((l) => l.code === code) as
      | { code: string; messages?: Record<string, string> }
      | undefined;
    expect(entry).toBeDefined();
    const messages = entry?.messages ?? {};
    expect(Object.keys(messages).sort((a, b) => a.localeCompare(b))).toEqual(
      expectedKeys
    );
    for (const value of Object.values(messages)) {
      expect(value.trim().length).toBeGreaterThan(0);
    }
  }
});

test("Basic view uses injected t() labels with no hardcoded English strings", () => {
  const viewSrc = readFileSync(
    resolve(import.meta.dir, "../../src/ui/basic/view.ts"),
    "utf8"
  );
  expect(viewSrc).not.toMatch(BASIC_HARDCODED_RE);

  const doc = setupDoc();
  const cfg = makeConfig();
  const controller = createBasicController({
    doc,
    getConfig: () => cfg,
    setUiTier: () => undefined,
    t: (key: PtrMessageKey) => `i18n:${key}`,
  });

  controller.syncFromConfig();
  const shadow = doc.querySelector("#ptr-basic-ui")?.shadowRoot as ShadowRoot;
  expect(
    shadow.querySelector("[data-basic-action='translate']")?.textContent
  ).toBe("i18n:translatePage");
  expect(
    shadow.querySelector("[data-basic-action='settings']")?.textContent
  ).toBe("i18n:basicOpenSettings");
  expect(shadow.querySelector("#ptr-basic-studio")?.textContent).toBe(
    "i18n:studioMode"
  );

  controller.setTranslated(true);
  expect(
    shadow.querySelector("[data-basic-action='translate']")?.textContent
  ).toBe("i18n:restorePage");

  controller.stop();
});
