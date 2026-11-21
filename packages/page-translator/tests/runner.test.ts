import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { collectSegments } from "../src/capture/segmenter";
import { DEFAULT_CONFIG } from "../src/config";
import { parseSiteDelta } from "../src/site-rules";
import { createBatchRunner } from "../src/translate/runner";

test("invalidate() cancels in-flight translation batch so restored DOM stays untouched", async () => {
	const win = new Window();
	win.document.body.innerHTML = `<div>Hello world.</div>`;
	const segs = collectSegments(win.document.body as unknown as Element, parseSiteDelta(""), {
		getStyle: (el) => ({
			display: el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
			visibility: "visible",
		}),
	});

	let resolveBatch!: (val: string[]) => void;
	const slowProvider = {
		id: "slow",
		translateBatch: () =>
			new Promise<string[]>((r) => {
				resolveBatch = r;
			}),
	};

	const runner = createBatchRunner({
		doc: win.document as unknown as Document,
		delta: parseSiteDelta(""),
		getConfig: () => DEFAULT_CONFIG,
		getProvider: () => slowProvider,
	});

	const job = runner.translateBatch(segs);
	expect(win.document.querySelector("[data-tr-block]")).not.toBeNull();

	// User clicks Restore Original while API request is still in-flight
	runner.cancelAll();
	const { restoreAll } = await import("../src/renderer");
	restoreAll(win.document.body as unknown as ParentNode);
	expect(win.document.querySelector("[data-tr-block]")).toBeNull();

	// In-flight API resolves afterwards -> must NOT re-wrap or render into DOM
	resolveBatch(["你好世界。"]);
	await job;
	expect(win.document.querySelector("[data-tr-block]")).toBeNull();
	expect(win.document.body.textContent).toBe("Hello world.");
});

test("routes zh-TW skip, zh-CN local OpenCC (0 API calls), and volunteer static/dynamic hits (0 API calls)", async () => {
	const win = new Window();
	win.document.body.innerHTML = `
    <div>這是繁體中文的網頁測試段落，用來驗證文字系統跳過。</div>
    <div>这是简体中文的网页测试段落，用来验证本地转换。</div>
    <div>Pull requests</div>
    <div>5 hours ago</div>
    <div>Welcome to open source software.</div>
  `;
	const segs = collectSegments(win.document.body as unknown as Element, parseSiteDelta(""), {
		getStyle: (el) => ({
			display: el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
			visibility: "visible",
		}),
	});

	const sentToApi: string[] = [];
	const runner = createBatchRunner({
		doc: win.document as unknown as Document,
		delta: parseSiteDelta(""),
		getConfig: () => ({ ...DEFAULT_CONFIG, targetLang: "zh-TW" }),
		getProvider: () => ({
			id: "mock",
			async translateBatch(items: string[]) {
				sentToApi.push(...items);
				return items.map(() => "歡迎來到開源軟體。");
			},
		}),
		getOpenCC: async () => ({
			convert: (s: string) => s.replace("简体", "繁體").replace("网页", "網頁").replace("本地转换", "本地轉換"),
		}),
		getSiteLocaleTable: () => ({
			static: { "Pull requests": "拉取請求" },
			dynamic: { "{v0} hours ago": "{v0} 小時前" },
		}),
	});

	await runner.translateBatch(segs);

	// Only the English paragraph went to the translation API!
	expect(sentToApi.length).toBe(1);
	expect(sentToApi[0]).toContain("Welcome to open source software.");

	const divs = Array.from(win.document.querySelectorAll("body > div"));
	// Div 0 (zh-TW) was skipped untouched (no [data-tr-block] wrapper)
	expect(divs[0]?.querySelector("[data-tr-block]")).toBeNull();
	// Div 1 (zh-CN) was converted locally via OpenCC
	expect(divs[1]?.querySelector("[data-tr-dst]")?.textContent).toContain("繁體");
	// Div 2 & 3 came from volunteer dictionary
	expect(divs[2]?.querySelector("[data-tr-dst]")?.textContent).toBe("拉取請求");
	expect(divs[3]?.querySelector("[data-tr-dst]")?.textContent).toBe("5 小時前");
	// Div 4 came from API
	expect(divs[4]?.querySelector("[data-tr-dst]")?.textContent).toBe("歡迎來到開源軟體。");
});

