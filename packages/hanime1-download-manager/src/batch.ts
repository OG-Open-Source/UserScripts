/**
 * Batch download — checkboxes on thumbnails + right-side progress bar.
 *
 * One entry per CARD (the watch page repeats videos in up to three places via
 * responsive copies), downloads de-duplicate by videoId at start time.
 */

import { GM_download } from "$";
import type { BatchEntry, DownloadState } from "@userscripts/shared";
import { resolveWithFallback } from "./api";

/** Fallback order for the batch menu (each video falls back per-video). */
export const QUALITIES = ["1080p", "720p", "480p"];

export interface BatchApi {
	/** Register a card in the batch state and return its entry. */
	addEntry: (
		card: HTMLElement,
		videoId: string,
		check: HTMLElement,
	) => BatchEntry;
	/** Toggle a card's checked state. */
	setChecked: (entry: BatchEntry, checked: boolean) => void;
	/** Enter or leave batch mode (shows/hides the bar). */
	setMode: (on: boolean) => void;
	/** Whether batch mode is currently on. */
	isOn: () => boolean;
	/** The batch bar element, or null if not yet built (used by the MutationObserver). */
	element: () => HTMLDivElement | null;
	/** Refresh the bar after DOM mutations. */
	update: () => void;
	/** Start downloading all selected entries. */
	startDownload: () => Promise<void>;
}

