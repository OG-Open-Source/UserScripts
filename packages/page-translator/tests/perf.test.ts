import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { configureGmApi } from "@userscripts/shared";
import { Window } from "happy-dom";
import { collectSegments } from "../src/legacy/capture/segmenter";
import { parseSiteDelta } from "../src/legacy/site-rules";
import { syncShadowRootsOnly } from "../src/legacy/styles";
import { createOpenCC } from "../src/legacy/transform/opencc";

test("createOpenCC memoizes converter instance per mode/fetcher (no repeated GM/Trie rebuild)", async () => {
  const store: Record<string, unknown> = {};
  let gmGetCalls = 0;
  configureGmApi({
    GM_getValue: (k: string, d?: unknown) => {
      gmGetCalls++;
      return k in store ? store[k] : d;
    },
    GM_setValue: (k: string, v: unknown) => {
      store[k] = v;
    },
  });

  const dictDir = resolve(
    import.meta.dirname,
    "../node_modules/opencc-js/dist/esm-lib/dict"
  );
  const fetcher = async (dictName: string) =>
    readFileSync(resolve(dictDir, `${dictName}.js`), "utf8");

  const c1 = await createOpenCC("s2t", fetcher);
  const getsAfterFirst = gmGetCalls;
  const c2 = await createOpenCC("s2t", fetcher);
  expect(c1).toBe(c2);
  expect(gmGetCalls).toBe(getsAfterFirst);
});

test("segmenter handles deeply nested inline spans with O(N) memoization and passes modifiers top-down", () => {
  const win = new Window();
  const depth = 60;
  const open = "<span>".repeat(depth);
  const close = "</span>".repeat(depth);
  win.document.body.innerHTML = `<div class="wrap">${open}Deeply nested prose.${close}</div>`;
  const delta = parseSiteDelta("* .wrap : no-spacing");
  const segs = collectSegments(win.document.body as unknown as Element, delta, {
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
      visibility: "visible",
    }),
  });
  expect(segs.length).toBe(1);
  expect(segs[0]?.modifiers.has("no-spacing")).toBe(true);
});

test("syncShadowRootsOnly styles shadow roots without touching document head", () => {
  const win = new Window();
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  syncShadowRootsOnly(
    win.document as unknown as Document,
    { customCss: "", customFont: "", debugInspect: false },
    [shadow as unknown as ShadowRoot]
  );
  expect(win.document.getElementById("ptr-user-css")).toBeNull();
  const hasStyle =
    shadow.getElementById("ptr-user-css") !== null ||
    shadow.adoptedStyleSheets.length > 0;
  expect(hasStyle).toBe(true);
});
