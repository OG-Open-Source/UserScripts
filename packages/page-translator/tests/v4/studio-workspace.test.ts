import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import locales from "../../locales.json" with { type: "json" };
import { mergeLocaleTables } from "../../src/dict/store";
import type { SiteLocaleTable } from "../../src/dict/template";
import type { TranslatorConfig } from "../../src/platform/config";
import { DEFAULT_CONFIG } from "../../src/platform/config";
import { MESSAGES_EN } from "../../src/platform/i18n";
import { createPtrMetrics } from "../../src/platform/metrics";
import { resolveAdapter } from "../../src/structure/registry";
import { parseSiteDelta } from "../../src/structure/site-rules";
import { createStudioWorkspaceController } from "../../src/ui/studio/workspace";
import { createStudioBreakpointGate } from "../../src/ui/studio/workspace/logic";

const zhTw = locales.languages.find((l) => l.code === "zh-Hant-TW")?.messages as
  | Record<string, string>
  | undefined;

function createTestEnv(html: string, url = "https://example.com/articles/1") {
  const win = new Window({ url });
  const doc = win.document as unknown as Document;
  doc.body.innerHTML = html;

  let config: TranslatorConfig = {
    ...DEFAULT_CONFIG,
    uiTier: "studio",
    targetLang: "zh-Hant-TW",
  };
  let rawDelta = "";
  let localTable: SiteLocaleTable | null = null;
  let translated = false;
  let exitCount = 0;
  let settingsCount = 0;
  let toggleTranslateCount = 0;
  let siteDictUpdatedCount = 0;
  const savedDeltas: string[] = [];
  const syncedPatches: SiteLocaleTable[] = [];
  const metrics = createPtrMetrics();
  const breakpointGate = createStudioBreakpointGate();

  const controller = createStudioWorkspaceController({
    breakpointGate,
    doc,
    getAdapter: () => resolveAdapter({ doc, host: "example.com" }),
    getConfig: () => config,
    getDelta: () => parseSiteDelta(rawDelta),
    getHostRawDelta: () => rawDelta,
    getLocalLocaleTable: () => localTable,
    getMetrics: () => metrics,
    getSiteLocaleTable: () => localTable,
    getTargetLang: () => config.targetLang,
    hostname: "example.com",
    isTranslated: () => translated,
    onExitStudio: () => {
      exitCount += 1;
      config = { ...config, uiTier: "basic" };
    },
    onOpenSettings: () => {
      settingsCount += 1;
    },
    onSaveHostDelta: (nextRaw) => {
      rawDelta = nextRaw;
      savedDeltas.push(nextRaw);
    },
    onSiteDictUpdated: () => {
      siteDictUpdatedCount += 1;
    },
    onSyncLocalTable: (patch) => {
      syncedPatches.push(patch);
      localTable = mergeLocaleTables(localTable, patch);
    },
    onToggleTranslate: () => {
      toggleTranslateCount += 1;
      translated = !translated;
    },
  });

  return {
    breakpointGate,
    controller,
    doc,
    getConfig: () => config,
    getExitCount: () => exitCount,
    getLocalTable: () => localTable,
    getRawDelta: () => rawDelta,
    getSettingsCount: () => settingsCount,
    getSiteDictUpdatedCount: () => siteDictUpdatedCount,
    getToggleTranslateCount: () => toggleTranslateCount,
    savedDeltas,
    setConfig: (next: Partial<TranslatorConfig>) => {
      config = { ...config, ...next };
    },
    setLocalTable: (next: SiteLocaleTable | null) => {
      localTable = next;
    },
    syncedPatches,
    win,
  };
}

function getShellShadow(doc: Document): ShadowRoot {
  const host = doc.querySelector("#ptr-studio-shell");
  if (!host?.shadowRoot) {
    throw new Error("Expected #ptr-studio-shell shadowRoot");
  }
  return host.shadowRoot;
}

