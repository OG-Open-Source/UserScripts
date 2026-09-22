/**
 * Promise-wrapped GM helpers.
 *
 * Shared code receives the GM API via dependency injection (`configureGmApi`)
 * instead of importing the vite-plugin-monkey `$` client alias directly —
 * this keeps @userscripts/shared decoupled from any specific userscript build.
 *
 * The injected object is stored loosely and asserted internally, so callers
 * can pass through whichever manager-provided GM API they use without
 * fighting signature incompatibilities.
 */
import type { GMApi, GMDownloadDetails, GMXHRDetails } from "./gm-types";

let api: GMApi | null = null;

/**
 * Inject the GM API implementation. Called once at userscript entry, e.g.:
 *
 * ```ts
 * import { GM_download, GM_getValue, GM_registerMenuCommand, GM_setValue, GM_xmlhttpRequest } from '$';
 * configureGmApi({ GM_xmlhttpRequest, GM_download, GM_getValue, GM_setValue, GM_registerMenuCommand });
 * ```
 *
 * Accepts `unknown` on purpose: the runtime shape is asserted by `getApi()`
 * below, so callers never have to reconcile manager-specific signatures.
 */
export function configureGmApi(gm: unknown): void {
	api = gm as GMApi;
}

function getApi(): GMApi {
	if (!api) {
		throw new Error(
			"[@userscripts/shared] GM API not configured — call configureGmApi() at script entry.",
		);
	}
	return api;
}

/**
 * Fetch a URL via GM_xmlhttpRequest and resolve with the response body.
 *
 * @param url Absolute URL to fetch.
 * @param timeout Request timeout in milliseconds (default 20s).
 */
export function gmFetch(url: string, timeout = 20000): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const details: GMXHRDetails = {
			method: "GET",
			url,
			timeout,
			onload: (res) => {
				if (res.status >= 200 && res.status < 400) resolve(res.responseText);
				else reject(new Error("HTTP " + res.status));
			},
			onerror: () => reject(new Error("network error")),
			ontimeout: () => reject(new Error("timeout")),
		};
		getApi().GM_xmlhttpRequest(details);
	});
}

/** Wrap GM_download into a promise that resolves on load, rejects on error. */
export function gmDownload(details: GMDownloadDetails): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		getApi().GM_download({
			...details,
			onload: () => {
				details.onload?.();
				resolve();
			},
			onerror: (err) => {
				details.onerror?.(err);
				reject(new Error("download error"));
			},
			ontimeout: () => {
				details.ontimeout?.();
				reject(new Error("download timeout"));
			},
		});
	});
}

/** Read a stored value, falling back to the default. */
export function gmGet<T>(key: string, defaultValue: T): T {
	return getApi().GM_getValue<T>(key, defaultValue);
}

/** Store a value. */
export function gmSet(key: string, value: unknown): void {
	getApi().GM_setValue(key, value);
}

/** Register a Violentmonkey/Tampermonkey popup menu command. */
export function gmMenuCommand(caption: string, onClick: () => void): void {
	getApi().GM_registerMenuCommand(caption, onClick);
}
