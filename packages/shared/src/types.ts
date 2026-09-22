/**
 * Shared types used across userscripts.
 */

/** A single downloadable quality option resolved from a video page. */
export interface QualityInfo {
	/** Quality label, e.g. "1080p". */
	quality: string;
	/** Direct download URL (time-limited secure= params). */
	url: string;
	/** Suggested filename from the site's download attribute. */
	filename: string | null;
}

/** State machine values for download buttons. */
export type DownloadState =
	| "idle"
	| "fetching"
	| "downloading"
	| "done"
	| "error";

/** A card tracked by the batch-download system (one entry per CARD, not per video). */
export interface BatchEntry {
	card: HTMLElement;
	check: HTMLElement;
	videoId: string;
	checked: boolean;
	state: DownloadState;
	tick: HTMLElement | null;
}

/** Result of resolving a quality with fallback applied. */
export interface ResolvedQuality {
	info: QualityInfo;
	quality: string;
}
