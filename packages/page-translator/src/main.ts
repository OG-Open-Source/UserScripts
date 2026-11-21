import {
  configureGmApi,
  createI18n,
  gmMenuCommand,
  gmSet,
  isManagerPage,
  MANAGER_URL,
  publishPresence,
} from "@userscripts/shared";
import {
  GM_addStyle,
  GM_getValue,
  GM_registerMenuCommand,
  GM_setValue,
  GM_unregisterMenuCommand,
  GM_xmlhttpRequest,
  unsafeWindow,
} from "$";
import type { ViewportObserverHandle } from "./capture/observer";
import { createViewportObserver } from "./capture/observer";
import type { TranslatorConfig } from "./config";
import { loadConfig, resolveSpacingMode, saveConfig } from "./config";
import type { RemoteDeltasFile } from "./deltas-remote";
import { EMPTY_REMOTE_DELTAS, loadRemoteDeltas } from "./deltas-remote";
import { formatPtrMsg, MESSAGES_EN } from "./i18n";
import { createInspectController } from "./inspect";
import { watchSpaNavigation } from "./lifecycle";
import { createPtrMetrics } from "./metrics";
import { restoreAll } from "./renderer";
import { resolveSiteDeltaForHost } from "./site-rules";
import { syncShadowRootsOnly, syncStylesheet } from "./styles";
import { probeChromeLanguageDetector } from "./transform/lang-route";
import { createOpenCC } from "./transform/opencc";
import { createInspectProvider } from "./translate/provider";
import { createBatchRunner } from "./translate/runner";
import { createTranslatePaProvider } from "./translate/translate-pa";
import type { SiteTranslationsFile } from "./translations-remote";
import {
  deleteCachedSiteTranslations,
  listCachedSiteTranslations,
  loadSiteTranslations,
  pickLocaleTable,
  saveCachedSiteTranslations,
} from "./translations-remote";
import { createVolunteerController } from "./volunteer";

declare const __LOCALE_URL__: string;
declare const __DELTAS_URL__: string;
declare const __TRANSLATIONS_BASE__: string;
declare const __SCRIPT_ID__: string;
declare const __SCRIPT_NAME__: string;
declare const __SCRIPT_DESCRIPTION__: string;

configureGmApi({
  GM_addStyle,
  GM_xmlhttpRequest,
  GM_getValue,
  GM_setValue,
  GM_registerMenuCommand,
  GM_unregisterMenuCommand,
});

publishPresence({
  id: __SCRIPT_ID__,
  name: __SCRIPT_NAME__,
  description: __SCRIPT_DESCRIPTION__,
  localeUrl: __LOCALE_URL__,
});

const ON_MANAGER = isManagerPage();

const knownShadowRoots = new Set<ShadowRoot>();

const TAB_ACTIVE_KEY = "ptr:tab-active";

