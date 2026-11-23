/**
 * Minimal GM_xmlhttpRequest type declarations.
 *
 * These mirror the subset of the Tampermonkey/Violentmonkey GM API used by
 * this monorepo. Userscript packages get full types from
 * `vite-plugin-monkey/client`; this file covers shared helpers that must stay
 * free of the `$` client alias.
 */

export interface GMXHRResponse {
  responseHeaders?: string;
  responseText: string;
  status: number;
  [key: string]: unknown;
}

export interface GMXHRDetails {
  data?: string;
  headers?: Record<string, string>;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "HEAD" | "PATCH";
  onerror?: (err: unknown) => void;
  onload?: (res: GMXHRResponse) => void;
  ontimeout?: () => void;
  timeout?: number;
  url: string;
  [key: string]: unknown;
}

export interface GMDownloadProgress {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}

export interface GMDownloadDetails {
  name?: string | null;
  onerror?: (err: unknown) => void;
  onload?: () => void;
  onprogress?: (e: GMDownloadProgress) => void;
  ontimeout?: () => void;
  url: string;
  [key: string]: unknown;
}

export type GMMenuHandle = string | number;

export interface GMMenuCommandOptions {
  autoClose?: boolean;
  id?: string;
  title?: string;
}

/** The subset of the GM_* API consumed by shared helpers. */
export interface GMApi {
  GM_addStyle?: (css: string) => HTMLStyleElement | undefined;
  GM_download: (details: GMDownloadDetails) => void;
  GM_getValue: <T = unknown>(key: string, defaultValue?: T) => T;
  GM_registerMenuCommand: (
    caption: string,
    onClick: () => void,
    options?: GMMenuCommandOptions
  ) => GMMenuHandle | undefined;
  GM_setValue: (key: string, value: unknown) => void;
  GM_unregisterMenuCommand?: (menuId: GMMenuHandle) => void;
  GM_xmlhttpRequest: (details: GMXHRDetails) => void;
}