describe("Industrial Studio Workspace", () => {
  test("1. mounts #ptr-studio-shell directly on documentElement with stage CSS and all workspace docks", () => {
    const { controller, doc } = createTestEnv(
      "<main><h1>Hello Studio</h1><p>Inspectable body copy.</p></main>"
    );

    controller.syncFromConfig();
    expect(controller.isActive()).toBe(true);

    const host = doc.querySelector("#ptr-studio-shell");
    expect(host).not.toBeNull();
    expect(host?.parentElement).toBe(doc.documentElement);
    expect(doc.body.querySelector("#ptr-studio-shell")).toBeNull();
    expect(host?.getAttribute("data-us-ui")).toBe("ptr");
    expect(host?.getAttribute("translate")).toBe("no");

    expect(doc.documentElement.getAttribute("data-ptr-studio-active")).toBe(
      "1"
    );
    expect(doc.querySelector("#ptr-studio-stage-css")).not.toBeNull();

    const sr = getShellShadow(doc);
    expect(sr.querySelector('[data-studio-dock="top"]')).not.toBeNull();
    expect(sr.querySelector('[data-studio-dock="left"]')).not.toBeNull();
    expect(sr.querySelector('[data-studio-dock="right"]')).not.toBeNull();
    expect(sr.querySelector('[data-studio-dock="bottom"]')).not.toBeNull();
    expect(sr.querySelector("[data-studio-overlay]")).not.toBeNull();

    controller.stop();
  });

  test("2. left explorer lists captured & excluded nodes, filters by tab/search, and populates right inspector on click", () => {
    const { controller, doc, win } = createTestEnv(
      `<main>
        <article id="lead-card"><h2>Visible Headline</h2></article>
        <pre><code>const ignoredCode = true;</code></pre>
      </main>`
    );

    controller.syncFromConfig();
    const sr = getShellShadow(doc);

    const allRows = sr.querySelectorAll("[data-studio-node-index]");
    expect(allRows.length).toBeGreaterThan(2);

    const excludedTab = sr.querySelector(
      '[data-studio-filter="excluded"]'
    ) as HTMLButtonElement;
    excludedTab.click();
    const excludedRows = sr.querySelectorAll("[data-studio-node-index]");
    expect(excludedRows.length).toBeGreaterThan(0);
    expect(excludedRows.length).toBeLessThan(allRows.length);

    const capturedTab = sr.querySelector(
      '[data-studio-filter="captured"]'
    ) as HTMLButtonElement;
    capturedTab.click();
    const capturedRows = sr.querySelectorAll("[data-studio-node-index]");
    expect(capturedRows.length).toBeGreaterThan(0);

    const searchInput = sr.querySelector(
      "[data-studio-search]"
    ) as HTMLInputElement;
    searchInput.value = "Visible Headline";
    searchInput.dispatchEvent(
      new win.Event("input", { bubbles: true }) as unknown as Event
    );
    const filteredRows = sr.querySelectorAll("[data-studio-node-index]");
    expect(filteredRows.length).toBeGreaterThan(0);

    const targetRow = Array.from(filteredRows).find((r) =>
      (r.textContent ?? "").includes("h2")
    ) as HTMLElement;
    expect(targetRow).toBeDefined();
    targetRow.click();

    const nodePanel = sr.querySelector('[data-studio-panel="node"]');
    const panelText = nodePanel?.textContent ?? "";
    expect(panelText).toContain("Visible Headline");
    expect(panelText).toContain("prose");
    const selectorInput = sr.querySelector(
      "[data-studio-rule-selector]"
    ) as HTMLInputElement;
    expect(selectorInput.value.length).toBeGreaterThan(0);

    controller.stop();
  });

  test("3. clicking + Include / - Exclude / * Modifier + Apply updates delta textarea, calls onSaveHostDelta, and rescans live", () => {
    const { controller, doc, savedDeltas, win } = createTestEnv(
      `<main>
        <p id="target-para">Rule target paragraph</p>
      </main>`
    );

    controller.syncFromConfig();
    const sr = getShellShadow(doc);

    const searchInput = sr.querySelector(
      "[data-studio-search]"
    ) as HTMLInputElement;
    searchInput.value = "Rule target paragraph";
    searchInput.dispatchEvent(
      new win.Event("input", { bubbles: true }) as unknown as Event
    );

    const rows = sr.querySelectorAll("[data-studio-node-index]");
    const pRow = Array.from(rows).find(
      (r) =>
        (r.textContent ?? "").includes("> p") ||
        (r.textContent ?? "").includes("#target-para")
    ) as HTMLElement | undefined;
    (pRow ?? (rows[0] as HTMLElement)).click();

    const selectorInput = sr.querySelector(
      "[data-studio-rule-selector]"
    ) as HTMLInputElement;
    selectorInput.value = "#target-para";

    const excludeBtn = sr.querySelector(
      '[data-studio-action="rule-remove"]'
    ) as HTMLButtonElement;
    excludeBtn.click();

    const deltaArea = sr.querySelector(
      "[data-studio-delta-textarea]"
    ) as HTMLTextAreaElement;
    expect(deltaArea.value).toContain("- #target-para");

    const applyBtn = sr.querySelector(
      '[data-studio-action="rule-apply"]'
    ) as HTMLButtonElement;
    applyBtn.click();

    expect(savedDeltas.at(-1)).toContain("- #target-para");

    const includeBtn = sr.querySelector(
      '[data-studio-action="rule-add"]'
    ) as HTMLButtonElement;
    includeBtn.click();
    expect(deltaArea.value).toContain("+ #target-para");

    const modBtn = sr.querySelector(
      '[data-studio-action="rule-mod"]'
    ) as HTMLButtonElement;
    modBtn.click();
    expect(deltaArea.value).toContain("* #target-para :");

    applyBtn.click();
    expect(savedDeltas.length).toBe(2);

    controller.stop();
  });

  test("4. Download Raw Nodes and getRawNodesJson produce valid JSON with host, url, adapterId, count, candidates", () => {
    const { controller, doc } = createTestEnv(
      "<main><p>Exportable text node</p></main>"
    );
    controller.syncFromConfig();

    const rawJson = controller.getRawNodesJson();
    const parsed = JSON.parse(rawJson) as {
      adapterId: string;
      candidates: unknown[];
      count: number;
      host: string;
      url: string;
    };
    expect(parsed.host).toBe("example.com");
    expect(parsed.url).toContain("https://example.com/");
    expect(typeof parsed.adapterId).toBe("string");
    expect(parsed.count).toBe(parsed.candidates.length);
    expect(parsed.count).toBeGreaterThan(0);

    const sr = getShellShadow(doc);
    let clickedDownload = false;
    const origCreateElement = doc.createElement.bind(doc);
    doc.createElement = ((tag: string) => {
      const el = origCreateElement(tag);
      if (tag.toLowerCase() === "a") {
        el.click = () => {
          clickedDownload = true;
        };
      }
      return el;
    }) as typeof doc.createElement;

    const exportBtn = sr.querySelector(
      '[data-studio-action="export-nodes"]'
    ) as HTMLButtonElement;
    exportBtn.click();
    expect(clickedDownload).toBe(true);

    doc.createElement = origCreateElement;
    controller.stop();
  });

  test("5. Site Dict tab navigates segments, suggests scope, saves drafts, exports AI, and resolves import conflicts", () => {
    const { controller, doc, setLocalTable, syncedPatches } = createTestEnv(
      `<main>
        <section aria-label="Nav">
          <div id="item-1">Settings</div>
          <div id="item-2">Profile</div>
        </section>
      </main>`
    );

    setLocalTable({
      static: {
        Settings: "設定-舊",
      },
    });

    controller.syncFromConfig();
    const sr = getShellShadow(doc);

    const dictTab = sr.querySelector(
      '[data-studio-right-tab="dict"]'
    ) as HTMLButtonElement;
    dictTab.click();

    const suggestBtn = sr.querySelector(
      '[data-studio-dict="suggest"]'
    ) as HTMLButtonElement;
    suggestBtn.click();

    const scopeInput = sr.querySelector(
      '[data-studio-dict="scope"]'
    ) as HTMLInputElement;
    expect(scopeInput.value.length).toBeGreaterThan(0);

    const transInput = sr.querySelector(
      '[data-studio-dict="trans"]'
    ) as HTMLInputElement;
    transInput.value = "設定";

    const saveBtn = sr.querySelector(
      '[data-studio-dict="save"]'
    ) as HTMLButtonElement;
    saveBtn.click();
    expect(syncedPatches.length).toBeGreaterThan(0);

    const nextBtn = sr.querySelector(
      '[data-studio-dict="next"]'
    ) as HTMLButtonElement;
    nextBtn.click();

    const importToggleBtn = sr.querySelector(
      '[data-studio-dict="import-ai"]'
    ) as HTMLButtonElement;
    importToggleBtn.click();

    const importTextarea = sr.querySelector(
      '[data-studio-dict="import-text"]'
    ) as HTMLTextAreaElement;
    importTextarea.value = JSON.stringify({
      translations: {
        Settings: "設定-新",
        Profile: "個人檔案",
      },
    });

    const applyImportBtn = sr.querySelector(
      '[data-studio-dict="import-apply"]'
    ) as HTMLButtonElement;
    applyImportBtn.click();

    const conflictsBox = sr.querySelector('[data-studio-dict="conflicts"]');
    expect(conflictsBox?.textContent ?? "").toContain("設定-舊");
    expect(conflictsBox?.textContent ?? "").toContain("設定-新");

    const overwriteBtn = sr.querySelector(
      "[data-studio-conflict-overwrite]"
    ) as HTMLButtonElement;
    overwriteBtn.click();
    expect(syncedPatches.some((p) => p.static?.Settings === "設定-新")).toBe(
      true
    );

    controller.stop();
  });

  test("6. Select Mode blocks host <a href> clicks while allowing #ptr-studio-shell clicks and selecting host elements", () => {
    const { controller, doc, win } = createTestEnv(
      `<main>
        <a id="host-link" href="https://example.com/other">Click Me</a>
        <p id="host-para">Select this paragraph</p>
      </main>`
    );

    controller.syncFromConfig();
    const sr = getShellShadow(doc);

    const link = doc.querySelector("#host-link") as HTMLAnchorElement;
    const linkClick = new win.Event("click", {
      bubbles: true,
      cancelable: true,
    }) as unknown as Event;
    link.dispatchEvent(linkClick);
    expect(linkClick.defaultPrevented).toBe(true);

    const para = doc.querySelector("#host-para") as HTMLParagraphElement;
    const paraClick = new win.Event("click", {
      bubbles: true,
      cancelable: true,
    }) as unknown as Event;
    para.dispatchEvent(paraClick);
    expect(paraClick.defaultPrevented).toBe(true);

    const nodePanel = sr.querySelector('[data-studio-panel="node"]');
    expect(nodePanel?.textContent ?? "").toContain("Select this paragraph");

    // Clicking inside #ptr-studio-shell must NOT be blocked
    const rescanBtn = sr.querySelector(
      '[data-studio-action="rescan"]'
    ) as HTMLButtonElement;
    const uiClick = new win.Event("click", {
      bubbles: true,
      cancelable: true,
    }) as unknown as Event;
    rescanBtn.dispatchEvent(uiClick);
    expect(uiClick.defaultPrevented).toBe(false);

    controller.stop();
  });

  test("7. Bottom Dock Record toggle logs events and clears cleanly; Pause before API controls breakpointGate", async () => {
    const { breakpointGate, controller, doc } = createTestEnv(
      "<main><p>Initial node</p></main>"
    );

    controller.syncFromConfig();
    const sr = getShellShadow(doc);

    const recordTab = sr.querySelector(
      '[data-studio-bottom-tab="record"]'
    ) as HTMLButtonElement;
    recordTab.click();

    const recordToggle = sr.querySelector(
      '[data-studio-action="record-toggle"]'
    ) as HTMLButtonElement;
    recordToggle.click();

    const rescanBtn = sr.querySelector(
      '[data-studio-action="rescan"]'
    ) as HTMLButtonElement;
    rescanBtn.click();

    const activityList = sr.querySelector("[data-studio-activity-list]");
    expect((activityList?.textContent ?? "").length).toBeGreaterThan(0);

    const clearBtn = sr.querySelector(
      '[data-studio-action="record-clear"]'
    ) as HTMLButtonElement;
    clearBtn.click();
    expect(activityList?.textContent ?? "").toContain(
      MESSAGES_EN.studioRecordEmpty
    );

    // Breakpoint gate
    const pauseBtn = sr.querySelector(
      '[data-studio-action="bp-pause"]'
    ) as HTMLButtonElement;
    pauseBtn.click();
    expect(breakpointGate.isPaused()).toBe(true);

    let resolved = false;
    const pending = breakpointGate.waitIfPaused().then(() => {
      resolved = true;
    });
    expect(breakpointGate.isWaiting()).toBe(true);
    expect(resolved).toBe(false);

    const resumeBtn = sr.querySelector(
      '[data-studio-action="bp-resume"]'
    ) as HTMLButtonElement;
    resumeBtn.click();
    await pending;
    expect(resolved).toBe(true);

    controller.stop();
  });

  test("8. stop() and transitioning uiTier to basic cleanly remove shell, stage CSS, active attr, and listeners", () => {
    const { controller, doc, setConfig, win } = createTestEnv(
      '<main><a id="link-after" href="#next">Next</a></main>'
    );

    controller.syncFromConfig();
    expect(doc.querySelector("#ptr-studio-shell")).not.toBeNull();
    expect(doc.querySelector("#ptr-studio-stage-css")).not.toBeNull();
    expect(doc.documentElement.getAttribute("data-ptr-studio-active")).toBe(
      "1"
    );

    setConfig({ uiTier: "basic" });
    controller.syncFromConfig();
    expect(controller.isActive()).toBe(false);
    expect(doc.querySelector("#ptr-studio-shell")).toBeNull();
    expect(doc.querySelector("#ptr-studio-stage-css")).toBeNull();
    expect(
      doc.documentElement.getAttribute("data-ptr-studio-active")
    ).toBeNull();

    // Host link clicks should no longer be blocked
    const link = doc.querySelector("#link-after") as HTMLAnchorElement;
    const clickEv = new win.Event("click", {
      bubbles: true,
      cancelable: true,
    }) as unknown as Event;
    link.dispatchEvent(clickEv);
    expect(clickEv.defaultPrevented).toBe(false);

    // Re-mount and verify stop() cleans up too
    setConfig({ uiTier: "studio" });
    controller.syncFromConfig();
    expect(controller.isActive()).toBe(true);
    controller.stop();
    expect(controller.isActive()).toBe(false);
    expect(doc.querySelector("#ptr-studio-shell")).toBeNull();
    expect(doc.querySelector("#ptr-studio-stage-css")).toBeNull();
  });

  test("9. injecting zh-Hant-TW t() localizes visible labels across toolbar and docks", () => {
    const win = new Window({ url: "https://example.com/" });
    const doc = win.document as unknown as Document;
    doc.body.innerHTML = "<main><p>Hello i18n</p></main>";

    const t = (key: string) =>
      zhTw?.[key] ?? MESSAGES_EN[key as keyof typeof MESSAGES_EN] ?? key;

    const controller = createStudioWorkspaceController({
      doc,
      getAdapter: () => resolveAdapter({ doc, host: "example.com" }),
      getConfig: () => ({ ...DEFAULT_CONFIG, uiTier: "studio" }),
      getDelta: () => ({ addSelectors: [], removeSelectors: [], modRules: [] }),
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

    controller.syncFromConfig();
    const sr = getShellShadow(doc);
    const allText = sr.textContent ?? "";

    expect(allText).toContain(zhTw?.studioExit ?? "");
    expect(allText).toContain(zhTw?.studioInspectorNode ?? "");
    expect(allText).toContain(zhTw?.studioInspectorDict ?? "");
    expect(allText).toContain(zhTw?.studioBottomDiag ?? "");
    expect(allText).toContain(zhTw?.studioBottomRecord ?? "");
    expect(allText).not.toContain("Exit Studio");
    expect(allText).not.toContain("Node & Rules");
    expect(allText).not.toContain("Diagnostics & Export");

    controller.stop();
  });

  test("10. resolving an import conflict with Use overwrites stale draftPatch in both Site Dict input and exported JSON", () => {
    const { controller, doc } = createTestEnv(
      '<main><div id="item-1">Settings</div></main>'
    );
    controller.syncFromConfig();
    const sr = getShellShadow(doc);

    const dictTab = sr.querySelector(
      '[data-studio-right-tab="dict"]'
    ) as HTMLButtonElement;
    dictTab.click();

    const transInput = sr.querySelector(
      '[data-studio-dict="trans"]'
    ) as HTMLInputElement;
    transInput.value = "設定-草稿";

    const saveBtn = sr.querySelector(
      '[data-studio-dict="save"]'
    ) as HTMLButtonElement;
    saveBtn.click();

    const importToggleBtn = sr.querySelector(
      '[data-studio-dict="import-ai"]'
    ) as HTMLButtonElement;
    importToggleBtn.click();

    const importTextarea = sr.querySelector(
      '[data-studio-dict="import-text"]'
    ) as HTMLTextAreaElement;
    importTextarea.value = JSON.stringify({
      translations: {
        Settings: "設定-覆寫",
      },
    });

    const applyImportBtn = sr.querySelector(
      '[data-studio-dict="import-apply"]'
    ) as HTMLButtonElement;
    applyImportBtn.click();

    const overwriteBtn = sr.querySelector(
      "[data-studio-conflict-overwrite]"
    ) as HTMLButtonElement;
    overwriteBtn.click();

    expect(transInput.value).toBe("設定-覆寫");

    let copiedJson = "";
    const origClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copiedJson = text;
          return Promise.resolve();
        },
      },
    });

    try {
      const copyJsonBtn = sr.querySelector(
        '[data-studio-dict="copy-json"]'
      ) as HTMLButtonElement;
      copyJsonBtn.click();
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: origClipboard,
      });
    }

    expect(copiedJson).toContain("設定-覆寫");
    expect(copiedJson).not.toContain("設定-草稿");

    controller.stop();
  });

  test("11. nodeList.scrollTop is preserved across clicking/selecting a node", () => {
    const { controller, doc } = createTestEnv(
      "<main><p>First node</p><p>Second node</p><p>Third node</p></main>"
    );
    controller.syncFromConfig();
    const sr = getShellShadow(doc);

    const nodeList = sr.querySelector("[data-studio-node-list]") as HTMLElement;
    nodeList.scrollTop = 120;

    const rows = sr.querySelectorAll("[data-studio-node-index]");
    expect(rows.length).toBeGreaterThan(1);
    (rows[1] as HTMLElement).click();

    expect(nodeList.scrollTop).toBe(120);

    controller.stop();
  });

  test("12. top-right toolbar uses inline select specificity, horizontal scroll fallback, and superellipse(2) squircle buttons", () => {
    const { controller, doc } = createTestEnv("<main><p>Hello</p></main>");
    controller.syncFromConfig();
    const sr = getShellShadow(doc);
    const styleText = Array.from(sr.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .join("\n");

    expect(styleText).toContain("select.ptr-input.ptr-studio-select-inline");
    expect(styleText).toContain("width: auto;");
    expect(styleText).toContain(".ptr-studio-top-actions");
    expect(styleText).toContain("overflow-x: auto;");
    expect(styleText).toContain("white-space: nowrap;");
    expect(styleText).toContain("--rho: 0.5;");
    expect(styleText).toContain(
      "border-radius: calc(var(--rho) * min(240px, 60px));"
    );
    expect(styleText).toContain("corner-shape: superellipse(2);");

    controller.stop();
  });

  test("13. Studio Workspace view and overlay use Lit templates without customElements.define", () => {
    const viewSrc = readFileSync(
      resolve(import.meta.dir, "../../src/ui/studio/workspace/view.ts"),
      "utf8"
    );
    const overlaySrc = readFileSync(
      resolve(import.meta.dir, "../../src/ui/studio/workspace/overlay.ts"),
      "utf8"
    );

    expect(viewSrc).toContain('from "lit"');
    expect(viewSrc).toContain("html`");
    expect(viewSrc).not.toContain("customElements.define");
    expect(viewSrc).not.toContain("function makeButton");

    expect(overlaySrc).toContain('from "lit"');
    expect(overlaySrc).toContain("html`");
    expect(overlaySrc).not.toContain("customElements.define");
  });

  test("14. typing in controlled Studio inputs is not overwritten by unrelated view updates", () => {
    const { breakpointGate, controller, doc, win } = createTestEnv(
      `<main>
        <section aria-label="Nav">
          <p id="p1">Hello Alpha</p>
          <p id="p2">Hello Beta</p>
        </section>
      </main>`
    );

    controller.syncFromConfig();
    const sr = getShellShadow(doc);
    const litRoot = sr.querySelector(".ptr-lit-root");
    expect(litRoot).not.toBeNull();

    const searchInput = sr.querySelector(
      "[data-studio-search]"
    ) as HTMLInputElement;
    const selectorInput = sr.querySelector(
      "[data-studio-rule-selector]"
    ) as HTMLInputElement;
    const deltaTextarea = sr.querySelector(
      "[data-studio-delta-textarea]"
    ) as HTMLTextAreaElement;
    const scopeInput = sr.querySelector(
      '[data-studio-dict="scope"]'
    ) as HTMLInputElement;
    const transInput = sr.querySelector(
      '[data-studio-dict="trans"]'
    ) as HTMLInputElement;
    const importTextarea = sr.querySelector(
      '[data-studio-dict="import-text"]'
    ) as HTMLTextAreaElement;

    const typeInto = (
      el: HTMLInputElement | HTMLTextAreaElement,
      value: string
    ): void => {
      el.value = value;
      el.dispatchEvent(
        new win.Event("input", { bubbles: true }) as unknown as Event
      );
    };

    typeInto(searchInput, "Alpha");
    typeInto(selectorInput, "#custom-rule");
    typeInto(deltaTextarea, "+ #custom-rule");
    typeInto(scopeInput, "section[aria-label='Nav']");
    typeInto(transInput, "哈囉阿爾法");
    typeInto(importTextarea, '{"translations":{"Hello Alpha":"你好"}}');

    // Unrelated updates: collapse bottom dock, switch bottom tabs, toggle record, toggle breakpoint, switch right tabs
    const collapseBtn = sr.querySelector(
      '[data-studio-action="collapse-bottom"]'
    ) as HTMLButtonElement;
    collapseBtn.click();
    const recordTab = sr.querySelector(
      '[data-studio-bottom-tab="record"]'
    ) as HTMLButtonElement;
    recordTab.click();
    const recordToggle = sr.querySelector(
      '[data-studio-action="record-toggle"]'
    ) as HTMLButtonElement;
    recordToggle.click();
    breakpointGate.setPaused(true);
    breakpointGate.setPaused(false);
    const dictTab = sr.querySelector(
      '[data-studio-right-tab="dict"]'
    ) as HTMLButtonElement;
    dictTab.click();
    const nodeTab = sr.querySelector(
      '[data-studio-right-tab="node"]'
    ) as HTMLButtonElement;
    nodeTab.click();
    const translateBtn = sr.querySelector(
      '[data-studio-action="translate"]'
    ) as HTMLButtonElement;
    translateBtn.click();

    expect(searchInput.value).toBe("Alpha");
    expect(selectorInput.value).toBe("#custom-rule");
    expect(deltaTextarea.value).toBe("+ #custom-rule");
    expect(scopeInput.value).toBe("section[aria-label='Nav']");
    expect(transInput.value).toBe("哈囉阿爾法");
    expect(importTextarea.value).toBe(
      '{"translations":{"Hello Alpha":"你好"}}'
    );

    // Programmatic updates still work after user typing
    const excludeBtn = sr.querySelector(
      '[data-studio-action="rule-remove"]'
    ) as HTMLButtonElement;
    excludeBtn.click();
    expect(deltaTextarea.value).toContain("- #custom-rule");

    dictTab.click();
    const nextBtn = sr.querySelector(
      '[data-studio-dict="next"]'
    ) as HTMLButtonElement;
    nextBtn.click();
    expect(transInput.value).toBe("");

    controller.stop();
  });
});
