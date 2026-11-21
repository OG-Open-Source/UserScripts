/**
 * Hanime1 Download Manager — userscript entry.
 *
 * Behavior: native-style quality menu, slim Curved-Outside batch download dock,
 * borderless NovaKit non-native UI with 4-mode theme adaptation, and in-page
 * downloads without leaving the page.
 */

import type { ThemeMode } from "@userscripts/shared";
import {
  configureGmApi,
  createI18n,
  gmGet,
  gmSet,
  isManagerPage,
  isTopFrame,
  parseThemeMode,
  probeTheme,
  publishPresence,
  resolveThemeTokens,
} from "@userscripts/shared";
import {
  GM_download,
  GM_getValue,
  GM_registerMenuCommand,
  GM_setValue,
  GM_xmlhttpRequest,
  // biome-ignore lint/correctness/noUnresolvedImports: vite-plugin-monkey virtual module
} from "$";
import { createBatch } from "./batch";
import { createStateMachine, startDownload } from "./download";
import { MESSAGES } from "./i18n";
import { createInject } from "./inject";
import { createMenu } from "./menu";
import {
  buildStylesheetText,
  injectStyles,
  resolveH1dlHostColors,
} from "./styles";

const HOSTS = ["hanime1.com", "hanime1.me", "hanimeone.com", "hanimeone.me"];
const THEME_MODE_KEY = "h1dl:themeMode";

declare const __LOCALE_URL__: string;
declare const __SCRIPT_ID__: string;
declare const __SCRIPT_NAME__: string;
declare const __SCRIPT_DESCRIPTION__: string;

configureGmApi({
  GM_xmlhttpRequest,
  GM_download,
  GM_getValue,
  GM_setValue,
  GM_registerMenuCommand,
});

let currentThemeMode: ThemeMode = "host";
let onLiveThemeChange: ((mode: ThemeMode) => void) | null = null;

if (isTopFrame()) {
  publishPresence({
    id: __SCRIPT_ID__,
    name: __SCRIPT_NAME__,
    description: __SCRIPT_DESCRIPTION__,
    localeUrl: __LOCALE_URL__,
  });

  currentThemeMode = parseThemeMode(
    gmGet<unknown>(THEME_MODE_KEY, "host") === "system" &&
      gmGet<unknown>(THEME_MODE_KEY, null) === null
      ? "host"
      : gmGet<unknown>(THEME_MODE_KEY, "host")
  );

  window.addEventListener("userscript:settings", (event: Event) => {
    const { detail } = event as CustomEvent<{
      lang?: string;
      themeMode?: ThemeMode;
    }>;
    if (detail?.lang) {
      gmSet("lang", detail.lang);
    }
    if (detail?.themeMode) {
      const next = parseThemeMode(detail.themeMode);
      currentThemeMode = next;
      gmSet(THEME_MODE_KEY, next);
      onLiveThemeChange?.(next);
    }
  });

  const ON_MANAGER = isManagerPage();
  if (ON_MANAGER) {
    // Presence only. The download UI does not belong on the manager page.
  } else if (HOSTS.includes(location.hostname)) {
    boot();
  } else {
    throw new Error("[h1dl] not a hanime1 host");
  }
}

function boot(): void {
  start();
}

async function start(): Promise<void> {
  const { t } = await createI18n({
    source: { scriptId: __SCRIPT_ID__, url: __LOCALE_URL__ },
    fallback: MESSAGES,
    storageKey: "lang",
  });

  const THEME = probeTheme({
    panelClass: "more-horiz-panel",
    actionClass: "video-show-action-btn default",
    itemHover: "hsla(0,0%,100%,.2)",
  });

  const getHostColors = () => resolveH1dlHostColors(THEME, document);
  const styleEl = injectStyles(
    THEME,
    currentThemeMode,
    currentThemeMode === "host"
      ? resolveThemeTokens("host", getHostColors())
      : null
  );

  let activeDownloads = 0;
  let bumpDownloadsFlag = false;
  const bumpDownloads = (delta: number): void => {
    activeDownloads = Math.max(0, activeDownloads + delta);
    const should = activeDownloads > 0;
    if (should !== bumpDownloadsFlag) {
      bumpDownloadsFlag = should;
      window[should ? "addEventListener" : "removeEventListener"](
        "beforeunload",
        onBeforeUnload
      );
    }
  };
  function onBeforeUnload(e: BeforeUnloadEvent): void {
    e.preventDefault();
    e.returnValue = "";
  }

  const setState = createStateMachine(t as (key: string) => string);

  const singleDownload = (
    btn: HTMLElement,
    videoId: string,
    quality: string
  ) => {
    startDownload(btn, videoId, quality, setState, bumpDownloads);
  };

  const menu = createMenu(t as (key: string) => string, singleDownload);

  const applyMode = (mode: ThemeMode) => {
    currentThemeMode = mode;
    gmSet(THEME_MODE_KEY, mode);
    const hostColors = mode === "host" ? getHostColors() : null;
    const hostTokens =
      mode === "host" ? resolveThemeTokens("host", hostColors) : null;
    styleEl.textContent = buildStylesheetText(THEME, mode, hostTokens);
    document.documentElement.setAttribute("data-h1dl-theme", mode);
    batch.setThemeMode(mode, hostColors);
  };

  const batch = createBatch(
    t as (key: string) => string,
    menu.askQuality,
    bumpDownloads,
    {
      getThemeMode: () => currentThemeMode,
      onThemeModeChange: applyMode,
    }
  );
  onLiveThemeChange = applyMode;

  const inject = createInject(
    t as (key: string) => string,
    menu,
    batch,
    setState
  );

  let injecting = false;
  let scanTimer: number | null = null;

  function scan(): void {
    injecting = true;
    try {
      inject.scan();
    } finally {
      injecting = false;
    }
  }

  function scheduleScan(): void {
    if (scanTimer) {
      return;
    }
    scanTimer = window.setTimeout(() => {
      scanTimer = null;
      scan();
    }, 300);
  }

  const observer = new MutationObserver((mutations: MutationRecord[]) => {
    if (injecting) {
      return;
    }
    if (menu.isOpen()) {
      const openMenu = menu.element();
      const ownMutation = mutations.some(
        (m) =>
          Array.from(m.addedNodes).includes(openMenu as Node) ||
          m.target === openMenu ||
          (openMenu as HTMLElement)?.contains(m.target) ||
          batch.element() === m.target ||
          batch.element()?.contains(m.target)
      );
      if (!ownMutation) {
        menu.close();
      }
    }
    scheduleScan();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key.toLowerCase() === "d" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      batch.setMode(!batch.isOn());
    }
  });

  scan();
}
