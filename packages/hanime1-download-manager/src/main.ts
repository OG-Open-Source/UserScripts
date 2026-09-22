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
import { configureGmApi, createI18n, probeTheme } from "@userscripts/shared";
import { createBatch } from "./batch";
import { createStateMachine, startDownload } from "./download";
import { DEFAULT_LANG, LANG_NAMES, LANGS, MESSAGES } from "./i18n";
import { createInject } from "./inject";
import { createMenu } from "./menu";
import { injectStyles } from "./styles";

// Hosts mirrored from hosts.json (userscripts cannot read local files).
const HOSTS = ["hanime1.com", "hanime1.me", "hanimeone.com", "hanimeone.me"];

if (!HOSTS.includes(location.hostname)) {
	// vite-plugin-monkey guarantees @match, but keep the guard so dev-mode
	// installs (which match everything) behave identically.
	// eslint-disable-next-line no-restricted-syntax
	throw new Error("[h1dl] not a hanime1 host");
}

// Wire the GM API into @userscripts/shared's dependency-injected helpers.
configureGmApi({
	GM_xmlhttpRequest,
	GM_download,
	GM_getValue,
	GM_setValue,
	GM_registerMenuCommand,
});

// i18n — zh-TW (default) / zh-CN / en, switchable via GM "lang" value.
// One menu command per language: pick directly, current one marked.
const { t } = createI18n({
	langs: LANGS,
	defaultLang: DEFAULT_LANG,
	langNames: LANG_NAMES,
	messages: MESSAGES,
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
		window[should ? "addEventListener" : "removeEventListener"](
			"beforeunload",
			onBeforeUnload,
		);
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
const batch = createBatch(
	t as (key: string) => string,
	menu.askQuality,
	bumpDownloads,
);

const inject = createInject(
	t as (key: string) => string,
	menu,
	batch,
	setState,
);

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
