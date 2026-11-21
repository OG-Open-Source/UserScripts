/**
 * Batch download — checkboxes on thumbnails + slim Curved-Outside right-edge dock.
 *
 * One entry per CARD (the watch page repeats videos in up to three places via
 * responsive copies), downloads de-duplicate by videoId at start time.
 */

import type {
  BatchEntry,
  DownloadState,
  ThemeColors,
  ThemeMode,
} from "@userscripts/shared";
import {
  applyThemeModeToElement,
  gmDownload,
  markUiRoot,
  probeHostColors,
  resolveThemeTokens,
} from "@userscripts/shared";
import { downloadName, resolveWithFallback } from "./api";
import { getBatchDockCss } from "./styles";

/** Fallback order for the batch menu (each video falls back per-video). */
export const QUALITIES = ["1080p", "720p", "480p"];

export interface BatchApi {
  /** Register a card in the batch state and return its entry. */
  addEntry: (
    card: HTMLElement,
    videoId: string,
    check: HTMLElement
  ) => BatchEntry;
  /** The batch dock element, or null if not yet built (used by the MutationObserver). */
  element: () => HTMLDivElement | null;
  /** Whether batch mode is currently on. */
  isOn: () => boolean;
  /** Toggle a card's checked state. */
  setChecked: (entry: BatchEntry, checked: boolean) => void;
  /** Enter or leave batch mode (shows/hides the bar). */
  setMode: (on: boolean) => void;
  /** Update the dock's 4-mode theme rule dynamically. */
  setThemeMode: (mode: ThemeMode, hostColors?: ThemeColors | null) => void;
  /** Start downloading all selected entries. */
  startDownload: () => Promise<void>;
  /** Refresh the bar after DOM mutations. */
  update: () => void;
}

export interface BatchOptions {
  getThemeMode?: () => ThemeMode;
  onThemeModeChange?: (mode: ThemeMode) => void;
}

const DOCK_ID = "h1dl-dock";
const DOCK_STYLE_ID = "h1dl-dock-style";

