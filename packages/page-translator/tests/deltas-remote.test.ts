import { expect, test } from "bun:test";
import { configureGmApi } from "@userscripts/shared";
import { loadRemoteDeltas } from "../src/deltas-remote";

test("loadRemoteDeltas returns cached data immediately and refreshes in background", async () => {
  const store: Record<string, unknown> = {
    "ptr:remote-deltas": {
      version: 1,
      glossary: ["GitHub"],
      sites: { "github.com": "- .old" },
    },
  };
  let refreshed = false;
  configureGmApi({
    GM_getValue: (k: string, d?: unknown) => (k in store ? store[k] : d),
    GM_setValue: (k: string, v: unknown) => {
      store[k] = v;
    },
    GM_xmlhttpRequest(details: Record<string, unknown>) {
      (details.onload as (r: unknown) => void)({
        status: 200,
        responseText: JSON.stringify({
          version: 2,
          glossary: ["GitHub", "TypeScript"],
          sites: { "github.com": '- [class*="languageList__"]' },
        }),
      });
    },
  });

  const first = await loadRemoteDeltas(
    "https://example.com/deltas.json",
    () => {
      refreshed = true;
    }
  );
  expect(first.version).toBe(1);
  await new Promise((r) => setTimeout(r, 10));
  expect(refreshed).toBe(true);
  expect((store["ptr:remote-deltas"] as { version: number }).version).toBe(2);
});
