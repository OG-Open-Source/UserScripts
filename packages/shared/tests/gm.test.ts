import { expect, test } from "bun:test";
import { configureGmApi, gmAddStyle, gmMenuCommand, gmRequest, gmUnregisterMenuCommand } from "../src";

test("gmRequest forwards method, headers, body and resolves response", async () => {
	let captured: Record<string, unknown> | null = null;
	configureGmApi({
		GM_xmlhttpRequest(details: Record<string, unknown>) {
			captured = details;
			(details.onload as (res: unknown) => void)({ status: 200, responseText: '{"ok":true}' });
		},
	});
	const res = await gmRequest({
		method: "POST",
		url: "https://example.com/api",
		headers: { "content-type": "application/json" },
		data: '{"q":"hello"}',
	});
	expect(res.status).toBe(200);
	expect(res.responseText).toBe('{"ok":true}');
	expect(captured?.method).toBe("POST");
	expect(captured?.data).toBe('{"q":"hello"}');
	expect((captured?.headers as Record<string, string> | undefined)?.["content-type"]).toBe("application/json");
});

test("gmRequest rejects on HTTP 4xx/5xx", async () => {
	configureGmApi({
		GM_xmlhttpRequest(details: Record<string, unknown>) {
			(details.onload as (res: unknown) => void)({ status: 403, responseText: "Forbidden" });
		},
	});
	await expect(gmRequest({ url: "https://example.com/api" })).rejects.toThrow("HTTP 403");
});

test("gmMenuCommand forwards options and returns id; gmUnregisterMenuCommand invokes GM API", () => {
	const calls: unknown[] = [];
	configureGmApi({
		GM_registerMenuCommand(caption: string, _cb: () => void, opts?: unknown) {
			calls.push(["reg", caption, opts]);
			return "menu-1";
		},
		GM_unregisterMenuCommand(id: string) {
			calls.push(["unreg", id]);
		},
	});
	const id = gmMenuCommand("Preview: OFF", () => {}, { id: "menu-1", autoClose: false });
	expect(id).toBe("menu-1");
	gmUnregisterMenuCommand("menu-1");
	expect(calls).toEqual([
		["reg", "Preview: OFF", { id: "menu-1", autoClose: false }],
		["unreg", "menu-1"],
	]);

	// Tampermonkey-style numeric menu IDs must be preserved and forwarded to unregister
	const numCalls: unknown[] = [];
	configureGmApi({
		GM_registerMenuCommand(caption: string) {
			numCalls.push(["reg", caption]);
			return 42 as unknown as string;
		},
		GM_unregisterMenuCommand(handle: string | number) {
			numCalls.push(["unreg", handle]);
		},
	});
	const numId = gmMenuCommand("Volunteer Mode: OFF", () => {});
	expect(numId).toBe(42);
	gmUnregisterMenuCommand(numId!);
	expect(numCalls).toEqual([
		["reg", "Volunteer Mode: OFF"],
		["unreg", 42],
	]);
});

test("gmAddStyle calls GM_addStyle when configured and returns null when absent", () => {
	configureGmApi({});
	expect(gmAddStyle("body{}")).toBeNull();

	const fakeEl = { remove() {} } as unknown as HTMLStyleElement;
	let injected = "";
	configureGmApi({
		GM_addStyle(css: string) {
			injected = css;
			return fakeEl;
		},
	});
	expect(gmAddStyle("a{color:red}")).toBe(fakeEl);
	expect(injected).toBe("a{color:red}");
});