function readTabActive(): boolean {
  try {
    return sessionStorage.getItem(TAB_ACTIVE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistTabActive(active: boolean): void {
  try {
    sessionStorage.setItem(TAB_ACTIVE_KEY, active ? "1" : "0");
  } catch {
    // sessionStorage can be unavailable or restricted; translation must not throw.
  }
}

function buildStyleOpts(cfg = loadConfig()) {
  return {
    customCss: cfg.customCss,
    customFont: cfg.customFont,
    debugInspect: cfg.debugInspect,
    spacingMode: resolveSpacingMode(cfg),
  };
}

function syncAllStyles(cfg = loadConfig()): void {
  syncStylesheet(document, buildStyleOpts(cfg), knownShadowRoots);
}

let onThemeUpdated: (() => void) | null = null;

window.addEventListener("userscript:settings", (event: Event) => {
  const detail = (
    event as CustomEvent<{
      lang?: string;
      ptr?: Partial<TranslatorConfig>;
      themeMode?: TranslatorConfig["themeMode"];
    }>
  ).detail;
  if (detail?.lang) {
    gmSet("lang", detail.lang);
  }
  const ptrPatch: Partial<TranslatorConfig> | undefined = detail?.ptr
    ? { ...detail.ptr }
    : detail?.themeMode
      ? { themeMode: detail.themeMode }
      : undefined;
  if (ptrPatch) {
    const next = saveConfig(ptrPatch);
    if (!ON_MANAGER) {
      syncAllStyles(next);
      onThemeUpdated?.();
    }
  }
});

if (ON_MANAGER) {
  window.addEventListener("userscript:ptr-request-config", () => {
    window.dispatchEvent(
      new CustomEvent("userscript:ptr-config", { detail: loadConfig() })
    );
  });
  window.addEventListener("userscript:ptr-request-dicts", () => {
    window.dispatchEvent(
      new CustomEvent("userscript:ptr-dicts", {
        detail: listCachedSiteTranslations(),
      })
    );
  });
  window.addEventListener("userscript:ptr-save-dict", (event: Event) => {
    const file = (event as CustomEvent<SiteTranslationsFile>).detail;
    if (!file) {
      return;
    }
    try {
      saveCachedSiteTranslations(file);
      window.dispatchEvent(
        new CustomEvent("userscript:ptr-dicts", {
          detail: listCachedSiteTranslations(),
        })
      );
    } catch {
      // Ignore malformed payloads from untrusted page dispatches
    }
  });
  window.addEventListener("userscript:ptr-delete-dict", (event: Event) => {
    const host = (event as CustomEvent<{ host?: string }>).detail?.host;
    if (!host) {
      return;
    }
    deleteCachedSiteTranslations(host);
    window.dispatchEvent(
      new CustomEvent("userscript:ptr-dicts", {
        detail: listCachedSiteTranslations(),
      })
    );
  });
} else {
  boot();
}

async function boot(): Promise<void> {
  let remoteDeltas: RemoteDeltasFile = EMPTY_REMOTE_DELTAS;
  let siteTranslations: SiteTranslationsFile | null = null;

  const [i18n, loadedDeltas, loadedSiteTr] = await Promise.all([
    createI18n({
      source: { scriptId: __SCRIPT_ID__, url: __LOCALE_URL__ },
      fallback: MESSAGES_EN,
    }),
    loadRemoteDeltas(__DELTAS_URL__, (next) => {
      remoteDeltas = next;
    }),
    loadSiteTranslations(__TRANSLATIONS_BASE__, location.hostname, (next) => {
      siteTranslations = next;
    }),
  ]);
  remoteDeltas = loadedDeltas;
  siteTranslations = loadedSiteTr;

  const metrics = createPtrMetrics();

  function syncDictMetrics(): void {
    metrics.dictLoaded = siteTranslations !== null;
    const table = getActiveLocaleTable();
    if (table) {
      metrics.dictCounts = {
        static: Object.keys(table.static ?? {}).length,
        dynamic: Object.keys(table.dynamic ?? {}).length,
        scoped: Object.keys(table.scoped ?? {}).length,
      };
    }
  }

  function refreshSiteTranslations(): void {
    loadSiteTranslations(__TRANSLATIONS_BASE__, location.hostname, (next) => {
      siteTranslations = next;
      syncDictMetrics();
    }).then((refreshed) => {
      if (refreshed) {
        siteTranslations = refreshed;
        syncDictMetrics();
      }
    });
  }

  syncDictMetrics();

  let activeObserver: ViewportObserverHandle | null = null;
  let activeRunner: ReturnType<typeof createBatchRunner> | null = null;
  let translationActive = false;

  function resolveCurrentDelta() {
    const cfg = loadConfig();
    return resolveSiteDeltaForHost(
      location.hostname,
      cfg.siteDeltas,
      remoteDeltas.sites
    );
  }

  function getActiveLocaleTable() {
    return pickLocaleTable(siteTranslations, loadConfig().targetLang);
  }

  function registerShadowRoots(roots: Set<ShadowRoot>): void {
    const added: ShadowRoot[] = [];
    for (const sr of roots) {
      if (!knownShadowRoots.has(sr)) {
        knownShadowRoots.add(sr);
        added.push(sr);
      }
    }
    if (added.length > 0) {
      syncShadowRootsOnly(document, buildStyleOpts(), added);
    }
  }

  function pruneDisconnectedShadowRoots(): void {
    for (const sr of knownShadowRoots) {
      if (!sr.host.isConnected) {
        knownShadowRoots.delete(sr);
      }
    }
  }

  function startTranslation(): void {
    stopTranslation(false);
    translationActive = true;
    const cfg = loadConfig();
    syncAllStyles(cfg);
    const delta = resolveCurrentDelta();
    metrics.deltaCounts = {
      add: delta.addSelectors.length,
      remove: delta.removeSelectors.length,
      mod: delta.modRules.length,
    };
    probeChromeLanguageDetector().then((status) => {
      metrics.languageDetectorStatus = status;
    });
    const root = document.body ?? document.documentElement;
    activeRunner = createBatchRunner({
      doc: document,
      delta,
      coalesceMs: 25,
      getConfig: loadConfig,
      getProvider: (c) =>
        c.provider === "inspect"
          ? createInspectProvider()
          : createTranslatePaProvider({ apiKey: c.translatePaApiKey }),
      getOpenCC: (mode) => createOpenCC(mode),
      getGlossary: () => remoteDeltas.glossary,
      getSiteLocaleTable: getActiveLocaleTable,
      metrics,
    });
    const runner = activeRunner;
    activeObserver = createViewportObserver({
      root,
      delta,
      metrics,
      onShadowRoots: registerShadowRoots,
      onVisibleSegments(segs) {
        runner.translateBatch(segs);
      },
    });
    activeObserver.scan(root);
    persistTabActive(true);
  }

  function stopTranslation(clearActiveFlag = true): void {
    if (clearActiveFlag) {
      translationActive = false;
      persistTabActive(false);
    }
    activeRunner?.cancelAll();
    activeRunner = null;
    activeObserver?.stop();
    activeObserver = null;
    restoreAll(document);
    for (const sr of knownShadowRoots) {
      restoreAll(sr);
    }
  }

  const inspectController = createInspectController({
    doc: document,
    hostname: location.hostname,
    metrics,
    t: i18n.t,
    getThemeMode: () => loadConfig().themeMode,
    getTargetLang: () => loadConfig().targetLang,
    getDelta: resolveCurrentDelta,
    isEnabled: () => loadConfig().debugInspect,
    setEnabled: (next) => {
      saveConfig({ debugInspect: next });
    },
    formatLabel: (on) =>
      formatPtrMsg(i18n.t("inspectMode"), {
        state: i18n.t(on ? "on" : "off"),
      }),
    onAfterChange: () => syncAllStyles(),
    onShadowRoots: registerShadowRoots,
    getSiteLocaleTable: getActiveLocaleTable,
    getSpacingMode: () => resolveSpacingMode(loadConfig()),
    getPunctNorm: () => loadConfig().punctNorm,
  });

  const volunteerController = createVolunteerController({
    doc: document,
    hostname: location.hostname,
    pathname: location.pathname,
    t: i18n.t,
    getThemeMode: () => loadConfig().themeMode,
    getTargetLang: () => loadConfig().targetLang,
    getDelta: resolveCurrentDelta,
    getSiteLocaleTable: getActiveLocaleTable,
    isEnabled: () => loadConfig().volunteerMode,
    setEnabled: (next) => {
      saveConfig({
        volunteerMode: next,
        ...(next ? {} : { volunteerBlockClicks: false }),
      });
    },
    formatLabel: (on) =>
      formatPtrMsg(i18n.t("volunteerMode"), {
        state: i18n.t(on ? "on" : "off"),
      }),
    isClickBlocked: () => loadConfig().volunteerBlockClicks,
    setClickBlocked: (next) => {
      saveConfig({ volunteerBlockClicks: next });
    },
    formatClickBlockLabel: (blocked) =>
      formatPtrMsg(i18n.t("volunteerBlockClicks"), {
        state: i18n.t(blocked ? "on" : "off"),
      }),
  });

  onThemeUpdated = () => {
    inspectController.refreshTheme();
    volunteerController.refreshTheme();
  };

  syncAllStyles();
  inspectController.syncFromConfig();
  volunteerController.syncFromConfig();

  watchSpaNavigation({
    win: typeof unsafeWindow === "undefined" ? window : unsafeWindow,
    onBeforeLeave() {
      const wasActive = translationActive;
      stopTranslation(false);
      translationActive = wasActive;
      inspectController.stop();
    },
    onSettled() {
      pruneDisconnectedShadowRoots();
      syncAllStyles();
      inspectController.syncFromConfig();
      volunteerController.refresh();
      if (translationActive || loadConfig().autoTranslate) {
        startTranslation();
      }
      refreshSiteTranslations();
    },
  });

  gmMenuCommand(i18n.t("translatePage"), startTranslation);
  gmMenuCommand(i18n.t("restorePage"), () => stopTranslation(true));
  inspectController.registerMenu();
  volunteerController.registerMenu();
  gmMenuCommand(i18n.t("openSettings"), () => {
    window.open(`${MANAGER_URL}/settings/translate/`, "_blank", "noopener");
  });

  if (loadConfig().autoTranslate || readTabActive()) {
    startTranslation();
  }
}
