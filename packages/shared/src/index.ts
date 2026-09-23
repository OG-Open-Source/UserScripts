/**
 * @userscripts/shared — common utilities and types for all userscripts.
 */

export { claimCapabilities } from "./capability";
export type { ClaimResult, ScriptClaim, ScriptKind } from "./capability";
export {
  configureGmApi,
  gmDownload,
  gmFetch,
  gmGet,
  gmMenuCommand,
  gmSet,
  MANAGER_URL,
  openSettings,
} from "./gm";
export type {
  GMApi,
  GMDownloadDetails,
  GMDownloadProgress,
  GMXHRDetails,
  GMXHRResponse,
} from "./gm-types";
export { createI18n, detectLang, loadLocales } from "./i18n";
export type { I18nInstance, I18nOptions, LocaleEntry, LocaleFile, LocaleSource } from "./i18n";
export { publishPresence, readPresence, waitForPresence } from "./presence";
export type { ScriptPresence } from "./presence";
export type { NativeTheme } from "./theme";

export { probeTheme } from "./theme";
export type { BatchEntry, DownloadState, QualityInfo, ResolvedQuality } from "./types";
