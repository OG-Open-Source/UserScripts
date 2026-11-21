/**
 * @userscripts/shared — common utilities and types for all userscripts.
 */

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
export type { I18nInstance, I18nOptions, LocaleEntry, LocaleFile, LocaleSource } from "./i18n";
export { createI18n, detectLang, loadLocales } from "./i18n";
export type { ScriptPresence } from "./presence";
export { isManagerPage, publishPresence, readPresence, waitForPresence } from "./presence";
export type { NativeTheme } from "./theme";
export { probeTheme } from "./theme";
export type { BatchEntry, DownloadState, QualityInfo, ResolvedQuality } from "./types";
export { getUiTokensCss } from "./ui-tokens";