test("pageCache hits still apply opencc post-processing and runner preserves inspect kinds", async () => {
	const win = new Window();
	win.document.body.innerHTML = `
    <div>Hello world</div>
    <div>Hello world</div>
    <div>Updated 5 hours ago</div>
  `;
	const segs = collectSegments(win.document.body as unknown as Element, parseSiteDelta(""), {
		getStyle: (el) => ({
			display: el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
			visibility: "visible",
		}),
	});

	let apiCalls = 0;
	const runner = createBatchRunner({
		doc: win.document as unknown as Document,
		delta: parseSiteDelta(""),
		getConfig: () => ({ ...DEFAULT_CONFIG, targetLang: "zh-TW", openccMode: "s2t", debugInspect: true }),
		getProvider: () => ({
			id: "mock",
			async translateBatch(items: string[]) {
				apiCalls++;
				return items.map((s) => (s.includes("Hello") ? "你好软件" : "更新於 5 小時前"));
			},
		}),
		getOpenCC: async () => ({ convert: (s: string) => s.replace("软件", "軟體") }),
	});

	// Translate first segment (populates pageCache), then translate second (hits pageCache) + third
	await runner.translateBatch([segs[0]!]);
	await runner.translateBatch([segs[1]!, segs[2]!]);

	expect(apiCalls).toBe(2);
	const divs = Array.from(win.document.querySelectorAll("body > div"));
	expect(divs[0]?.querySelector("[data-tr-dst]")?.textContent).toBe("你好軟體");
	// Cached hit MUST also be converted by OpenCC!
	expect(divs[1]?.querySelector("[data-tr-dst]")?.textContent).toBe("你好軟體");
	// Dynamic segment keeps auto-dynamic inspect kind
	expect(divs[2]?.getAttribute("data-tr-inspect-kind")).toBe("auto-dynamic");
});

test("runner ignores <html lang> and routes each segment purely by its own content + scoped dictionary + metrics", async () => {
	const { createPtrMetrics } = await import("../src/metrics");
	const win = new Window();
	win.document.documentElement.setAttribute("lang", "zh-TW");
	win.document.body.innerHTML = `
    <nav aria-label="Repository"><div id="n1">Insights</div></nav>
    <div id="e1">Welcome to repository insights.</div>
    <div id="z1">這是已經是繁體中文的段落，不應送出翻譯。</div>
  `;
	const segs = collectSegments(win.document.body as unknown as Element, parseSiteDelta(""), {
		getStyle: (el) => ({
			display: el.tagName === "DIV" || el.tagName === "BODY" || el.tagName === "NAV" ? "block" : "inline",
			visibility: "visible",
		}),
	});
	const sentToApi: string[] = [];
	const metrics = createPtrMetrics();
	const runner = createBatchRunner({
		doc: win.document as unknown as Document,
		delta: parseSiteDelta(""),
		metrics,
		getConfig: () => ({ ...DEFAULT_CONFIG, targetLang: "zh-TW" }),
		getProvider: () => ({
			id: "mock",
			async translateBatch(items: string[]) {
				sentToApi.push(...items);
				return items.map(() => "歡迎查看儲存庫洞察。");
			},
		}),
		getSiteLocaleTable: () => ({
			static: { Insights: "見解" },
			scoped: { "nav[aria-label='Repository']": { static: { Insights: "洞察分析" } } },
		}),
	});
	await runner.translateBatch(segs);
	expect(sentToApi).toEqual(["Welcome to repository insights."]);
	expect(win.document.querySelector("#n1 [data-tr-dst]")?.textContent).toBe("洞察分析");
	expect(win.document.querySelector("#z1 [data-tr-block]")).toBeNull();
	expect(metrics.routing.api).toBe(2);
	expect(metrics.routing.skip).toBe(1);
	expect(metrics.segments.scopedHits).toBe(1);
	expect(metrics.apiBatches).toBe(1);
});
