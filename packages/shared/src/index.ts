/**
 * @userscripts/shared — common utilities and types for all userscripts.
 */

export {
    configureGmApi,
    gmDownload,
    gmFetch,
    gmGet,
    gmMenuCommand,
    gmSet
} from "./gm";
export type {
    GMApi,
    GMDownloadDetails,
    GMDownloadProgress,
    GMXHRDetails,
    GMXHRResponse
} from "./gm-types";
export type { I18nInstance, I18nOptions } from "./i18n";

export { createI18n, detectLang } from "./i18n";
export type { NativeTheme } from "./theme";

export { probeTheme } from "./theme";
export type {
    BatchEntry,
    DownloadState,
    QualityInfo,
    ResolvedQuality
} from "./types";

