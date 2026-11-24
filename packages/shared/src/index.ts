/**
 * @userscripts/shared — common utilities and types for all userscripts.
 */

export type { Oklab, Oklch, ZeroErrorOklchResult } from "./color";
export {
  formatOklch,
  formatZeroErrorOklch,
  getAccessibleTextOklch,
  hexToOklab,
  hexToZeroErrorOklch,
  NOVAKIT,
  normalizeHex,
  oklabToHex,
  oklabToOklch,
  oklchToHex,
  oklchToOklab,
  US_PALETTE_HEX,
  US_PALETTE_OKLCH,
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
  isTopFrame,
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
export { getSettingsTokensCss, getUiTokensCss } from "./ui-tokens";