export function createBatch(
  t: (key: string) => string,
  menuAskQuality: (qualities: string[]) => Promise<string | null>,
  onActiveChange: (delta: number) => void,
  options?: BatchOptions
): BatchApi {
  // one entry per CARD (watch page repeats videos)
  const batchState = new Set<BatchEntry>();
  let dockHost: HTMLDivElement | null = null;
  let dockShadow: ShadowRoot | null = null;
  let batchOn = false;
  let batchQuality: string | null = null; // chosen quality for the batch run
  let preferredQuality: string | null = null; // optional preset in Options flyout
  let openTab: "queue" | "prefs" | null = null;
  const entryRowMap = new Map<
    BatchEntry,
    { mini: HTMLElement; row: HTMLElement; pctEl: HTMLElement }
  >();

  function currentThemeMode(): ThemeMode {
    return options?.getThemeMode?.() ?? "host";
  }

  function applyDockTheme(
    mode: ThemeMode = currentThemeMode(),
    explicitHost?: ThemeColors | null
  ): void {
    if (!(dockHost && dockShadow)) {
      return;
    }
    const hostColors =
      explicitHost ?? (mode === "host" ? probeHostColors(document) : null);
    const hostTokens =
      mode === "host" ? resolveThemeTokens("host", hostColors) : null;
    applyThemeModeToElement(dockHost, mode, hostColors);
    const styleEl = dockShadow.getElementById(
      DOCK_STYLE_ID
    ) as HTMLStyleElement | null;
    if (styleEl) {
      styleEl.textContent = getBatchDockCss(hostTokens);
    }
    for (const btn of dockShadow.querySelectorAll("[data-theme-opt]")) {
      btn.setAttribute(
        "aria-pressed",
        String((btn as HTMLElement).dataset.themeOpt === mode)
      );
    }
  }

  // Bootstrap 3 responsive helpers: hidden-* hides an element inside one
  // breakpoint band (display:none at that band only).
  const BP_MIN: Record<string, number> = { xs: 0, sm: 768, md: 992, lg: 1200 };
  const BP_MAX: Record<string, number> = {
    xs: 768,
    sm: 992,
    md: 1200,
    lg: Number.POSITIVE_INFINITY,
  };
  const vw = () =>
    window.innerWidth || document.documentElement.clientWidth || 1024;
  const isCardVisible = (card: HTMLElement): boolean => {
    let el: HTMLElement | null = card;
    while (el && el !== document.body) {
      if (el.style?.display === "none") {
        return false;
      }
      const cls = el.classList;
      for (const bp of Object.keys(BP_MIN)) {
        if (cls.contains(`hidden-${bp}`)) {
          const w = vw();
          if (w >= BP_MIN[bp]! && w < BP_MAX[bp]!) {
            return false;
          }
        }
      }
      el = el.parentElement;
    }
    return true;
  };

  function buildBatchBar(): HTMLDivElement {
    if (dockHost) {
      return dockHost;
    }
    const host = document.createElement("div");
    host.id = DOCK_ID;
    markUiRoot(host, "h1dl");

    const sr = host.attachShadow({ mode: "open" });
    const mode = currentThemeMode();
    const hostColors = mode === "host" ? probeHostColors(document) : null;
    const hostTokens =
      mode === "host" ? resolveThemeTokens("host", hostColors) : null;
    applyThemeModeToElement(host, mode, hostColors);

    const styleEl = document.createElement("style");
    styleEl.id = DOCK_STYLE_ID;
    styleEl.textContent = getBatchDockCss(hostTokens);
    sr.appendChild(styleEl);

    const tpl = document.createElement("template");
    tpl.innerHTML = `
<aside class="co-dock" aria-label="${t("queue")}">
  <div class="co-flyout" id="h1dl-dock-flyout" data-open="false" aria-hidden="true">
    <div id="h1dl-tab-queue">
      <div class="co-body-head">
        <span>${t("queue")}</span>
        <span class="us-chip us-mono" id="h1dl-queue-count">0</span>
      </div>
      <div class="co-body-list" id="h1dl-queue-list"></div>
    </div>
    <div id="h1dl-tab-prefs" hidden>
      <div class="co-body-head">
        <span>${t("options")}</span>
        <span class="us-chip us-mono">h1dl</span>
      </div>
      <div class="co-body-list">
        <div class="dl-item">
          <span class="us-muted" style="font-size:11px">${t("preferredQuality")}</span>
          <div class="prefs-pills" id="h1dl-qual-pills">
            <button class="us-btn us-btn-sm" type="button" data-qual="" aria-pressed="true">${t("autoQuality")}</button>
            ${QUALITIES.map((q) => `<button class="us-btn us-btn-sm" type="button" data-qual="${q}" aria-pressed="false">${q}</button>`).join("")}
          </div>
        </div>
        <div class="dl-item">
          <span class="us-muted" style="font-size:11px">${t("themeRule")}</span>
          <div class="prefs-pills" id="h1dl-theme-pills">
            <button class="us-btn us-btn-sm" type="button" data-theme-opt="host" aria-pressed="${mode === "host"}">${t("themeHost")}</button>
            <button class="us-btn us-btn-sm" type="button" data-theme-opt="system" aria-pressed="${mode === "system"}">${t("themeSystem")}</button>
            <button class="us-btn us-btn-sm" type="button" data-theme-opt="light" aria-pressed="${mode === "light"}">${t("themeLight")}</button>
            <button class="us-btn us-btn-sm" type="button" data-theme-opt="dark" aria-pressed="${mode === "dark"}">${t("themeDark")}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="co-rail">
    <svg class="co-fillet co-fillet-top" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M12 0 A12 12 0 0 1 0 12 L12 12 Z" fill="var(--us-bg)" />
    </svg>
    <svg class="co-fillet co-fillet-bot" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M12 0 A12 12 0 0 1 0 12 L12 12 Z" fill="var(--us-bg)" />
    </svg>

    <span class="co-count" id="h1dl-count">0</span>

    <div class="co-group">
      <button class="co-group-btn" type="button" id="h1dl-btn-queue" data-co-tab="queue" aria-expanded="false" title="${t("queue")}">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 4h10M3 8h10M3 12h6"/></svg>
      </button>
      <button class="co-group-btn" type="button" id="h1dl-btn-prefs" data-co-tab="prefs" aria-expanded="false" title="${t("options")}">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1"/></svg>
      </button>
    </div>

    <div class="co-mini-ticks" id="h1dl-mini-ticks" title="${t("queue")}"></div>

    <div class="co-group">
      <button class="co-group-btn" id="h1dl-select-toggle" type="button" title="${t("selectAll")}">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path id="h1dl-select-path" d="M5.2 8.2l2 2 3.6-4"/></svg>
      </button>
      <button class="co-group-btn primary" id="h1dl-dl-btn" type="button" title="${t("downloadSelected")}">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M5 7.5l3 3 3-3M3 13.5h10"/></svg>
      </button>
    </div>
  </div>
</aside>`;
    sr.appendChild(tpl.content.cloneNode(true));

    const flyout = sr.getElementById("h1dl-dock-flyout")!;
    const tabQueue = sr.getElementById("h1dl-tab-queue")!;
    const tabPrefs = sr.getElementById("h1dl-tab-prefs")!;

    for (const btn of sr.querySelectorAll("[data-co-tab]")) {
      btn.addEventListener("click", () => {
        const next = (btn as HTMLElement).dataset.coTab as "queue" | "prefs";
        openTab = openTab === next ? null : next;
        flyout.dataset.open = String(openTab !== null);
        flyout.setAttribute("aria-hidden", String(openTab === null));
        for (const b of sr.querySelectorAll("[data-co-tab]")) {
          b.setAttribute(
            "aria-expanded",
            String((b as HTMLElement).dataset.coTab === openTab)
          );
        }
        if (openTab) {
          tabQueue.hidden = openTab !== "queue";
          tabPrefs.hidden = openTab !== "prefs";
        }
      });
    }

    sr.getElementById("h1dl-select-toggle")!.addEventListener("click", () => {
      const visibleEligible = Array.from(batchState).filter(
        (entry) =>
          isCardVisible(entry.card) &&
          entry.state !== "downloading" &&
          entry.state !== "done"
      );
      const anyChecked = visibleEligible.some((e) => e.checked);
      if (anyChecked) {
        for (const entry of batchState) {
          if (entry.state !== "downloading") {
            setChecked(entry, false);
          }
        }
      } else {
        for (const entry of visibleEligible) {
          setChecked(entry, true);
        }
      }
    });

    sr.getElementById("h1dl-dl-btn")!.addEventListener("click", () => {
      void startBatchDownload();
    });

    for (const qBtn of sr.querySelectorAll("[data-qual]")) {
      qBtn.addEventListener("click", () => {
        const q = (qBtn as HTMLElement).dataset.qual || null;
        preferredQuality = q;
        for (const b of sr.querySelectorAll("[data-qual]")) {
          b.setAttribute(
            "aria-pressed",
            String(
              ((b as HTMLElement).dataset.qual || null) === preferredQuality
            )
          );
        }
      });
    }

    for (const tBtn of sr.querySelectorAll("[data-theme-opt]")) {
      tBtn.addEventListener("click", () => {
        const nextMode = (tBtn as HTMLElement).dataset.themeOpt as ThemeMode;
        applyDockTheme(nextMode);
        options?.onThemeModeChange?.(nextMode);
      });
    }

    document.body.appendChild(host);
    dockHost = host;
    dockShadow = sr;
    return host;
  }

  function updateTick(
    entry: BatchEntry,
    state: DownloadState,
    percent?: number
  ): void {
    const refs = entryRowMap.get(entry);
    if (!refs) {
      return;
    }
    const { mini, row, pctEl } = refs;
    const miniFill = mini.querySelector(".h1dl-batch-fill") as HTMLElement;
    const rowFill = row.querySelector(".h1dl-batch-fill") as HTMLElement;
    mini.classList.remove("done", "error");
    row.classList.remove("done", "error");
    if (state === "downloading") {
      const pct = Math.max(0, Math.min(100, percent || 0));
      const tx = `scaleX(${pct / 100})`;
      miniFill.style.transform = tx;
      rowFill.style.transform = tx;
      pctEl.textContent = `${pct}%`;
    } else if (state === "done") {
      mini.classList.add("done");
      row.classList.add("done");
      miniFill.style.transform = "scaleX(1)";
      rowFill.style.transform = "scaleX(1)";
      pctEl.textContent = "100%";
    } else if (state === "error") {
      mini.classList.add("error");
      row.classList.add("error");
      miniFill.style.transform = "scaleX(1)";
      rowFill.style.transform = "scaleX(1)";
      pctEl.textContent = t("error");
    } else {
      miniFill.style.transform = "scaleX(0)";
      rowFill.style.transform = "scaleX(0)";
      pctEl.textContent = t("queued");
    }
  }

  function syncTicks(): void {
    if (!dockShadow) {
      return;
    }
    const miniWrap = dockShadow.getElementById("h1dl-mini-ticks")!;
    const queueList = dockShadow.getElementById("h1dl-queue-list")!;
    const checked = Array.from(batchState).filter((e) => e.checked);

    for (const entry of checked) {
      if (!entryRowMap.has(entry)) {
        const titleEl = entry.card.querySelector(".title, .video-title");
        const name = titleEl
          ? ((titleEl as HTMLElement).textContent?.trim() ?? entry.videoId)
          : entry.videoId;

        const mini = document.createElement("div");
        mini.className = "dl-track h1dl-batch-tick";
        mini.title = name;
        mini.innerHTML = '<div class="h1dl-batch-fill"></div>';
        miniWrap.appendChild(mini);

        const row = document.createElement("div");
        row.className = "dl-item";
        row.innerHTML = `<div class="dl-item-row"><span class="dl-item-name"></span><span class="us-mono us-muted h1dl-pct"></span></div><div class="dl-track"><div class="h1dl-batch-fill"></div></div>`;
        row.querySelector(".dl-item-name")!.textContent = name;
        const pctEl = row.querySelector(".h1dl-pct") as HTMLElement;
        queueList.appendChild(row);

        entry.tick = mini;
        entryRowMap.set(entry, { mini, row, pctEl });
        updateTick(entry, entry.state);
      }
    }

    for (const entry of Array.from(batchState)) {
      if (!entry.checked && entryRowMap.has(entry)) {
        const refs = entryRowMap.get(entry)!;
        refs.mini.remove();
        refs.row.remove();
        entryRowMap.delete(entry);
        entry.tick = null;
      }
    }
  }

  function updateBatchBar(): void {
    if (!dockShadow) {
      return;
    }
    const pending = Array.from(batchState).filter(
      (e) => e.checked && e.state !== "done"
    );
    const checkedTotal = Array.from(batchState).filter((e) => e.checked).length;
    dockShadow.getElementById("h1dl-count")!.textContent = String(
      pending.length
    );
    dockShadow.getElementById("h1dl-queue-count")!.textContent =
      String(checkedTotal);

    const dlBtn = dockShadow.getElementById("h1dl-dl-btn") as HTMLButtonElement;
    dlBtn.disabled =
      pending.length === 0 || pending.some((e) => e.state === "downloading");

    const toggleBtn = dockShadow.getElementById(
      "h1dl-select-toggle"
    ) as HTMLButtonElement;
    const togglePath = dockShadow.getElementById("h1dl-select-path");
    const anyChecked = checkedTotal > 0;
    toggleBtn.classList.toggle("active", anyChecked);
    toggleBtn.title = anyChecked ? t("selectNone") : t("selectAll");
    togglePath?.setAttribute("d", anyChecked ? "M5 8h6" : "M5.2 8.2l2 2 3.6-4");

    syncTicks();
  }

  function setChecked(entry: BatchEntry, checked: boolean): void {
    entry.checked = checked;
    entry.check.classList.toggle("checked", checked);
    (entry.check.querySelector(".material-icons") as HTMLElement).textContent =
      checked ? "check" : "";
    updateBatchBar();
    // Unchecking the last selected item exits batch mode automatically.
    if (!checked && batchOn && !Array.from(batchState).some((e) => e.checked)) {
      setBatchMode(false);
    }
  }

  function setBatchMode(on: boolean): void {
    batchOn = on;
    document.body.classList.toggle("h1dl-batch-on", on);
    if (on) {
      buildBatchBar();
      dockHost!.style.display = "block";
      updateBatchBar();
    } else if (dockHost) {
      dockHost.style.display = "none";
    }
  }

  async function startBatchDownload(): Promise<void> {
    const selected = Array.from(batchState).filter(
      (e) => e.checked && e.state !== "done"
    );
    if (!selected.length) {
      return;
    }
    if (!batchQuality) {
      const q = preferredQuality ?? (await menuAskQuality(QUALITIES));
      if (!q) {
        return;
      }
      batchQuality = q;
    }
    const seenIds = new Set<string>();
    const downgraded: { entry: BatchEntry; from: string; to: string }[] = [];
    for (const entry of selected) {
      if (seenIds.has(entry.videoId)) {
        entry.state = "done";
        updateTick(entry, "done");
        entry.check.classList.add("completed");
        continue;
      }
      seenIds.add(entry.videoId);
      entry.state = "downloading";
      updateTick(entry, "downloading", 0);
      onActiveChange(1);
      const videoId = entry.videoId;
      try {
        const resolved = await resolveWithFallback(
          videoId,
          batchQuality,
          QUALITIES
        );
        if (!resolved) {
          throw new Error("no download link found");
        }
        if (resolved.quality !== batchQuality) {
          downgraded.push({
            entry,
            from: batchQuality,
            to: resolved.quality,
          });
        }
        await gmDownload({
          url: resolved.info.url,
          name: downloadName(resolved.info.filename, resolved.info.url),
          onload: () => {
            onActiveChange(-1);
            entry.state = "done";
            updateTick(entry, "done");
            entry.check.classList.add("completed");
          },
          onerror: () => {
            onActiveChange(-1);
            entry.state = "error";
            updateTick(entry, "error");
          },
          ontimeout: () => {
            onActiveChange(-1);
            entry.state = "error";
            updateTick(entry, "error");
          },
          onprogress: (e: {
            lengthComputable: boolean;
            loaded: number;
            total: number;
          }) => {
            if (e?.lengthComputable) {
              updateTick(
                entry,
                "downloading",
                Math.round((e.loaded / e.total) * 100)
              );
            }
          },
        }).catch(() => {
          // Handled via onerror/ontimeout callbacks above
        });
      } catch {
        onActiveChange(-1);
        entry.state = "error";
        updateTick(entry, "error");
      }
    }
    if (downgraded.length) {
      const names = downgraded
        .map((d) => {
          const titleEl = d.entry.card.querySelector(".title, .video-title");
          return `${titleEl ? (titleEl as HTMLElement).textContent?.trim() : d.entry.videoId} (${d.from}→${d.to})`;
        })
        .join("\n");
      console.warn(`[h1dl] ${t("downgradeNotice")}\n${names}`);
    }
    batchQuality = null;
    updateBatchBar();
  }

  return {
    addEntry(card, videoId, check) {
      const entry: BatchEntry = {
        card,
        check,
        videoId,
        checked: false,
        state: "idle",
        tick: null,
      };
      batchState.add(entry);
      return entry;
    },
    setChecked,
    setMode: setBatchMode,
    setThemeMode: applyDockTheme,
    isOn: () => batchOn,
    element: () => dockHost,
    update: updateBatchBar,
    startDownload: startBatchDownload,
  };
}
