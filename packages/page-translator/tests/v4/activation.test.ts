import { expect, test } from "bun:test";
import {
  createTabActivationManager,
  isActive,
  setTabActive,
} from "../../src/platform/activation";
import type { TranslatorConfig } from "../../src/platform/config";
import { DEFAULT_CONFIG, loadConfig } from "../../src/platform/config";

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

function createMemoryConfigStorage() {
  const values = new Map<string, unknown>();
  const storage = {
    values,
    writes: 0,
    get<T>(key: string, defaultValue: T): T {
      return (values.get(key) as T | undefined) ?? defaultValue;
    },
    set(key: string, value: unknown): void {
      storage.writes += 1;
      values.set(key, value);
    },
  };
  return storage;
}

function config(patch: Partial<TranslatorConfig> = {}): TranslatorConfig {
  return { ...DEFAULT_CONFIG, ...patch };
}

test("session override wins over the new-tab config default", () => {
  const storage = new MemoryTabStorage();
  const cfg = config({ defaultInspect: false, defaultVolunteer: true });

  expect(isActive("inspect", { config: cfg, storage })).toBe(false);
  setTabActive("inspect", true, { storage });
  expect(isActive("inspect", { config: cfg, storage })).toBe(true);

  setTabActive("volunteer", false, { storage });
  expect(isActive("volunteer", { config: cfg, storage })).toBe(false);
});

test("a fresh tab without an override uses the current new-tab default", () => {
  const storage = new MemoryTabStorage();
  expect(
    isActive("inspect", {
      config: config({ defaultInspect: true }),
      storage,
    })
  ).toBe(true);
  expect(
    isActive("volunteer", {
      config: config({ defaultVolunteer: false }),
      storage,
    })
  ).toBe(false);
});

test("legacy true values migrate defaults without force-activating an open tab", () => {
  const gm = createMemoryConfigStorage();
  const openTabStorage = new MemoryTabStorage();
  let current = config({ defaultInspect: false, defaultVolunteer: false });
  const alreadyOpen = createTabActivationManager({
    getConfig: () => current,
    storage: openTabStorage,
  });

  expect(alreadyOpen.isActive("inspect")).toBe(false);
  expect(alreadyOpen.isActive("volunteer")).toBe(false);

  gm.values.set("ptr:config", {
    debugInspect: true,
    volunteerMode: true,
  });
  current = loadConfig({ storage: gm });
  expect(current.defaultInspect).toBe(true);
  expect(current.defaultVolunteer).toBe(true);
  expect(alreadyOpen.isActive("inspect")).toBe(false);
  expect(alreadyOpen.isActive("volunteer")).toBe(false);

  const freshTab = createTabActivationManager({
    getConfig: () => current,
    storage: new MemoryTabStorage(),
  });
  expect(freshTab.isActive("inspect")).toBe(true);
  expect(freshTab.isActive("volunteer")).toBe(true);
});

test("toggling Tab A does not activate Tab B or write shared config", () => {
  const gm = createMemoryConfigStorage();
  const cfg = config();
  const tabA = new MemoryTabStorage();
  const tabB = new MemoryTabStorage();
  const managerA = createTabActivationManager({
    getConfig: () => cfg,
    storage: tabA,
  });
  const managerB = createTabActivationManager({
    getConfig: () => cfg,
    storage: tabB,
  });

  managerA.setActive("inspect", true);
  managerA.setActive("volunteer", true);

  expect(managerA.isActive("inspect")).toBe(true);
  expect(managerA.isActive("volunteer")).toBe(true);
  expect(managerB.isActive("inspect")).toBe(false);
  expect(managerB.isActive("volunteer")).toBe(false);
  expect(gm.writes).toBe(0);
  expect(gm.values.has("ptr:config")).toBe(false);
});

test("clearTabOverride returns a tab to its snapshotted baseline", () => {
  const storage = new MemoryTabStorage();
  let current = config({ defaultInspect: false });
  const manager = createTabActivationManager({
    getConfig: () => current,
    storage,
  });

  manager.setActive("inspect", true);
  expect(manager.isActive("inspect")).toBe(true);
  current = config({ defaultInspect: true });
  manager.clearTabOverride("inspect");
  expect(manager.isActive("inspect")).toBe(false);
});
