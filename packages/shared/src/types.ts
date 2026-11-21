/**
 * Shared types used across userscripts.
 */

/** A single downloadable quality option resolved from a video page. */
export interface QualityInfo {
  /** Suggested filename from the site's download attribute. */
  filename: string | null;
  /** Quality label, e.g. "1080p". */
  quality: string;
  /** Direct download URL (time-limited secure= params). */
  url: string;
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
  checked: boolean;
  state: DownloadState;
  tick: HTMLElement | null;
  videoId: string;
}

/** Result of resolving a quality with fallback applied. */
export interface ResolvedQuality {
  info: QualityInfo;
  quality: string;
}
