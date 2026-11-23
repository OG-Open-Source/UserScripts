import { expect, test } from "bun:test";
import {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
} from "../../src/platform/config";

class MemoryConfigStorage {
  readonly values = new Map<string, unknown>();

  get<T>(key: string, defaultValue: T): T {
    return (this.values.get(key) as T | undefined) ?? defaultValue;
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }
}

test("load drops retired fields and migrates legacy defaults and theme", () => {
  const storage = new MemoryConfigStorage();
  storage.values.set("ptr:config", {
    spaceSkippedCjk: true,
    themeMode: "host",
    debugInspect: true,
    volunteerMode: true,
    uiTier: "invalid",
  });

  const cfg = loadConfig({ storage });
  expect(cfg.themeMode).toBe("system");
  expect(cfg.defaultInspect).toBe(true);
  expect(cfg.defaultVolunteer).toBe(true);
  expect(cfg.uiTier).toBe("basic");
  expect("spaceSkippedCjk" in cfg).toBe(false);
  expect("debugInspect" in cfg).toBe(false);
  expect("volunteerMode" in cfg).toBe(false);
});

test("explicit new-tab defaults win over legacy true values", () => {
  const storage = new MemoryConfigStorage();
  storage.values.set("ptr:config", {
    debugInspect: true,
    defaultInspect: false,
    volunteerMode: true,
    defaultVolunteer: false,
  });

  const cfg = loadConfig({ storage });
  expect(cfg.defaultInspect).toBe(false);
  expect(cfg.defaultVolunteer).toBe(false);
});

test("unknown theme and tier values fall back safely", () => {
  const storage = new MemoryConfigStorage();
  storage.values.set("ptr:config", {
    themeMode: "sepia",
    uiTier: true,
  });

  const cfg = loadConfig({ storage });
  expect(cfg.themeMode).toBe("system");
  expect(cfg.uiTier).toBe("basic");
  expect(DEFAULT_CONFIG.uiTier).toBe("basic");
});

test("save persists only clean v4 keys and migrates a legacy patch", () => {
  const storage = new MemoryConfigStorage();
  storage.values.set("ptr:config", {
    spaceSkippedCjk: true,
    debugInspect: true,
    volunteerMode: true,
  });

  const saved = saveConfig(
    {
      themeMode: "host",
      spaceSkippedCjk: true,
      uiTier: "studio",
    },
    { storage }
  );
  const persisted = storage.values.get("ptr:config") as Record<string, unknown>;

  expect(saved.themeMode).toBe("system");
  expect(saved.defaultInspect).toBe(true);
  expect(saved.defaultVolunteer).toBe(true);
  expect(saved.uiTier).toBe("studio");
  expect(persisted).toEqual(saved);
  expect("spaceSkippedCjk" in persisted).toBe(false);
  expect("debugInspect" in persisted).toBe(false);
  expect("volunteerMode" in persisted).toBe(false);
});

test("save accepts a legacy activation patch without retaining its keys", () => {
  const storage = new MemoryConfigStorage();
  const saved = saveConfig(
    { debugInspect: true, volunteerMode: true },
    { storage }
  );

  expect(saved.defaultInspect).toBe(true);
  expect(saved.defaultVolunteer).toBe(true);
  expect("debugInspect" in saved).toBe(false);
  expect("volunteerMode" in saved).toBe(false);
});

test("human-only is accepted as a provider", () => {
  const storage = new MemoryConfigStorage();
  storage.values.set("ptr:config", { provider: "human-only" });
  expect(loadConfig({ storage }).provider).toBe("human-only");

  const saved = saveConfig({ provider: "human-only" }, { storage });
  expect(saved.provider).toBe("human-only");
});

test("invalid provider and storage failures fall back to defaults", () => {
  const storage = new MemoryConfigStorage();
  storage.values.set("ptr:config", { provider: "unknown" });
  expect(loadConfig({ storage }).provider).toBe("translate-pa");

  const throwing = {
    get<T>(_key: string, _defaultValue: T): T {
      throw new Error("storage unavailable");
    },
    set(): void {
      throw new Error("storage unavailable");
    },
  };
  expect(loadConfig({ storage: throwing })).toEqual(DEFAULT_CONFIG);
  expect(() =>
    saveConfig({ uiTier: "studio" }, { storage: throwing })
  ).not.toThrow();
});
