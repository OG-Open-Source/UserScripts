/**
 * @userscripts/shared — common utilities and types for all userscripts.
 */

export type { Oklab, Oklch } from "./color";
export {
  formatOklch,
  getAccessibleTextOklch,
  hexToOklab,
  NOVAKIT,
  oklabToHex,
  oklabToOklch,
  oklchToOklab,
} from "./color";
export { isForeignUi, isUsUiEvent, markUiRoot, US_UI_ATTR } from "./conflict";
export type { DragControllerOptions } from "./drag";
export { createDragController } from "./drag";
export type { GMRequestOptions } from "./gm";
export {
  configureGmApi,
  gmAddStyle,
  gmDownload,
  gmFetch,
  gmGet,
  gmMenuCommand,
  gmRequest,
  gmSet,
  gmUnregisterMenuCommand,
  MANAGER_URL,
} from "./gm";
export type {
  GMApi,
  GMDownloadDetails,
  GMDownloadProgress,
  GMMenuCommandOptions,
  GMMenuHandle,
  GMXHRDetails,
  GMXHRResponse,
} from "./gm-types";
export type {
  I18nInstance,
  I18nOptions,
  LocaleEntry,
  LocaleFile,
  LocaleSource,
} from "./i18n";
export { createI18n, detectLang, loadLocales } from "./i18n";
export type { ScriptPresence } from "./presence";
export {
  isManagerPage,
  publishPresence,
  readPresence,
  waitForPresence,
} from "./presence";
export type { NativeTheme } from "./theme";
export { probeTheme } from "./theme";
export type { ThemeColors, ThemeMode, ThemeTokens } from "./theme-mode";
export {
  applyThemeModeToElement,
  cssColorToHex,
  DEFAULT_THEME_MODE_STORAGE_KEY,
  parseThemeMode,
  probeHostColors,
  readThemeMode,
  resolveThemeTokens,
} from "./theme-mode";
export type {
  BatchEntry,
  DownloadState,
  QualityInfo,
  ResolvedQuality,
} from "./types";
export { getUiTokensCss } from "./ui-tokens";
