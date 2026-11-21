import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { configureGmApi } from "@userscripts/shared";
import { createOpenCC } from "../src/transform/opencc";

test("converts via OpenCC dictionaries fetched and cached in GM storage", async () => {
	const store: Record<string, unknown> = {};
	configureGmApi({
		GM_getValue: (k: string, d?: unknown) => (k in store ? store[k] : d),
		GM_setValue: (k: string, v: unknown) => {
			store[k] = v;
		},
	});

	const dictDir = resolve(__dirname, "../node_modules/opencc-js/dist/esm-lib/dict");
	let fetchCount = 0;
	const localFetcher = async (dictName: string) => {
		fetchCount++;
		return readFileSync(resolve(dictDir, `${dictName}.js`), "utf8");
	};

	const conv = await createOpenCC("s2twp", localFetcher);
	expect(conv.convert("软件开发")).toBe("軟體開發");
	expect(fetchCount).toBeGreaterThan(0);

	// Second call uses GM cache with 0 fetches
	const prevCount = fetchCount;
	const conv2 = await createOpenCC("s2twp", localFetcher);
	expect(conv2.convert("软件开发")).toBe("軟體開發");
	expect(fetchCount).toBe(prevCount);
});

test("falls back gracefully without throwing when offline dictionary fetch fails", async () => {
	const store: Record<string, unknown> = {};
	configureGmApi({
		GM_getValue: (k: string, d?: unknown) => (k in store ? store[k] : d),
		GM_setValue: (k: string, v: unknown) => {
			store[k] = v;
		},
	});
	const failingFetch = async () => {
		throw new Error("offline");
	};
	const conv = await createOpenCC("s2t", failingFetch);
	const out = conv.convert("软件");
	expect(out).toBe("軟件");
});
