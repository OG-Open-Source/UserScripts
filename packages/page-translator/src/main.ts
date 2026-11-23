import {
  configureGmApi,
  createI18n,
  gmMenuCommand,
  isManagerPage,
  isTopFrame,
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
  // biome-ignore lint/correctness/noUnresolvedImports: vite-plugin-monkey virtual module
} from "$";
import type { ViewportObserverHandle } from "./capture/observer";
import { createViewportObserver } from "./capture/observer";
import { createBatchRunner } from "./core/runner";
import type { SiteTranslationsFile } from "./dict/store";
import {
  loadLocalSiteTranslations,
  loadRemoteSiteTranslations,
  mergeLocalSiteLocaleTable,
  mergeSiteTranslations,
  pickLocaleTable,
} from "./dict/store";
import { createUpstreamClient } from "./dict/upstream";
import { attachSettingsBridge } from "./platform/bridge";
import type { TranslatorConfig } from "./platform/config";
import { loadConfig, saveConfig } from "./platform/config";
import type { RemoteDeltasFile } from "./platform/deltas-remote";
import {
  EMPTY_REMOTE_DELTAS,
  loadRemoteDeltas,
} from "./platform/deltas-remote";
import { MESSAGES_EN } from "./platform/i18n";
import {
  createSpaRescanController,
  watchSpaNavigation,
} from "./platform/lifecycle";
import { createPtrMetrics } from "./platform/metrics";
import { createHumanOnlyProvider } from "./providers/human-only";
import { createInspectProvider } from "./providers/inspect";
import { createTranslatePaProvider } from "./providers/translate-pa";
import { restoreAll } from "./render/renderer";
import { syncShadowRootsOnly, syncStylesheet } from "./render/styles";
import type { SiteStructureAdapter } from "./structure/adapter";
import { createDiscourseAdapter } from "./structure/discourse";
import { load as loadFingerprint } from "./structure/fingerprints";
import { createGitHubAdapter } from "./structure/github";
import { resolveAdapter } from "./structure/registry";
import { resolveSiteDeltaForHost } from "./structure/site-rules";
import { createOpenCC } from "./text/opencc";
import { createBasicController } from "./ui/basic";
import { createInspectController } from "./ui/studio/inspect";
import { createVolunteerController } from "./ui/studio/volunteer";

declare const __LOCALE_URL__: string;
declare const __DELTAS_URL__: string;
declare const __TRANSLATIONS_BASE__: string;
declare const __FINGERPRINTS_BASE__: string;
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

function buildStyleOpts(cfg = loadConfig(), debugInspect = false) {
  return {
    customCss: cfg.customCss,
    customFont: cfg.customFont,
    debugInspect,
    spacingMode: cfg.spacingMode,
  };
}

let onConfigUpdated: ((next: TranslatorConfig) => void) | null = null;

if (isTopFrame()) {
  publishPresence({
    id: __SCRIPT_ID__,
    name: __SCRIPT_NAME__,
    description: __SCRIPT_DESCRIPTION__,
    localeUrl: __LOCALE_URL__,
  });

  attachSettingsBridge({
    onManagerPage: ON_MANAGER,
    onConfigUpdated: (next) => {
      onConfigUpdated?.(next);
    },
  });

  if (!ON_MANAGER) {
    void boot();
  }
}

