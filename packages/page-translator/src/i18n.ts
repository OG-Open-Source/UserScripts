/**
 * Default English strings for Page Translator.
 * Additional languages live in ../locales.json.
 */
export const MESSAGES_EN = {
  translatePage: "Translate Page",
  restorePage: "Restore Original",
  inspectMode: "Capture Preview: {state}",
  volunteerMode: "Volunteer Mode: {state}",
  volunteerBlockClicks: "Volunteer Click Lock: {state}",
  openSettings: "Open Settings",
  on: "ON",
  off: "OFF",
  translating: "Translating...",
  translated: "Translated",
  error: "Translation failed",

  // Capture Preview HUD
  hudTitle: "Capture Preview",
  hudSpaceChip: "space: {mode}",
  hudAutospaceNative: "autospace: native",
  hudAutospaceUnsupported: "autospace: off/unsupported",
  segStatic: "static",
  segDynamic: "auto-dynamic",
  segPlus: "+",
  segManual: "manual",
  hoverHint: "Hover any outlined block to inspect capture metadata.",
  kvScope: "Scope",
  kvTemplate: "Template",
  kvValues: "Values",
  kvSpacing: "Spacing",
  secCapture: "1. Page Capture & Routing",
  secPerf: "2. Timing & Cache",
  mSegments: "Segments",
  mScopedHits: "Scoped Hits",
  mRouteApi: "API Route",
  mRouteOpencc: "OpenCC",
  mRouteSkip: "Skipped",
  mDict: "Dict",
  mLangDetector: "LangDetector",
  mKeywords: "Keywords",
  ldAvailable: "available",
  ldUnavailable: "unavailable",
  mInitialScan: "Initial Scan",
  mLastScan: "Last Scan",
  mNodes: "Nodes",
  mCacheHit: "Cache Hit",
  mCacheMiss: "Cache Miss",
  mCacheRate: "Cache Hit Rate",
  mApiBatches: "API Batches",
  mApiAvg: "Avg API",
  mMutations: "Mutation Batches",
  mExcluded: "Excluded",
  mShadowRoots: "Shadow Roots",
  btnDetails: "Details",
  btnExportAi: "Export for AI",
  btnCopyDiag: "Copy JSON",
  hudExportedAi: "Copied AI prompt + {count} segments to clipboard.",
  hudExportDenied: "Clipboard denied — downloaded AI prompt instead.",

  // Volunteer Workbench
  volTitle: "Volunteer · {host}",
  volLockOn: "Lock: ON",
  volLockOff: "Lock: OFF",
  volLockOnMsg: "Click lock ON — page navigation disabled.",
  volLockOffMsg: "Click lock OFF — normal clicks restored.",
  volRescan: "Rescan",
  volStatStatic: "Static",
  volStatDynamic: "Dynamic",
  volStatHits: "Manual Hits",
  volBadgeStatic: "STATIC",
  volBadgeDynamic: "DYNAMIC",
  volScope: "Scope",
  volTrans: "Trans",
  volSuggest: "Suggest",
  volPrev: "Prev",
  volNext: "Next",
  volSave: "Save & Preview",
  volCopyJson: "Copy JSON",
  volDownload: "{host}.json",
  volExportAi: "Export AI",
  volImportAi: "Import AI",
  volImportPlaceholder:
    "Paste AI JSON ({ translations } or SiteTranslationsFile)…",
  volImportApply: "Apply Import",
  volImportCancel: "Cancel",
  volImported: "Imported {count} draft translation(s).",
  volImportedSync:
    "Synced {synced} translation(s); {conflicts} conflict(s) pending.",
  volImportError: "Invalid AI JSON payload.",
  volConflictsHeader: "Import Conflicts ({count})",
  volConflictExisting: "Existing",
  volConflictImported: "Imported",
  volConflictKeep: "Keep Existing",
  volConflictOverwrite: "Use Imported",
  volConflictKeepAll: "Keep All",
  volConflictOverwriteAll: "Overwrite All",
  volConflictResolved: "Conflict resolution applied.",
  volSaved: "Saved draft. Preview: {preview}",
  volSavedScoped: "Saved draft (scoped to {scope}). Preview: {preview}",
  volCopied: "Copied JSON to clipboard.",
  volCopyDenied: "Clipboard denied — use Download instead.",
  volEmpty: "No translatable segments captured yet.",
  volValues: "values",
  volScopePlaceholder: "Scope CSS selector (optional)",
  volTransPlaceholder: "Enter translation ({lang})…",
  volDraftReady: "Draft ready",
} as const;

export type PtrMessageKey = keyof typeof MESSAGES_EN;
export type MessageKey = PtrMessageKey;

export function formatPtrMsg(
  template: string,
  vars?: Record<string, string | number>
): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{(?<key>[A-Za-z0-9_]+)\}/gu, (m, k: string) =>
    k in vars ? String(vars[k]) : m
  );
}
