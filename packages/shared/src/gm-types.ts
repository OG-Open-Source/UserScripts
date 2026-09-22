/**
 * Minimal GM_xmlhttpRequest type declarations.
 *
 * These mirror the subset of the Tampermonkey/Violentmonkey GM API used by
 * this monorepo. Userscript packages get full types from
 * `vite-plugin-monkey/client`; this file covers shared helpers that must stay
 * free of the `$` client alias.
 */

export interface GMXHRResponse {
	status: number;
	responseText: string;
	[key: string]: unknown;
}

export interface GMXHRDetails {
	method?: "GET" | "POST" | "PUT" | "DELETE" | "HEAD" | "PATCH";
	url: string;
	timeout?: number;
	onload?: (res: GMXHRResponse) => void;
	onerror?: (err: unknown) => void;
	ontimeout?: () => void;
	[key: string]: unknown;
}

export interface GMDownloadProgress {
	loaded: number;
	total: number;
	lengthComputable: boolean;
}

export interface GMDownloadDetails {
	url: string;
	name?: string | null;
	onload?: () => void;
	onerror?: (err: unknown) => void;
	ontimeout?: () => void;
	onprogress?: (e: GMDownloadProgress) => void;
	[key: string]: unknown;
}

/** The subset of the GM_* API consumed by shared helpers. */
export interface GMApi {
	GM_xmlhttpRequest: (details: GMXHRDetails) => void;
	GM_download: (details: GMDownloadDetails) => void;
	GM_getValue: <T = unknown>(key: string, defaultValue?: T) => T;
	GM_setValue: (key: string, value: unknown) => void;
	GM_registerMenuCommand: (caption: string, onClick: () => void) => void;
}