async function boot(): Promise<void> {
  const host = location.hostname;
  let remoteDeltas: RemoteDeltasFile = EMPTY_REMOTE_DELTAS;
  let remoteSiteTranslations: SiteTranslationsFile | null =
    loadRemoteSiteTranslations(host);
  let localSiteTranslations: SiteTranslationsFile | null =
    loadLocalSiteTranslations(host);
  let siteTranslations: SiteTranslationsFile | null = mergeSiteTranslations(
    remoteSiteTranslations,
    localSiteTranslations
  );
  let onSiteDictUpdated: (() => void) | null = null;

  function recomputeSiteTranslations(): void {
    siteTranslations = mergeSiteTranslations(
      remoteSiteTranslations,
      localSiteTranslations
    );
  }

  const [i18n, loadedDeltas] = await Promise.all([
    createI18n({
      source: { scriptId: __SCRIPT_ID__, url: __LOCALE_URL__ },
      fallback: MESSAGES_EN,
    }),
    loadRemoteDeltas(__DELTAS_URL__, (next) => {
      remoteDeltas = next;
    }),
  ]);
  remoteDeltas = loadedDeltas;

  const metrics = createPtrMetrics();
  let adapter: SiteStructureAdapter = resolveAdapter({ host, doc: document });

  if (adapter.id === "discourse" || adapter.id === "github") {
    void loadFingerprint(adapter.id, {
      remoteBaseUrl: __FINGERPRINTS_BASE__,
      onUpdate: (next) => {
        adapter =
          next.id === "discourse"
            ? createDiscourseAdapter(next)
            : createGitHubAdapter(next);
      },
    }).then((fp) => {
      adapter =
        fp.id === "discourse"
          ? createDiscourseAdapter(fp)
          : createGitHubAdapter(fp);
    });
  }

  const upstream = createUpstreamClient({
    baseUrl: __TRANSLATIONS_BASE__,
    onUpdate: (next) => {
      if (next.host.toLowerCase() === host.toLowerCase()) {
        remoteSiteTranslations = next;
        recomputeSiteTranslations();
        onSiteDictUpdated?.();
      }
    },
  });

  function getActiveLocaleTable() {
    return pickLocaleTable(siteTranslations, loadConfig().targetLang);
  }

  function syncDictMetrics(): void {
    metrics.dictLoaded = siteTranslations !== null;
    const table = getActiveLocaleTable();
    metrics.dictCounts = table
      ? {
          static: Object.keys(table.static ?? {}).length,
          dynamic: Object.keys(table.dynamic ?? {}).length,
          scoped: Object.keys(table.scoped ?? {}).length,
        }
      : { static: 0, dynamic: 0, scoped: 0 };
  }

  syncDictMetrics();

  let activeObserver: ViewportObserverHandle | null = null;
  let activeRunner: ReturnType<typeof createBatchRunner> | null = null;
  let translationActive = false;

  function resolveCurrentDelta() {
    const cfg = loadConfig();
    return resolveSiteDeltaForHost(host, cfg.siteDeltas, remoteDeltas.sites);
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
      syncShadowRootsOnly(
        document,
        buildStyleOpts(loadConfig(), inspectController.isActive()),
        added
      );
    }
  }

  function pruneDisconnectedShadowRoots(): void {
    for (const sr of knownShadowRoots) {
      if (!sr.host.isConnected) {
        knownShadowRoots.delete(sr);
      }
    }
  }

  function syncAllStyles(cfg = loadConfig()): void {
    syncStylesheet(
      document,
      buildStyleOpts(cfg, inspectController.isActive()),
      knownShadowRoots
    );
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
    const root = document.body ?? document.documentElement;
    activeRunner = createBatchRunner({
      doc: document,
      delta,
      coalesceMs: 25,
      getConfig: loadConfig,
      getProvider: (c) => {
        if (c.provider === "inspect") {
          return createInspectProvider();
        }
        if (c.provider === "human-only") {
          return createHumanOnlyProvider();
        }
        return createTranslatePaProvider({ apiKey: c.translatePaApiKey });
      },
      getOpenCC: (mode) => createOpenCC(mode),
      getGlossary: () => remoteDeltas.glossary,
      getSiteLocaleTable: getActiveLocaleTable,
      host,
      upstream,
      metrics,
    });
    const runner = activeRunner;
    activeObserver = createViewportObserver({
      root,
      delta,
      getAdapter: () => adapter,
      metrics,
      onShadowRoots: registerShadowRoots,
      onVisibleSegments(segs) {
        void runner.translateBatch(segs);
      },
    });
    activeObserver.scan(root);
    persistTabActive(true);
    basicController.setTranslated(true);
  }

  function stopTranslation(clearActiveFlag = true): void {
    if (clearActiveFlag) {
      translationActive = false;
      persistTabActive(false);
      basicController.setTranslated(false);
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
    getConfig: loadConfig,
    getDelta: resolveCurrentDelta,
    getMetrics: () => metrics,
    getSiteLocaleTable: getActiveLocaleTable,
    onToggle: () => {
      syncAllStyles();
    },
    t: i18n.t,
  });

  const volunteerController = createVolunteerController({
    doc: document,
    hostname: host,
    getConfig: loadConfig,
    getDelta: resolveCurrentDelta,
    getSiteLocaleTable: getActiveLocaleTable,
    getLocalLocaleTable: () =>
      pickLocaleTable(localSiteTranslations, loadConfig().targetLang),
    getTargetLang: () => loadConfig().targetLang,
    onSyncLocalTable: (patch) => {
      localSiteTranslations = mergeLocalSiteLocaleTable(
        host,
        loadConfig().targetLang,
        patch
      );
      recomputeSiteTranslations();
    },
    onSiteDictUpdated: () => {
      onSiteDictUpdated?.();
    },
    isClickBlocked: () => loadConfig().volunteerBlockClicks,
    setClickBlocked: (next) => {
      saveConfig({ volunteerBlockClicks: next });
    },
    t: i18n.t,
  });

  const basicController = createBasicController({
    doc: document,
    getConfig: loadConfig,
    isTranslated: () => translationActive,
    onToggleTranslate: () => {
      if (translationActive) {
        stopTranslation(true);
      } else {
        startTranslation();
      }
    },
    onToggleInspect: () => {
      inspectController.toggle();
    },
    onToggleVolunteer: () => {
      volunteerController.toggle();
    },
    onStudioMount: () => {
      inspectController.syncFromConfig();
      volunteerController.syncFromConfig();
      syncAllStyles();
    },
    onStudioUnmount: () => {
      inspectController.syncFromConfig();
      volunteerController.syncFromConfig();
      syncAllStyles();
    },
    onOpenSettings: () => {
      window.open(`${MANAGER_URL}/settings/translate/`, "_blank", "noopener");
    },
    setTargetLang: (lang) => {
      saveConfig({ targetLang: lang });
      if (translationActive) {
        activeRunner?.clearCache();
        startTranslation();
      }
    },
    setCustomCss: (css) => {
      saveConfig({ customCss: css });
      syncAllStyles();
    },
    setCustomFont: (font) => {
      saveConfig({ customFont: font });
      syncAllStyles();
    },
    setUiTier: (tier) => {
      saveConfig({ uiTier: tier });
    },
    t: i18n.t,
  });

  onSiteDictUpdated = () => {
    syncDictMetrics();
    inspectController.syncFromConfig();
    volunteerController.rescan();
    if (translationActive) {
      activeRunner?.clearCache();
      startTranslation();
    }
  };

  onConfigUpdated = (next) => {
    syncAllStyles(next);
    basicController.syncFromConfig();
    inspectController.syncFromConfig();
    volunteerController.syncFromConfig();
  };

  syncAllStyles();
  basicController.syncFromConfig();
  inspectController.syncFromConfig();
  volunteerController.syncFromConfig();

  const spaRescan = createSpaRescanController({
    getAdapter: () => adapter,
    rescan(regions, ctx) {
      if (!ctx.isCurrent()) {
        return;
      }
      if (!activeObserver) {
        startTranslation();
        return;
      }
      for (const region of regions) {
        if (!ctx.isCurrent()) {
          return;
        }
        activeObserver.scan(region);
      }
    },
  });

  watchSpaNavigation({
    win: typeof unsafeWindow === "undefined" ? window : unsafeWindow,
    onBeforeLeave() {
      spaRescan.cancel();
      activeRunner?.cancelAll();
    },
    onSettled() {
      pruneDisconnectedShadowRoots();
      syncAllStyles();
      inspectController.syncFromConfig();
      if (volunteerController.isActive()) {
        volunteerController.rescan();
      }
      if (translationActive || loadConfig().autoTranslate) {
        void spaRescan.onSpaNavigate(document);
      }
    },
  });

  gmMenuCommand(i18n.t("translatePage"), startTranslation);
  gmMenuCommand(i18n.t("restorePage"), () => stopTranslation(true));
  gmMenuCommand(i18n.t("studioMode"), () => {
    const nextTier = loadConfig().uiTier === "studio" ? "basic" : "studio";
    saveConfig({ uiTier: nextTier });
    basicController.syncFromConfig();
  });
  gmMenuCommand(i18n.t("inspectMode"), () => {
    if (loadConfig().uiTier === "studio") {
      inspectController.toggle();
    }
  });
  gmMenuCommand(i18n.t("volunteerMode"), () => {
    if (loadConfig().uiTier === "studio") {
      volunteerController.toggle();
    }
  });
  gmMenuCommand(i18n.t("openSettings"), () => {
    window.open(`${MANAGER_URL}/settings/translate/`, "_blank", "noopener");
  });

  if (loadConfig().autoTranslate || readTabActive()) {
    startTranslation();
  }
}
