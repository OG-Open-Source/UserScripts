import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import locales from "../../locales.json" with { type: "json" };
import { DEFAULT_CONFIG } from "../../src/platform/config";
import type { PtrMessageKey } from "../../src/platform/i18n";
import { MESSAGES_EN } from "../../src/platform/i18n";
import { createPtrMetrics } from "../../src/platform/metrics";
import { resolveAdapter } from "../../src/structure/registry";
import { parseSiteDelta } from "../../src/structure/site-rules";
import { createStudioWorkspaceController } from "../../src/ui/studio/workspace";

const zhTw = locales.languages.find((l) => l.code === "zh-Hant-TW")?.messages as
  | Record<string, string>
  | undefined;
const zhCn = locales.languages.find((l) => l.code === "zh-Hans-CN")?.messages as
  | Record<string, string>
  | undefined;

const WORKSPACE_HARDCODED_RE =
  /["']Exit Studio["']|["']Save & Preview["']|["']Copy Diagnostics["']|["']Apply Delta["']/u;

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

test("Studio Workspace renders localized zh-Hant-TW strings when t() is injected", () => {
  const win = new Window({ url: "https://example.com/" });
  win.document.body.innerHTML = "<div>Hello world</div>";
  const doc = win.document as unknown as Document;
  const t = (key: string) =>
    zhTw?.[key] ?? MESSAGES_EN[key as PtrMessageKey] ?? key;

  const studio = createStudioWorkspaceController({
    doc,
    getAdapter: () => resolveAdapter({ doc, host: "example.com" }),
    getConfig: () => ({ ...DEFAULT_CONFIG, uiTier: "studio" }),
    getDelta: () => parseSiteDelta(""),
    getHostRawDelta: () => "",
    getLocalLocaleTable: () => null,
    getMetrics: () => createPtrMetrics(),
    getSiteLocaleTable: () => null,
    getTargetLang: () => "zh-Hant-TW",
    hostname: "example.com",
    isTranslated: () => false,
    onExitStudio: () => undefined,
    onOpenSettings: () => undefined,
    onSaveHostDelta: () => undefined,
    onSyncLocalTable: () => undefined,
    onToggleTranslate: () => undefined,
    t,
  });

  studio.syncFromConfig();
  const studioText =
    win.document.querySelector("#ptr-studio-shell")?.shadowRoot?.textContent ??
    "";
  expect(typeof zhTw?.studioInspectorNode).toBe("string");
  expect(zhTw?.studioInspectorNode.length).toBeGreaterThan(0);
  expect(typeof zhTw?.studioInspectorDict).toBe("string");
  expect(zhTw?.studioInspectorDict.length).toBeGreaterThan(0);
  expect(studioText).toContain(zhTw?.studioInspectorNode as string);
  expect(studioText).toContain(zhTw?.studioInspectorDict as string);
  expect(studioText).toContain(zhTw?.studioExit ?? "");
  expect(studioText).toContain(zhTw?.volSave ?? "");
  studio.stop();
});

test("Studio Workspace view contains no hardcoded UI English copy outside i18n keys", () => {
  const viewSrc = readFileSync(
    resolve(import.meta.dir, "../../src/ui/studio/workspace/view.ts"),
    "utf8"
  );
  expect(viewSrc).not.toMatch(WORKSPACE_HARDCODED_RE);
});
