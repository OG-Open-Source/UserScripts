/**
 * Hanime1 Download Manager — userscript entry.
 *
 * Migrated from the standalone hanime1-download-manager.user.js (v1.1) to a
 * vite-plugin-monkey package. Behavior is preserved 1:1: native-style quality
 * menu, batch download mode, in-page downloads without leaving the page.
 */

import {
  GM_download,
  GM_getValue,
  GM_registerMenuCommand,
  GM_setValue,
  GM_xmlhttpRequest,
} from "$";
import {
  claimCapabilities,
  configureGmApi,
  createI18n,
  gmMenuCommand,
  gmSet,
  openSettings,
  probeTheme,
  publishPresence,
} from "@userscripts/shared";
import { createBatch } from "./batch";
import { createStateMachine, startDownload } from "./download";
import { MESSAGES } from "./i18n";
import { createInject } from "./inject";
import { createMenu } from "./menu";
import { injectStyles } from "./styles";

// Hosts mirrored from hosts.json (userscripts cannot read local files).
const HOSTS = ["hanime1.com", "hanime1.me", "hanimeone.com", "hanimeone.me"];

// locales.json, id, kind and capabilities are injected from vite.config.ts —
// the only place those values are written. `vite dev` points the locale URL
// at the dev server so the raw URL is not needed before the first release.
declare const __LOCALE_URL__: string;
declare const __SCRIPT_ID__: string;
declare const __SCRIPT_NAME__: string;
declare const __SCRIPT_DESCRIPTION__: string;
declare const __SCRIPT_KIND__: "feature" | "aio";
declare const __SCRIPT_CAPABILITIES__: string[];

// Wire the GM API into @userscripts/shared's dependency-injected helpers.
configureGmApi({
  GM_xmlhttpRequest,
  GM_download,
  GM_getValue,
  GM_setValue,
  GM_registerMenuCommand,
});

// Announce this script on every page it runs, including the manager page.
// That page reads the annotation instead of a catalog file.
publishPresence({
  id: __SCRIPT_ID__,
  name: __SCRIPT_NAME__,
  description: __SCRIPT_DESCRIPTION__,
  kind: __SCRIPT_KIND__,
  capabilities: [...__SCRIPT_CAPABILITIES__],
  localeUrl: __LOCALE_URL__,
});

// Fixed Settings command. Opens this script's section of the manager page.
gmMenuCommand("Settings", () => openSettings(__SCRIPT_ID__));

// The manager page applies a choice by broadcasting it. Each script writes
// the value into its own GM storage — storage is not shared between scripts.
window.addEventListener("userscript:settings", (event: Event) => {
  const lang = (event as CustomEvent<{ lang?: string }>).detail?.lang;
  if (lang) gmSet("lang", lang);
});

const ON_MANAGER =
  location.hostname === "og-open-source.github.io" && location.pathname.startsWith("/UserScripts");
if (ON_MANAGER) {
  // Presence only. The download UI does not belong on the manager page.
} else if (!HOSTS.includes(location.hostname)) {
  // vite-plugin-monkey guarantees @match, but keep the guard so dev-mode
  // installs (which match everything) behave identically.
  throw new Error("[h1dl] not a hanime1 host");
} else {
  boot();
}

// One capability per script. An all-in-one script that also provides
// hanime1:download would overlap this one, so only the first to run injects.
function boot(): void {
  const claim = claimCapabilities({
    id: __SCRIPT_ID__,
    kind: __SCRIPT_KIND__,
    capabilities: [...__SCRIPT_CAPABILITIES__],
  });
  if (!claim.ok) {
    console.warn(`[h1dl] not injecting: ${claim.conflict?.id} already provides hanime1:download`);
    throw new Error("[h1dl] capability already claimed");
  }
  void start();
}

// i18n — English ships in the script. Every other language is in the one
// locales.json fetched on first run, then cached. Switching language stores
// the code and reloads.
async function start(): Promise<void> {
  const { t } = await createI18n({
    source: { scriptId: __SCRIPT_ID__, url: __LOCALE_URL__ },
    fallback: MESSAGES,
    storageKey: "lang",
  });

  // Theme — read from the site's own CSS so we never hardcode colors.
  const THEME = probeTheme({
    panelClass: "more-horiz-panel",
    actionClass: "video-show-action-btn default",
    itemHover: "hsla(0,0%,100%,.2)",
  });

  injectStyles(THEME);

  /* Active download tracking — warn before leaving the page mid-download */
  let activeDownloads = 0;
  const bumpDownloads = (delta: number): void => {
    activeDownloads = Math.max(0, activeDownloads + delta);
    // Install/remove the guard as the first download starts / the last ends.
    const should = activeDownloads > 0;
    if (should !== bumpDownloadsFlag) {
      bumpDownloadsFlag = should;
      window[should ? "addEventListener" : "removeEventListener"]("beforeunload", onBeforeUnload);
    }
  };
  let bumpDownloadsFlag = false;
  function onBeforeUnload(e: BeforeUnloadEvent): void {
    // Browsers ignore custom text, but any handled beforeunload triggers
    // the native "leave site?" dialog.
    e.preventDefault();
    e.returnValue = "";
  }

  const setState = createStateMachine(t as (key: string) => string);

  const singleDownload = (btn: HTMLElement, videoId: string, quality: string) => {
    void startDownload(btn, videoId, quality, setState, bumpDownloads);
  };

  const menu = createMenu(t as (key: string) => string, singleDownload);
  const batch = createBatch(t as (key: string) => string, menu.askQuality, bumpDownloads);

  const inject = createInject(t as (key: string) => string, menu, batch, setState);

  /* Scan + dynamic content handling */
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
    if (scanTimer) return;
    scanTimer = window.setTimeout(() => {
      scanTimer = null;
      scan();
    }, 300);
  }

  const observer = new MutationObserver((mutations: MutationRecord[]) => {
    if (injecting) return;
    // Never close the menu over mutations caused by our own UI:
    // the menu itself being appended, or the batch bar being toggled
    // (which happens while a menu can be open in batch mode).
    if (menu.isOpen()) {
      const openMenu = menu.element();
      const ownMutation = mutations.some(
        (m) =>
          Array.from(m.addedNodes).includes(openMenu as Node) ||
          m.target === openMenu ||
          (openMenu as HTMLElement)?.contains(m.target) ||
          batch.element() === m.target ||
          batch.element()?.contains(m.target),
      );
      if (!ownMutation) menu.close();
    }
    scheduleScan();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Toggle batch mode with Ctrl+Shift+D.
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key.toLowerCase() === "d" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      batch.setMode(!batch.isOn());
    }
  });

  scan();
}
