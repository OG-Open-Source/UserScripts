/**
 * Download button state machine and single-download flow.
 *
 * Button visuals are updated in place: the icon element carries .h1dl-icon
 * and the label .h1dl-label so both native markup and our injected buttons
 * share one update path.
 */

import { GM_download } from "$";
import type { DownloadState } from "@userscripts/shared";
import { gmDownload } from "@userscripts/shared";
import { queryQualities } from "./api";

interface StateDef {
	icon: string;
	label: string;
	spin?: boolean;
}

/** Map of states to icon/label. `downloading` shows a percentage instead. */
function buildStates(
	t: (key: string) => string,
): Record<DownloadState, StateDef> {
	return {
		idle: { icon: "download", label: t("download") },
		fetching: { icon: "hourglass_empty", label: t("fetching"), spin: true },
		downloading: { icon: "cloud_download", label: "%" },
		done: { icon: "check_circle", label: t("done") },
		error: { icon: "error_outline", label: t("error") },
	};
}

export type StateUpdater = (
	btn: HTMLElement,
	state: DownloadState,
	percent?: number | null,
) => void;

/**
 * Create the state-machine update function. Callers wire their own
 * active-download counter around `startDownload`.
 */
export function createStateMachine(t: (key: string) => string): StateUpdater {
	const STATES = buildStates(t);

	return function setButtonState(btn, state, percent?) {
		const s = STATES[state] || STATES.idle;
		const icon = btn.querySelector(".h1dl-icon");
		const label = btn.querySelector(".h1dl-label");
		if (icon) {
			icon.textContent = s.icon;
			icon.classList.toggle("h1dl-spin", !!s.spin);
		}
		if (label) {
			label.textContent =
				state === "downloading" && percent != null ? percent + "%" : s.label;
		}
		btn.dataset.state = state;
	};
}

/**
 * Start a single download: resolve qualities (cached), pick the exact one,
 * then hand off to GM_download with progress reflected on the button.
 */
export async function startDownload(
	btn: HTMLElement,
	videoId: string,
	quality: string,
	setState: StateUpdater,
	onActiveChange: (delta: number) => void,
): Promise<void> {
	if (btn.dataset.state === "fetching" || btn.dataset.state === "downloading")
		return;
	setState(btn, "fetching");
	onActiveChange(1);
	try {
		// Reuses the queryQualities cache: if the quality menu already queried
		// this video, we do not hit /download again.
		const list = await queryQualities(videoId);
		const info = list.find((q) => q.quality === quality);
		if (!info) throw new Error("quality not found: " + quality);
		setState(btn, "downloading", 0);
		GM_download({
			url: info.url,
			// GM_download's name is a required string in the vite-plugin-monkey
			// types; undefined falls back to the manager default at runtime.
			name: (info.filename ?? undefined) as string,
			onload: () => {
				onActiveChange(-1);
				setState(btn, "done");
			},
			onerror: () => {
				onActiveChange(-1);
				setState(btn, "error");
			},
			ontimeout: () => {
				onActiveChange(-1);
				setState(btn, "error");
			},
			onprogress: (e: {
				lengthComputable: boolean;
				loaded: number;
				total: number;
			}) => {
				if (e?.lengthComputable) {
					setState(btn, "downloading", Math.round((e.loaded / e.total) * 100));
				}
			},
		});
	} catch (err) {
		onActiveChange(-1);
		console.warn("[h1dl] download failed:", (err as Error)?.message);
		setState(btn, "error");
	}
}

// gmDownload is re-exported for callers that prefer the promise form.
export { gmDownload };
