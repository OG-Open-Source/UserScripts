import { expect, test } from "bun:test";
import { configureGmApi } from "@userscripts/shared";
import { Window } from "happy-dom";
import { attachSettingsBridge } from "../../src/platform/bridge";
import type { TranslatorConfig } from "../../src/platform/config";
import { loadConfig } from "../../src/platform/config";

test("attachSettingsBridge handles userscript:settings and manager dict/config events", () => {
  const store: Record<string, unknown> = {};
  configureGmApi({
    GM_getValue: (k: string, d?: unknown) => (k in store ? store[k] : d),
    GM_setValue: (k: string, v: unknown) => {
      store[k] = v;
    },
  });

  const win = new Window() as unknown as Window;
  let updated: TranslatorConfig | null = null;
  const detachPage = attachSettingsBridge({
    win,
    onManagerPage: false,
    onConfigUpdated: (cfg) => {
      updated = cfg;
    },
  });

  win.dispatchEvent(
    new win.CustomEvent("userscript:settings", {
      detail: { lang: "zh-TW", ptr: { targetLang: "ja", uiTier: "studio" } },
    })
  );
  expect(store.lang).toBe("zh-TW");
  expect(updated?.targetLang).toBe("ja");
  expect(updated?.uiTier).toBe("studio");
  detachPage();

  let receivedConfig: TranslatorConfig | null = null;
  let receivedDicts: unknown[] = [];
  win.addEventListener("userscript:ptr-config", (e: Event) => {
    receivedConfig = (e as CustomEvent<TranslatorConfig>).detail;
  });
  win.addEventListener("userscript:ptr-dicts", (e: Event) => {
    receivedDicts = (e as CustomEvent<unknown[]>).detail;
  });

  const detachManager = attachSettingsBridge({ win, onManagerPage: true });
  win.dispatchEvent(new win.CustomEvent("userscript:ptr-request-config"));
  expect(receivedConfig?.targetLang).toBe(loadConfig().targetLang);

  win.dispatchEvent(
    new win.CustomEvent("userscript:ptr-save-dict", {
      detail: {
        version: 1,
        host: "example.com",
        locales: { "zh-TW": { static: { Hello: "你好" }, dynamic: {} } },
      },
    })
  );
  expect(receivedDicts.length).toBe(1);

  win.dispatchEvent(
    new win.CustomEvent("userscript:ptr-delete-dict", {
      detail: { host: "example.com" },
    })
  );
  expect(receivedDicts.length).toBe(0);
  detachManager();
});
