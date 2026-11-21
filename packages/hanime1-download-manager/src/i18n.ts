/**
 * English strings bundled with the script.
 *
 * The script body stays English-only. Every other language lives in the one
 * locales.json published next to the script; the script fetches that file
 * instead of listing translations itself.
 */

export type Hanime1MessageKey =
  | "download"
  | "fetching"
  | "done"
  | "error"
  | "loadingQualities"
  | "noQualities"
  | "selectAll"
  | "selectNone"
  | "downloadSelected"
  | "chooseBatchQuality"
  | "downgradeNotice"
  | "queue"
  | "options"
  | "preferredQuality"
  | "themeRule"
  | "themeSystem"
  | "themeLight"
  | "themeDark"
  | "themeHost"
  | "queued"
  | "autoQuality";

export const MESSAGES: Record<Hanime1MessageKey, string> = {
  download: "Download",
  fetching: "Resolving",
  done: "Done",
  error: "Failed",
  loadingQualities: "Loading qualities…",
  noQualities: "No downloadable quality",
  selectAll: "Select all",
  selectNone: "Select none",
  downloadSelected: "Download selected",
  chooseBatchQuality: "Choose batch quality (auto-downgrade if unavailable)",
  downgradeNotice: "Quality downgraded:",
  queue: "Batch Queue",
  options: "Options",
  preferredQuality: "Preferred Quality",
  themeRule: "UI Theme Rule",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
  themeHost: "Host Page",
  queued: "queued",
  autoQuality: "Auto (1080p → 480p)",
};
