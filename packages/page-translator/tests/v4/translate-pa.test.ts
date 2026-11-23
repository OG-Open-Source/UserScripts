import { expect, test } from "bun:test";
import { configureGmApi } from "@userscripts/shared";
import { createInspectProvider } from "../../src/providers/inspect";
import { createTranslatePaProvider } from "../../src/providers/translate-pa";

test("translate-pa sends POST with X-Goog-Api-Key and parses translated array", async () => {
  let req: Record<string, unknown> | null = null;
  configureGmApi({
    GM_xmlhttpRequest(details: Record<string, unknown>) {
      req = details;
      (details.onload as (r: unknown) => void)({
        status: 200,
        responseText: JSON.stringify([["你好世界", "第二段"], "en"]),
      });
    },
  });
  const provider = createTranslatePaProvider({ apiKey: "TEST_KEY" });
  const out = await provider.translateBatch(
    ["Hello world", "Second paragraph"],
    { targetLang: "zh-TW" }
  );
  expect(req?.url).toBe("https://translate-pa.googleapis.com/v1/translateHtml");
  expect(req?.method).toBe("POST");
  expect(
    (req?.headers as Record<string, string> | undefined)?.["X-Goog-Api-Key"]
  ).toBe("TEST_KEY");
  expect(out).toEqual(["你好世界", "第二段"]);
});

test("inspect provider echoes payload without network calls", async () => {
  const provider = createInspectProvider();
  const out = await provider.translateBatch(["Hello", "World"], {
    targetLang: "zh-TW",
  });
  expect(out).toEqual(["Hello", "World"]);
});

test("translate-pa translateGrouped wraps context groups and extracts per-id inner HTML", async () => {
  let sentBody = "";
  configureGmApi({
    GM_xmlhttpRequest(details: Record<string, unknown>) {
      sentBody = String(details.data ?? "");
      (details.onload as (r: unknown) => void)({
        status: 200,
        responseText: JSON.stringify([
          [
            '<div data-ptr-g="0"><p data-ptr-s="u0">儲存</p><p data-ptr-s="u1">取消</p></div>',
          ],
          "en",
        ]),
      });
    },
  });
  const provider = createTranslatePaProvider({ apiKey: "TEST_KEY" });
  if (!provider.translateGrouped) {
    throw new Error("expected translateGrouped");
  }
  const map = await provider.translateGrouped(
    [
      [
        { id: "u0", html: "Save" },
        { id: "u1", html: "Cancel" },
      ],
    ],
    { targetLang: "zh-TW" }
  );
  expect(sentBody).toContain('data-ptr-s=\\"u0\\"');
  expect(map.get("u0")).toBe("儲存");
  expect(map.get("u1")).toBe("取消");
});
