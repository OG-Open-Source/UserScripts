import { gmSet } from "@userscripts/shared";
import type { SiteTranslationsFile } from "../dict/store";
import {
  deleteLayeredSiteTranslations,
  listLayeredSiteTranslations,
  saveLocalSiteTranslations,
} from "../dict/store";
import type { ConfigPatch, TranslatorConfig } from "./config";
import { loadConfig, saveConfig } from "./config";

export interface SettingsBridgeOptions {
  onConfigUpdated?: (next: TranslatorConfig) => void;
  onManagerPage: boolean;
  win?: Window;
}

export function attachSettingsBridge(
  options: SettingsBridgeOptions
): () => void {
  const win = options.win ?? window;

  const onSettings = (event: Event): void => {
    const { detail } = event as CustomEvent<{
      lang?: string;
      ptr?: ConfigPatch;
      themeMode?: TranslatorConfig["themeMode"] | string;
    }>;
    if (detail?.lang) {
      gmSet("lang", detail.lang);
    }
    let ptrPatch: ConfigPatch | undefined;
    if (detail?.ptr) {
      ptrPatch = { ...detail.ptr };
    } else if (detail?.themeMode) {
      ptrPatch = { themeMode: detail.themeMode };
    }
    if (ptrPatch) {
      const next = saveConfig(ptrPatch);
      if (!options.onManagerPage) {
        options.onConfigUpdated?.(next);
      }
    }
  };

  win.addEventListener("userscript:settings", onSettings);

  if (!options.onManagerPage) {
    return () => {
      win.removeEventListener("userscript:settings", onSettings);
    };
  }

  const EventCtor =
    (win as unknown as { CustomEvent?: typeof CustomEvent }).CustomEvent ??
    CustomEvent;

  const onRequestConfig = (): void => {
    win.dispatchEvent(
      new EventCtor("userscript:ptr-config", { detail: loadConfig() })
    );
  };

  const onRequestDicts = (): void => {
    win.dispatchEvent(
      new EventCtor("userscript:ptr-dicts", {
        detail: listLayeredSiteTranslations(),
      })
    );
  };

  const onSaveDict = (event: Event): void => {
    const file = (event as CustomEvent<SiteTranslationsFile>).detail;
    if (!file) {
      return;
    }
    try {
      saveLocalSiteTranslations(file);
      win.dispatchEvent(
        new EventCtor("userscript:ptr-dicts", {
          detail: listLayeredSiteTranslations(),
        })
      );
    } catch {
      // Ignore malformed payloads from untrusted page dispatches
    }
  };

  const onDeleteDict = (event: Event): void => {
    const host = (event as CustomEvent<{ host?: string }>).detail?.host;
    if (!host) {
      return;
    }
    deleteLayeredSiteTranslations(host);
    win.dispatchEvent(
      new EventCtor("userscript:ptr-dicts", {
        detail: listLayeredSiteTranslations(),
      })
    );
  };

  win.addEventListener("userscript:ptr-request-config", onRequestConfig);
  win.addEventListener("userscript:ptr-request-dicts", onRequestDicts);
  win.addEventListener("userscript:ptr-save-dict", onSaveDict);
  win.addEventListener("userscript:ptr-delete-dict", onDeleteDict);

  return () => {
    win.removeEventListener("userscript:settings", onSettings);
    win.removeEventListener("userscript:ptr-request-config", onRequestConfig);
    win.removeEventListener("userscript:ptr-request-dicts", onRequestDicts);
    win.removeEventListener("userscript:ptr-save-dict", onSaveDict);
    win.removeEventListener("userscript:ptr-delete-dict", onDeleteDict);
  };
}
