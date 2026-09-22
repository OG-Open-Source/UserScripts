/**
 * API layer — query the available qualities for a video by parsing its
 * /download page, and extract video IDs from links/cards.
 *
 * secure= params are time-limited, so results are cached per page load only.
 */

import type { QualityInfo } from "@userscripts/shared";
import { gmFetch } from "@userscripts/shared";

/** Path to the site's download page (quality list is queried per video). */
const DL_PATH = "/download?v=";

/** videoId -> qualityInfo[] (session only; secure= params are time-limited). */
const qualityCache = new Map<string, QualityInfo[]>();

/**
 * Query the available qualities for a video by parsing its /download page.
 * Results are cached per page load: if the quality menu already queried this
 * video, we do not hit /download again.
 */
export function queryQualities(videoId: string): Promise<QualityInfo[]> {
	if (qualityCache.has(videoId)) {
		return Promise.resolve(qualityCache.get(videoId) as QualityInfo[]);
	}
	return gmFetch(location.origin + DL_PATH + videoId).then((html: string) => {
		const doc = new DOMParser().parseFromString(html, "text/html");
		const list: QualityInfo[] = [];
		doc
			.querySelectorAll("table.download-table tbody tr")
			.forEach((tr: Element) => {
				const link = tr.querySelector("a[data-url]");
				if (!link) return;
				const m = /(\d{3,4}p)/.exec(tr.textContent ?? "");
				if (!m) return;
				list.push({
					quality: m[1],
					url: (link as HTMLAnchorElement).dataset.url as string,
					filename: (link as HTMLAnchorElement).getAttribute("download"),
				});
			});
		qualityCache.set(videoId, list);
		return list;
	});
}

/** Extract the video id from a link's href or a card containing one. */
export function extractVideoId(
	node: Element | string | null | undefined,
): string | null {
	const href =
		typeof node === "string"
			? node
			: (node?.getAttribute?.("dataset" in node ? "data-href" : "href") ??
				node?.getAttribute?.("href") ??
				null);
	if (href) {
		const m = /[?&]v=([^&]+)/.exec(href);
		if (m) return m[1];
	}
	if (node && typeof node === "object" && "querySelector" in node) {
		const link = node.querySelector('a[href*="watch?v="]');
		if (link) {
			const m = /[?&]v=([^&]+)/.exec(link.getAttribute("href") ?? "");
			if (m) return m[1];
		}
	}
	return null;
}

/**
 * Resolve a direct link for the requested quality, falling back to the next
 * lower quality when the requested one is unavailable for a video.
 * Shares the queryQualities cache so single/batch downloads hit the page at
 * most once per video per page load.
 */
export async function resolveWithFallback(
	videoId: string,
	quality: string,
	qualities: string[],
): Promise<{ info: QualityInfo; quality: string } | null> {
	const list = await queryQualities(videoId);
	const idx = qualities.indexOf(quality);
	// Try requested quality, then lower ones.
	for (let i = idx; i < qualities.length; i++) {
		const info = list.find((q) => q.quality === qualities[i]);
		if (info) return { info, quality: qualities[i] };
	}
	return null;
}
