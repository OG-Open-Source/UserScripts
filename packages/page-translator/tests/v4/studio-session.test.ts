import { describe, expect, test } from "bun:test";
import { createStudioSessionCoordinator } from "../../src/platform/studio-session";

interface HarnessOptions {
  autoTranslate?: boolean;
  studioActive?: boolean;
  tabActive?: boolean;
  translated?: boolean;
}

function createHarness(init: HarnessOptions = {}) {
  let autoTranslate = init.autoTranslate ?? false;
  let studioActive = init.studioActive ?? false;
  let tabActive = init.tabActive ?? false;
  let translated = init.translated ?? false;

  const calls: string[] = [];

  const session = createStudioSessionCoordinator({
    getAutoTranslate: () => autoTranslate,
    getTabActive: () => tabActive,
    isStudioActive: () => studioActive,
    isTranslated: () => translated,
    onClearCacheAndRestart: () => {
      calls.push("clearCacheAndRestart");
      translated = true;
      tabActive = true;
    },
    onRescanStudio: () => {
      calls.push("rescanStudio");
    },
    onRestoreForStudio: () => {
      calls.push("restoreForStudio");
      translated = false;
    },
    onSpaNavigate: () => {
      calls.push("spaNavigate");
    },
    onStartTranslation: () => {
      calls.push("startTranslation");
      translated = true;
      tabActive = true;
    },
    onStopTranslation: () => {
      calls.push("stopTranslation");
      translated = false;
      tabActive = false;
    },
  });

  return {
    calls,
    getAutoTranslate: () => autoTranslate,
    isStudioActive: () => studioActive,
    isTabActive: () => tabActive,
    isTranslated: () => translated,
    session,
    setAutoTranslate: (next: boolean) => {
      autoTranslate = next;
    },
    setStudioActive: (next: boolean) => {
      studioActive = next;
    },
    setTabActive: (next: boolean) => {
      tabActive = next;
    },
    setTranslated: (next: boolean) => {
      translated = next;
    },
  };
}