export function createBatch(
	t: (key: string) => string,
	menuAskQuality: (qualities: string[]) => Promise<string | null>,
	onActiveChange: (delta: number) => void,
): BatchApi {
	// one entry per CARD (watch page repeats videos)
	const batchState = new Set<BatchEntry>();
	let batchBar: HTMLDivElement | null = null;
	let batchOn = false;
	let batchQuality: string | null = null; // chosen quality for the batch run

	// Native batch bar look comes from theme variables (read off the site's
	// own .more-horiz-panel values) — we must NOT put the .more-horiz-panel
	// class itself on the bar: it carries position:absolute and a mobile
	// left:-122px rule that would break the fixed right rail.
	const BATCH_BAR_STYLE = [
		"position:fixed",
		"right:0",
		"top:50%",
		"transform:translateY(-50%)",
		"z-index:2147483646",
		"display:flex",
		"flex-direction:column",
		"align-items:center",
		"gap:6px",
		"padding:8px 6px",
		"background-color:var(--h1dl-panel-bg)",
		"-webkit-backdrop-filter:blur(8px)",
		"backdrop-filter:blur(8px)",
		"border-radius:8px 0 0 8px",
		"box-shadow:0 4px 24px rgba(0,0,0,0.5)",
		"color:var(--h1dl-panel-color)",
		"font-size:12px",
		"max-height:70vh",
	].join(";");

	function buildBatchBar(): HTMLDivElement {
		if (batchBar) return batchBar;
		const bar = document.createElement("div");
		bar.className = "h1dl-batch-bar";
		bar.style.cssText = BATCH_BAR_STYLE;

		// Selected count (n).
		const count = document.createElement("div");
		count.className = "h1dl-bb-count";
		count.style.cssText = "font-size:13px;font-weight:bold;line-height:1.2";
		count.textContent = "0";
		bar.appendChild(count);

		const divider1 = document.createElement("div");
		divider1.style.cssText =
			"width:70%;height:1px;background:var(--h1dl-item-hover);flex:none";
		bar.appendChild(divider1);

		const prog = document.createElement("div");
		prog.className = "h1dl-batch-prog";
		prog.style.cssText = [
			"display:flex",
			"flex-direction:column",
			"gap:4px",
			"align-items:center",
			"max-height:46vh",
			"overflow-y:auto",
			"scrollbar-width:thin",
			"padding:2px 0",
			"flex:0 1 auto",
			"min-height:0",
		].join(";");
		bar.appendChild(prog);

		const divider2 = divider1.cloneNode();
		bar.appendChild(divider2);

		// Compact custom icon buttons: 28x28 squares that match the bar's own
		// translucent look.
		const mkBtn = (
			title: string,
			icon: string,
			onClick: () => void,
			extraClass?: string,
		): HTMLButtonElement => {
			const b = document.createElement("button");
			b.className = "h1dl-bb-btn";
			if (extraClass) b.classList.add(extraClass);
			b.title = title;
			b.innerHTML = `<i class="material-icons">${icon}</i>`;
			b.addEventListener("click", onClick);
			return b;
		};

		// Bootstrap 3 responsive helpers: hidden-* hides an element inside one
		// breakpoint band (display:none at that band only). The watch page's
		// playlist rail is rendered twice — once inside hidden-md (visible on
		// desktop) and once inside hidden-xs (visible on mobile) — so half of
		// the copies are invisible at any viewport. select-all must skip those
		// invisible copies.
		// Band edges: hidden-xs [0,768), hidden-sm [768,992),
		// hidden-md [992,1200), hidden-lg [1200,∞).
		const BP_MIN: Record<string, number> = {
			xs: 0,
			sm: 768,
			md: 992,
			lg: 1200,
		};
		const BP_MAX: Record<string, number> = {
			xs: 768,
			sm: 992,
			md: 1200,
			lg: Infinity,
		};
		const vw = () =>
			window.innerWidth || document.documentElement.clientWidth || 1024;
		const isCardVisible = (card: HTMLElement): boolean => {
			let el: HTMLElement | null = card;
			while (el && el !== document.body) {
				if (el.style?.display === "none") return false;
				const cls = el.classList;
				for (const bp of Object.keys(BP_MIN)) {
					if (cls.contains("hidden-" + bp)) {
						const w = vw();
						if (w >= BP_MIN[bp] && w < BP_MAX[bp]) return false;
					}
				}
				el = el.parentElement;
			}
			return true;
		};

		const selectAll = mkBtn(t("selectAll"), "select_all", () => {
			batchState.forEach((entry) => {
				if (!isCardVisible(entry.card)) return;
				if (entry.state !== "downloading" && entry.state !== "done")
					setChecked(entry, true);
			});
		});
		bar.appendChild(selectAll);

		const selectNone = mkBtn(t("selectNone"), "deselect", () => {
			batchState.forEach((entry) => {
				if (entry.state !== "downloading") setChecked(entry, false);
			});
			// setChecked already exits batch mode when count hits 0.
		});
		bar.appendChild(selectNone);

		const dlBtn = mkBtn(
			t("downloadSelected"),
			"download",
			() => void startBatchDownload(),
			"h1dl-bb-dl",
		);
		bar.appendChild(dlBtn);

		document.body.appendChild(bar);
		batchBar = bar;
		return bar;
	}

	function updateTick(
		entry: BatchEntry,
		state: DownloadState,
		percent?: number,
	): void {
		const tick = entry.tick;
		if (!tick) return;
		const fill = tick.querySelector(".h1dl-batch-fill") as HTMLElement;
		tick.classList.remove("done", "error");
		if (state === "downloading") {
			fill.style.width = (percent || 0) + "%";
		} else if (state === "done") {
			tick.classList.add("done");
			fill.style.width = "100%";
		} else if (state === "error") {
			tick.classList.add("error");
			fill.style.width = "100%";
		} else {
			fill.style.width = "0%";
		}
	}

	function syncTicks(): void {
		if (!batchBar) return;
		const prog = batchBar.querySelector(".h1dl-batch-prog") as HTMLElement;
		const checked = Array.from(batchState).filter((e) => e.checked);
		checked.forEach((entry) => {
			if (!entry.tick) {
				const tick = document.createElement("div");
				tick.className = "h1dl-batch-tick";
				tick.innerHTML =
					'<div class="h1dl-batch-fill"></div><span class="h1dl-batch-name"></span>';
				const titleEl = entry.card.querySelector(".title, .video-title");
				const name = titleEl
					? ((titleEl as HTMLElement).textContent?.trim() ?? entry.videoId)
					: entry.videoId;
				tick.querySelector(".h1dl-batch-name")!.textContent = name;
				tick.title = name;
				prog.appendChild(tick);
				entry.tick = tick;
				updateTick(entry, entry.state);
			}
		});
		// Remove ticks of unchecked entries.
		Array.from(batchState).forEach((entry) => {
			if (!entry.checked && entry.tick) {
				entry.tick.remove();
				entry.tick = null;
			}
		});
	}

	function updateBatchBar(): void {
		if (!batchBar) return;
		// Count only items that are selected and not yet completed.
		const pending = Array.from(batchState).filter(
			(e) => e.checked && e.state !== "done",
		);
		(batchBar.querySelector(".h1dl-bb-count") as HTMLElement).textContent =
			String(pending.length);
		const dlBtn = batchBar.querySelector(".h1dl-bb-dl") as HTMLButtonElement;
		dlBtn.disabled =
			pending.length === 0 || pending.some((e) => e.state === "downloading");
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
			batchBar!.style.display = "flex";
		} else if (batchBar) {
			batchBar.style.display = "none";
		}
	}

	async function startBatchDownload(): Promise<void> {
		const selected = Array.from(batchState).filter(
			(e) => e.checked && e.state !== "done",
		);
		if (!selected.length) return;
		// Ask quality once for the whole batch via a small menu.
		if (!batchQuality) {
			const q = await menuAskQuality(QUALITIES);
			if (!q) return;
			batchQuality = q;
		}
		// The watch page can hold up to three cards for the same video (playlist
		// rail's responsive copies). Download each videoId once and mirror the
		// result onto its other selected copies.
		const seenIds = new Set<string>();
		const downgraded: { entry: BatchEntry; from: string; to: string }[] = [];
		for (const entry of selected) {
			if (seenIds.has(entry.videoId)) {
				// A copy of an already-selected video: mark it done without
				// downloading again.
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
					QUALITIES,
				);
				if (!resolved) throw new Error("no download link found");
				if (resolved.quality !== batchQuality) {
					downgraded.push({ entry, from: batchQuality, to: resolved.quality });
				}
				await new Promise<void>((resolve) => {
					GM_download({
						url: resolved.info.url,
						// GM_download's name is a required string in the
						// vite-plugin-monkey types; undefined falls back to the
						// manager default at runtime.
						name: (resolved.info.filename ?? undefined) as string,
						onload: () => {
							onActiveChange(-1);
							entry.state = "done";
							updateTick(entry, "done");
							entry.check.classList.add("completed");
							resolve();
						},
						onerror: () => {
							onActiveChange(-1);
							entry.state = "error";
							updateTick(entry, "error");
							resolve();
						},
						ontimeout: () => {
							onActiveChange(-1);
							entry.state = "error";
							updateTick(entry, "error");
							resolve();
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
									Math.round((e.loaded / e.total) * 100),
								);
							}
						},
					});
				});
			} catch {
				// The failure is already surfaced as an error tick on the batch bar;
				// the cause is not actionable per-item.
				onActiveChange(-1);
				entry.state = "error";
				updateTick(entry, "error");
			}
		}
		// Notify the user about quality downgrades.
		if (downgraded.length) {
			const names = downgraded
				.map((d) => {
					const titleEl = d.entry.card.querySelector(".title, .video-title");
					return (
						(titleEl
							? (titleEl as HTMLElement).textContent?.trim()
							: d.entry.videoId) + ` (${d.from}→${d.to})`
					);
				})
				.join("\n");
			console.warn("[h1dl] " + t("downgradeNotice") + "\n" + names);
		}
		// Clear quality so a future batch can re-pick.
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
		isOn: () => batchOn,
		element: () => batchBar,
		update: updateBatchBar,
		startDownload: startBatchDownload,
	};
}
