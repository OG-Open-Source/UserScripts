import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import locales from "../../locales.json" with { type: "json" };
import { DEFAULT_CONFIG } from "../../src/platform/config";
import type { PtrMessageKey } from "../../src/platform/i18n";
import { MESSAGES_EN } from "../../src/platform/i18n";
import { createInspectController } from "../../src/ui/studio/inspect";
import { createVolunteerController } from "../../src/ui/studio/volunteer";

const zhTw = locales.languages.find((l) => l.code === "zh-Hant-TW")?.messages as
  | Record<string, string>
  | undefined;
const zhCn = locales.languages.find((l) => l.code === "zh-Hans-CN")?.messages as
  | Record<string, string>
  | undefined;

const INSPECT_HARDCODED_RE =
  /["']Capture Preview["']|["']Copy Diagnostics["']/u;
const VOLUNTEER_HARDCODED_RE =
  /["']Rescan["']|["']Save & Preview["']|["']Manual Hits:/u;

test("all MESSAGES_EN keys are translated in zh-Hant-TW and zh-Hans-CN locales", () => {
  expect(zhTw).toBeDefined();
  expect(zhCn).toBeDefined();
  for (const key of Object.keys(MESSAGES_EN)) {
    expect(typeof zhTw?.[key]).toBe("string");
    expect(zhTw?.[key]?.length).toBeGreaterThan(0);
    expect(typeof zhCn?.[key]).toBe("string");
    expect(zhCn?.[key]?.length).toBeGreaterThan(0);
  }
});

test("HUD and Volunteer panels render localized zh-Hant-TW strings when t() is injected", () => {
  const win = new Window();
  win.document.body.innerHTML = "<div>Hello world</div>";
  const t = (key: PtrMessageKey) => zhTw?.[key] ?? MESSAGES_EN[key];

  const inspect = createInspectController({
    doc: win.document as unknown as Document,
    getConfig: () => ({
      ...DEFAULT_CONFIG,
      uiTier: "studio",
      defaultInspect: true,
    }),
    getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
    storage: null,
    t,
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
      visibility: "visible",
    }),
  });
  inspect.syncFromConfig();
  const hudText =
    win.document.querySelector("#ptr-inspect-hud")?.shadowRoot?.textContent ??
    "";
  expect(hudText).toContain("捕捉預覽模式");
  expect(hudText).toContain("全文導出 (AI)");
  expect(hudText).toContain("片段總數");
  inspect.stop();

  const vol = createVolunteerController({
    doc: win.document as unknown as Document,
    hostname: "example.com",
    getConfig: () => ({
      ...DEFAULT_CONFIG,
      uiTier: "studio",
      defaultVolunteer: true,
    }),
    getTargetLang: () => "zh-Hant-TW",
    getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
    getSiteLocaleTable: () => null,
    storage: null,
    t,
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
      visibility: "visible",
    }),
  });
  vol.syncFromConfig();
  const volText =
    win.document.querySelector("#ptr-volunteer-workbench")?.shadowRoot
      ?.textContent ?? "";
  expect(volText).toContain("志工協作");
  expect(volText).toContain("儲存並預覽");
  expect(volText).toContain("靜態片段");
  vol.stop();
});

test("Studio Inspect and Volunteer views contain no hardcoded UI English copy outside i18n keys", () => {
  const inspectSrc = readFileSync(
    resolve(import.meta.dir, "../../src/ui/studio/inspect/view.ts"),
    "utf8"
  );
  const volSrc = readFileSync(
    resolve(import.meta.dir, "../../src/ui/studio/volunteer/view.ts"),
    "utf8"
  );
  expect(inspectSrc).not.toMatch(INSPECT_HARDCODED_RE);
  expect(volSrc).not.toMatch(VOLUNTEER_HARDCODED_RE);
});