describe("StudioSessionCoordinator", () => {
  test("onBoot() suspends autoTranslate and tabActive when Studio is active", () => {
    const hAuto = createHarness({ autoTranslate: true, studioActive: true });
    hAuto.session.onBoot();
    expect(hAuto.session.suspendedForStudio).toBe(true);
    expect(hAuto.calls).toEqual([]);
    expect(hAuto.isTranslated()).toBe(false);

    const hTab = createHarness({ tabActive: true, studioActive: true });
    hTab.session.onBoot();
    expect(hTab.session.suspendedForStudio).toBe(true);
    expect(hTab.calls).toEqual([]);
    expect(hTab.isTranslated()).toBe(false);

    const hIdle = createHarness({ studioActive: true });
    hIdle.session.onBoot();
    expect(hIdle.session.suspendedForStudio).toBe(false);
    expect(hIdle.calls).toEqual([]);
  });

  test("onBoot() starts translation when Studio is inactive and autoTranslate or tabActive is true", () => {
    const hAuto = createHarness({ autoTranslate: true, studioActive: false });
    hAuto.session.onBoot();
    expect(hAuto.session.suspendedForStudio).toBe(false);
    expect(hAuto.calls).toEqual(["startTranslation"]);
    expect(hAuto.isTranslated()).toBe(true);

    const hTab = createHarness({ tabActive: true, studioActive: false });
    hTab.session.onBoot();
    expect(hTab.session.suspendedForStudio).toBe(false);
    expect(hTab.calls).toEqual(["startTranslation"]);

    const hIdle = createHarness({ studioActive: false });
    hIdle.session.onBoot();
    expect(hIdle.session.suspendedForStudio).toBe(false);
    expect(hIdle.calls).toEqual([]);
  });

  test("onStudioMount() restores active translation without clearing tabActive and onStudioUnmount() resumes it", () => {
    const h = createHarness({
      studioActive: true,
      tabActive: true,
      translated: true,
    });

    h.session.onStudioMount();
    expect(h.session.suspendedForStudio).toBe(true);
    expect(h.calls).toEqual(["restoreForStudio"]);
    expect(h.isTranslated()).toBe(false);
    expect(h.isTabActive()).toBe(true);

    h.setStudioActive(false);
    h.session.onStudioUnmount();
    expect(h.session.suspendedForStudio).toBe(false);
    expect(h.calls).toEqual(["restoreForStudio", "startTranslation"]);
    expect(h.isTranslated()).toBe(true);
  });

  test("onStudioMount() when untranslated does not restore and onStudioUnmount() obeys autoTranslate", () => {
    const hManual = createHarness({ autoTranslate: false, studioActive: true });
    hManual.session.onStudioMount();
    expect(hManual.session.suspendedForStudio).toBe(false);
    expect(hManual.calls).toEqual([]);
    hManual.setStudioActive(false);
    hManual.session.onStudioUnmount();
    expect(hManual.calls).toEqual([]);

    const hAuto = createHarness({ autoTranslate: true, studioActive: true });
    hAuto.session.onStudioMount();
    expect(hAuto.calls).toEqual([]);
    hAuto.setStudioActive(false);
    hAuto.session.onStudioUnmount();
    expect(hAuto.calls).toEqual(["startTranslation"]);
  });

  test("SPA, delta, dict, and config updates rescan Studio and never trigger translation while Studio is active", () => {
    const h = createHarness({
      autoTranslate: true,
      studioActive: true,
      translated: false,
    });

    h.session.onSpaSettled();
    h.session.onDeltaSaved();
    h.session.onDictUpdated();
    h.session.onDictUpdated(true);
    h.session.onConfigUpdated(true);
    h.session.onConfigUpdated(false);

    expect(h.calls).toEqual([
      "rescanStudio",
      "rescanStudio",
      "rescanStudio",
      "rescanStudio",
    ]);
    expect(h.calls).not.toContain("startTranslation");
    expect(h.calls).not.toContain("spaNavigate");
    expect(h.calls).not.toContain("clearCacheAndRestart");
  });

  test("SPA, delta, dict, and config updates trigger normal translation flows when Studio is inactive", () => {
    const h = createHarness({
      autoTranslate: false,
      studioActive: false,
      translated: true,
    });

    h.session.onSpaSettled();
    h.session.onDeltaSaved();
    h.session.onDictUpdated();
    h.session.onConfigUpdated(true);
    h.session.onConfigUpdated(false);

    expect(h.calls).toEqual([
      "spaNavigate",
      "clearCacheAndRestart",
      "clearCacheAndRestart",
      "clearCacheAndRestart",
    ]);
  });

  test("manual preview toggle inside Studio starts translation and keeps translated state if exited while translated", () => {
    const h = createHarness({
      autoTranslate: false,
      studioActive: true,
      tabActive: true,
      translated: true,
    });

    h.session.onStudioMount();
    expect(h.session.suspendedForStudio).toBe(true);
    expect(h.isTranslated()).toBe(false);

    h.session.onToggleTranslate();
    expect(h.session.suspendedForStudio).toBe(false);
    expect(h.isTranslated()).toBe(true);

    h.setStudioActive(false);
    h.session.onStudioUnmount();
    expect(h.session.suspendedForStudio).toBe(false);
    expect(h.isTranslated()).toBe(true);
    expect(h.calls).toEqual(["restoreForStudio", "startTranslation"]);
  });

  test("restoring back to original inside Studio clears non-auto suspension so exit obeys autoTranslate", () => {
    const hManual = createHarness({
      autoTranslate: false,
      studioActive: true,
      tabActive: true,
      translated: true,
    });

    hManual.session.onStudioMount();
    expect(hManual.session.suspendedForStudio).toBe(true);

    // Preview translate then restore inside Studio
    hManual.session.onToggleTranslate();
    expect(hManual.session.suspendedForStudio).toBe(false);
    hManual.session.onToggleTranslate();
    expect(hManual.session.suspendedForStudio).toBe(false);
    expect(hManual.isTranslated()).toBe(false);

    hManual.setStudioActive(false);
    hManual.session.onStudioUnmount();
    expect(hManual.isTranslated()).toBe(false);
    expect(hManual.calls).toEqual([
      "restoreForStudio",
      "startTranslation",
      "stopTranslation",
    ]);

    const hAuto = createHarness({
      autoTranslate: true,
      studioActive: true,
      tabActive: true,
      translated: true,
    });
    hAuto.session.onStudioMount();
    hAuto.session.onToggleTranslate();
    hAuto.session.onToggleTranslate();
    expect(hAuto.session.suspendedForStudio).toBe(false);
    hAuto.setStudioActive(false);
    hAuto.session.onStudioUnmount();
    expect(hAuto.isTranslated()).toBe(true);
    expect(hAuto.calls).toEqual([
      "restoreForStudio",
      "startTranslation",
      "stopTranslation",
      "startTranslation",
    ]);
  });
});
