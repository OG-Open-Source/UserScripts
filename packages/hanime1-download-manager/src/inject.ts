/**
 * Page injection — watch page (/watch?v=) takeover and listing page cards.
 *
 * Watch page: replace native download buttons with the quality menu.
 * Listings: hover download buttons + batch checkboxes on cards, covering
 * b.1 (playlist-video-card) and b.2 (search/author cards) — both share the
 * .video-item-container class.
 */
import { extractVideoId } from "./api";
import { type BatchApi, QUALITIES } from "./batch";
import type { StateUpdater } from "./download";
import type { MenuApi } from "./menu";

export interface InjectApi {
	/** Inject/take over buttons on the current page. */
	scan: () => void;
}

export function createInject(
	t: (key: string) => string,
	menu: MenuApi,
	batch: BatchApi,
	setState: StateUpdater,
): InjectApi {
	function buildListButton(videoId: string): HTMLElement {
		const btn = document.createElement("div");
		// Compact custom style: a small translucent chip that matches the site's
		// thumbnail overlay stat chips. Self-contained color so it never inherits
		// the subtitle grey.
		btn.className = "h1dl-list-btn";
		btn.setAttribute("title", t("download"));
		btn.innerHTML =
			'<i class="material-icons h1dl-icon">download</i><span class="h1dl-label">' +
			t("download") +
			"</span>";
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (btn.dataset.state === "error") {
				// click on failed state retries the menu
				setState(btn, "idle");
			}
			menu.open(btn, videoId);
		});
		return btn;
	}

	function injectWatchPage(): void {
		const downloadBtn = document.getElementById("downloadBtn");
		if (downloadBtn && !downloadBtn.dataset.h1dl) {
			const videoId =
				extractVideoId(location.href) || extractVideoId(downloadBtn);
			if (videoId) {
				downloadBtn.dataset.h1dl = "1";
				downloadBtn.removeAttribute("href");
				downloadBtn.style.cursor = "pointer";

				// Reuse the existing icon and text node ("下載") as state targets;
				// setButtonState updates them in place instead of appending a new label.
				const icon = downloadBtn.querySelector("#video-download-btn");
				if (icon) icon.classList.add("h1dl-icon");
				// The native markup is <div class="video-show-action-btn ..."><i>download</i>下載</div>:
				// wrap the trailing text node so setButtonState can address it by class.
				const labelContainer = icon
					? (icon.parentElement as HTMLElement | null)
					: (downloadBtn.querySelector(
							".video-show-action-btn",
						) as HTMLElement | null);
				if (labelContainer) {
					Array.from(labelContainer.childNodes).forEach((node) => {
						if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
							const span = document.createElement("span");
							span.className = "h1dl-label";
							span.textContent = node.textContent.trim();
							node.replaceWith(span);
						}
					});
				}
				downloadBtn.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					menu.open(downloadBtn, videoId);
				});
			}
		}

		// more-horiz dropdown "下載" entry
		document
			.querySelectorAll("a.more-horiz-download-late")
			.forEach((a: Element) => {
				const anchor = a as HTMLAnchorElement;
				if (anchor.dataset.h1dl) return;
				const videoId = extractVideoId(anchor) || extractVideoId(location.href);
				if (!videoId) return;
				anchor.dataset.h1dl = "1";
				anchor.removeAttribute("href");
				anchor.style.cursor = "pointer";
				anchor.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					// close the site's own more-horiz dropdown first
					const openDropdown = document.querySelector(
						".more-horiz-wrapper.open",
					);
					if (openDropdown) openDropdown.classList.remove("open");
					menu.open(anchor, videoId);
				});
			});
	}

	function injectListings(): void {
		// Covers b.1 (playlist-video-card) and b.2 (search/author cards):
		// both share the .video-item-container class.
		document
			.querySelectorAll(".video-item-container")
			.forEach((card: Element) => {
				const el = card as HTMLElement;
				if (el.dataset.h1dlBtn) return;
				const videoId = extractVideoId(el);
				if (!videoId) return;
				el.dataset.h1dlBtn = "1";
				el.classList.add("h1dl-card");

				const btn = buildListButton(videoId);

				const metaData = el.querySelector(".video-meta-data");
				const subtitle = el.querySelector(".subtitle");
				if (metaData) {
					// b.1: rectangular button under the tags/upload-date row
					metaData.after(btn);
				} else if (subtitle) {
					// b.2: button to the right of title/upload-date
					subtitle.appendChild(btn);
				} else {
					el.appendChild(btn);
				}

				// Batch checkbox on the thumbnail's top-right corner.
				// Checkbox uses the site's thumbnail overlay pattern:
				// .stats-container > .stat-item (semi-transparent chip, radius 3px).
				// Geometry/opacity live in the stylesheet so the :hover and
				// .h1dl-batch-on reveal rules can win (inline styles always win).
				const check = document.createElement("div");
				check.className = "h1dl-check";
				check.innerHTML = '<i class="material-icons"></i>';
				const entry = batch.addEntry(el, videoId, check);
				check.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					// Completed items are locked: never re-download them.
					if (entry.state === "done") return;
					if (!batch.isOn()) batch.setMode(true);
					batch.setChecked(entry, !entry.checked);
				});
				el.appendChild(check);
				// NOTE: the watch page renders the same video in up to three places
				// (playlist rail has hidden-md + hidden-xs responsive copies, plus a
				// related-videos copy). One entry per CARD, not per videoId, so every
				// visible checkbox is independently checkable; downloads de-duplicate
				// by videoId at start time.
				el.dataset.h1dlEntry = "";
			});

		// Build the progress bar lazily; tick sync happens in updateBatchBar.
		if (batch.isOn()) batch.update();
	}

	function scan(): void {
		if (location.pathname === "/watch") {
			// The watch page also contains a playlist rail (b.1 cards) in the
			// sidebar, so listing buttons must be injected there too.
			injectWatchPage();
			injectListings();
		} else {
			injectListings();
		}
	}

	return { scan };
}

// QUALITIES is re-exported for the keyboard shortcut module's menu wiring.
export { QUALITIES };
