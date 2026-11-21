import { expect, test } from "bun:test";
import { configureGmApi } from "@userscripts/shared";
import { DEFAULT_CONFIG, loadConfig, saveConfig } from "../src/config";

test("loadConfig merges stored partial overrides with defaults", () => {
  const store: Record<string, unknown> = {
    "ptr:config": {
      customFont: '"Noto Sans TC", sans-serif',
      openccMode: "s2twp",
    },
  };
  configureGmApi({
    GM_getValue: (k: string, d?: unknown) => (k in store ? store[k] : d),
    GM_setValue: (k: string, v: unknown) => {
      store[k] = v;
    },
  });
  const cfg = loadConfig();
  expect(cfg.customFont).toBe('"Noto Sans TC", sans-serif');
  expect(cfg.openccMode).toBe("s2twp");
  expect(cfg.autoSpacing).toBe(DEFAULT_CONFIG.autoSpacing);
  expect(cfg.provider).toBe("translate-pa");
  expect(cfg.themeMode).toBe("system");
});

test("saveConfig persists merged updates", () => {
  const store: Record<string, unknown> = {};
  configureGmApi({
    GM_getValue: (k: string, d?: unknown) => (k in store ? store[k] : d),
    GM_setValue: (k: string, v: unknown) => {
      store[k] = v;
    },
  });
  const next = saveConfig({
    autoSpacing: false,
    debugInspect: true,
    themeMode: "host",
  });
  expect(next.autoSpacing).toBe(false);
  expect(next.debugInspect).toBe(true);
  expect(next.themeMode).toBe("host");
  expect(loadConfig().debugInspect).toBe(true);
  expect(loadConfig().themeMode).toBe("host");
});
