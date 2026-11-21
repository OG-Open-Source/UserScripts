import { expect, test } from "bun:test";
import { configureGmApi } from "@userscripts/shared";
import {
  extractTemplate,
  interpolateTemplate,
  matchSiteTranslation,
  suggestScopeSelector,
} from "../src/transform/template";
import {
  deleteCachedSiteTranslations,
  deleteLayeredSiteTranslations,
  listCachedSiteTranslations,
  listLayeredSiteTranslations,
  loadLocalSiteTranslations,
  loadSiteTranslations,
  mergeLocaleTables,
  mergeLocalSiteLocaleTable,
  mergeSiteTranslations,
  saveCachedSiteTranslations,
  saveLocalSiteTranslations,
} from "../src/translations-remote";

test("extractTemplate separates static text from dynamic values (numbers, handles, atomic slots)", () => {
  expect(extractTemplate("Pull requests")).toEqual({
    kind: "static",
    template: "Pull requests",
    values: [],
  });

  expect(extractTemplate("Updated 5 hours ago")).toEqual({
    kind: "dynamic",
    template: "Updated {v0} hours ago",
    values: ["5"],
  });

  expect(extractTemplate("Showing 1,234 of 5,600 results by @octocat")).toEqual(
    {
      kind: "dynamic",
      template: "Showing {v0} of {v1} results by {v2}",
      values: ["1,234", "5,600", "@octocat"],
    }
  );

  expect(extractTemplate('Type <x id="0"/> to search')).toEqual({
    kind: "dynamic",
    template: "Type {v0} to search",
    values: ['<x id="0"/>'],
  });

  expect(extractTemplate("Release v1.0.2 is ready")).toEqual({
    kind: "static",
    template: "Release v1.0.2 is ready",
    values: [],
  });
});

test("interpolateTemplate and matchSiteTranslation resolve static and dynamic volunteer entries", () => {
  expect(interpolateTemplate("更新於 {v0} 小時前", ["5"])).toBe(
    "更新於 5 小時前"
  );

  const dict = {
    static: { "Pull requests": "拉取請求" },
    dynamic: {
      "Updated {v0} hours ago": "更新於 {v0} 小時前",
      "Type {v0} to search": "按 {v0} 搜尋",
    },
  };

  expect(matchSiteTranslation("Pull requests", dict)).toEqual({
    kind: "static",
    html: "拉取請求",
  });
  expect(matchSiteTranslation("Updated 12 hours ago", dict)).toEqual({
    kind: "dynamic",
    html: "更新於 12 小時前",
  });
  expect(matchSiteTranslation('Type <x id="0"/> to search', dict)).toEqual({
    kind: "dynamic",
    html: '按 <x id="0"/> 搜尋',
  });
  expect(matchSiteTranslation("Unknown sentence", dict)).toBeNull();
});

test("loadSiteTranslations caches per-host volunteer JSON in GM storage and handles 404 gracefully", async () => {
  const store: Record<string, unknown> = {};
  configureGmApi({
    GM_getValue: (k: string, d?: unknown) => (k in store ? store[k] : d),
    GM_setValue: (k: string, v: unknown) => {
      store[k] = v;
    },
    GM_xmlhttpRequest(details: Record<string, unknown>) {
      if ((details.url as string).endsWith("/github.com.json")) {
        (details.onload as (r: unknown) => void)({
          status: 200,
          responseText: JSON.stringify({
            version: 1,
            host: "github.com",
            locales: {
              "zh-Hant-TW": {
                static: { Issues: "議題" },
                dynamic: { "{v0} stars": "{v0} 顆星" },
              },
            },
          }),
        });
      } else {
        (details.onload as (r: unknown) => void)({
          status: 404,
          responseText: "Not Found",
        });
      }
    },
  });

  const gh = await loadSiteTranslations(
    "https://example.com/translations",
    "github.com"
  );
  expect(gh?.locales["zh-Hant-TW"]?.static.Issues).toBe("議題");

  const missing = await loadSiteTranslations(
    "https://example.com/translations",
    "unknown.example"
  );
  expect(missing).toBeNull();
});

test("matchSiteTranslation evaluates scoped CSS selectors before global static/dynamic and survives invalid selectors", () => {
  const { Window } = require("happy-dom");
  const win = new Window();
  win.document.body.innerHTML = `
    <nav aria-label="Repository"><a id="nav-ins">Insights</a></nav>
    <article class="markdown-body"><p id="doc-ins">Insights</p></article>
    <div id="other">Insights</div>
  `;
  const table = {
    static: { Insights: "洞察" },
    dynamic: { "{v0} items": "{v0} 個項目" },
    scoped: {
      "[invalid==selector": { static: { Insights: "壞規則" } },
      "nav[aria-label='Repository']": { static: { Insights: "洞察分析" } },
      ".markdown-body": {
        static: { Insights: "見解" },
        dynamic: { "{v0} items": "{v0} 條見解" },
      },
    },
  };
  expect(
    matchSiteTranslation(
      "Insights",
      table,
      win.document.querySelector("#nav-ins")
    )
  ).toEqual({
    kind: "static",
    html: "洞察分析",
    scope: "nav[aria-label='Repository']",
  });
  expect(
    matchSiteTranslation(
      "3 items",
      table,
      win.document.querySelector("#doc-ins")
    )
  ).toEqual({
    kind: "dynamic",
    html: "3 條見解",
    scope: ".markdown-body",
  });
  expect(
    matchSiteTranslation(
      "Insights",
      table,
      win.document.querySelector("#other")
    )
  ).toEqual({
    kind: "static",
    html: "洞察",
  });
});

test("suggestScopeSelector picks stable ancestor id/data-testid/aria-label without hashed classes", () => {
  const { Window } = require("happy-dom");
  const win = new Window();
  win.document.body.innerHTML = `<section aria-label="Insights Nav"><div class="Box_1a2b3c"><span id="t">Pulse</span></div></section>`;
  expect(suggestScopeSelector(win.document.querySelector("#t"))).toBe(
    'section[aria-label="Insights Nav"]'
  );

  win.document.body.innerHTML = `
    <div id="repo-nav" data-testid="nav-root"><span id="a">A</span></div>
    <div data-testid="card-header"><span id="b">B</span></div>
    <div class="Box_99aabb Layout-sidebar"><span id="c">C</span></div>
    <span id="d">D</span>
  `;
  expect(suggestScopeSelector(win.document.querySelector("#a"))).toBe(
    "#repo-nav"
  );
  expect(suggestScopeSelector(win.document.querySelector("#b"))).toBe(
    '[data-testid="card-header"]'
  );
  expect(suggestScopeSelector(win.document.querySelector("#c"))).toBe(
    ".Layout-sidebar"
  );
  expect(suggestScopeSelector(win.document.querySelector("#d"))).toBe("");
  expect(suggestScopeSelector(null)).toBe("");
});

test("matchSiteTranslation falls through to later matching scopes or global when the matched scope lacks the phrase", () => {
  const { Window } = require("happy-dom");
  const win = new Window();
  win.document.body.innerHTML = `<section id="shell"><div id="box"><span id="leaf">Pulse</span></div></section>`;
  const leaf = win.document.querySelector("#leaf");

  const scopedHit = {
    static: { Pulse: "全域脈動" },
    dynamic: {},
    scoped: {
      "#shell": { static: { Something: "外層只有 Something" }, dynamic: {} },
      "#box": { static: { Pulse: "盒子脈動" }, dynamic: {} },
    },
  };
  expect(matchSiteTranslation("Pulse", scopedHit, leaf)).toEqual({
    kind: "static",
    html: "盒子脈動",
    scope: "#box",
  });

  const globalFallback = {
    static: { Pulse: "全域脈動" },
    dynamic: {},
    scoped: {
      "#shell": { static: { Something: "外層只有 Something" }, dynamic: {} },
      "#box": { static: { Other: "別件" }, dynamic: {} },
    },
  };
  expect(matchSiteTranslation("Pulse", globalFallback, leaf)).toEqual({
    kind: "static",
    html: "全域脈動",
  });

  const globalDynamic = {
    static: {},
    dynamic: { "{v0} items": "{v0} 個項目" },
    scoped: { "#shell": { static: {}, dynamic: {} } },
  };
  expect(matchSiteTranslation("3 items", globalDynamic, leaf)).toEqual({
    kind: "dynamic",
    html: "3 個項目",
  });
});

test("matchSiteTranslation skips scoped entries when container is omitted or null and resolves global entries", () => {
  const { Window } = require("happy-dom");
  const win = new Window();
  win.document.body.innerHTML = `<nav><a id="pulse">Pulse</a></nav>`;
  const navEl = win.document.querySelector("#pulse");

  const table = {
    static: { Pulse: "全域脈動" },
    dynamic: {},
    scoped: { nav: { static: { Pulse: "導航脈動" }, dynamic: {} } },
  };
  expect(matchSiteTranslation("Pulse", table)).toEqual({
    kind: "static",
    html: "全域脈動",
  });
  expect(matchSiteTranslation("Pulse", table, undefined)).toEqual({
    kind: "static",
    html: "全域脈動",
  });
  expect(matchSiteTranslation("Pulse", table, null)).toEqual({
    kind: "static",
    html: "全域脈動",
  });
  expect(matchSiteTranslation("Pulse", table, navEl)).toEqual({
    kind: "static",
    html: "導航脈動",
    scope: "nav",
  });
});

test("suggestScopeSelector stops at depth < 5 and escapes quotes/backslashes in data-testid/aria-label", () => {
  const { Window } = require("happy-dom");
  const win = new Window();
  const doc = win.document;

  // 6+ ancestors: the walk stops at depth < 5, so the outermost (6th) ancestor is never reached.
  let node = doc.createElement("span");
  node.id = "deep";
  for (let i = 0; i < 6; i += 1) {
    const wrapper = doc.createElement("div");
    if (i === 5) {
      wrapper.id = "sixth";
    }
    wrapper.appendChild(node);
    node = wrapper;
  }
  doc.body.appendChild(node);
  expect(suggestScopeSelector(doc.querySelector("#deep"))).toBe("");

  // Boundary: the 5th ancestor (depth 4) is still reached and its id is suggested.
  node = doc.createElement("span");
  node.id = "deep5";
  for (let i = 0; i < 5; i += 1) {
    const wrapper = doc.createElement("div");
    if (i === 4) {
      wrapper.id = "fifth";
    }
    wrapper.appendChild(node);
    node = wrapper;
  }
  doc.body.appendChild(node);
  expect(suggestScopeSelector(doc.querySelector("#deep5"))).toBe("#fifth");

  // Escaped quotes/backslashes in data-testid and aria-label.
  const testIdWrap = doc.createElement("div");
  testIdWrap.setAttribute("data-testid", 'quo"te\\back');
  const testIdEl = doc.createElement("span");
  testIdWrap.appendChild(testIdEl);
  doc.body.appendChild(testIdWrap);
  expect(suggestScopeSelector(testIdEl)).toBe(
    '[data-testid="quo\\"te\\\\back"]'
  );

  const ariaWrap = doc.createElement("div");
  ariaWrap.setAttribute("aria-label", 'a"b\\c');
  const ariaEl = doc.createElement("span");
  ariaWrap.appendChild(ariaEl);
  doc.body.appendChild(ariaWrap);
  expect(suggestScopeSelector(ariaEl)).toBe('div[aria-label="a\\"b\\\\c"]');
});

test("github.com.json has no routes and resolves Insights scoped entries", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const raw = readFileSync(
    join(import.meta.dir, "../translations/github.com.json"),
    "utf8"
  );
  const parsed = JSON.parse(raw);
  expect(parsed.routes).toBeUndefined();
  const table = parsed.locales["zh-Hant-TW"];
  const { Window } = require("happy-dom");
  const win = new Window();
  win.document.body.innerHTML = `
    <nav aria-label="Insights"><a id="pulse">Pulse</a></nav>
    <div class="Subhead"><h2 id="heading">Code frequency</h2></div>
    <div id="outside">Pulse</div>
  `;
  expect(
    matchSiteTranslation("Pulse", table, win.document.querySelector("#pulse"))
  ).toEqual({
    kind: "static",
    html: "脈動",
    scope: "nav[aria-label='Insights'], .Subhead",
  });
  expect(
    matchSiteTranslation(
      "Code frequency",
      table,
      win.document.querySelector("#heading")
    )
  ).toEqual({
    kind: "static",
    html: "程式碼頻率",
    scope: "nav[aria-label='Insights'], .Subhead",
  });
  expect(
    matchSiteTranslation("Pulse", table, win.document.querySelector("#outside"))
  ).toBeNull();
});

test("loadSiteTranslations caches under ptr:site-tr-remote:<host> and background refresh does not overwrite ptr:site-tr-local:<host>", async () => {
  const store: Record<string, unknown> = {
    "ptr:site-tr-remote:example.com": {
      version: 1,
      host: "example.com",
      locales: {
        "zh-TW": {
          static: { Issues: "舊議題" },
        },
      },
    },
    "ptr:site-tr:__index": ["example.com"],
  };
  configureGmApi({
    GM_getValue: (k: string, d?: unknown) => (k in store ? store[k] : d),
    GM_setValue: (k: string, v: unknown) => {
      store[k] = v;
    },
    GM_xmlhttpRequest(details: Record<string, unknown>) {
      (details.onload as (r: unknown) => void)({
        status: 200,
        responseText: JSON.stringify({
          version: 1,
          host: "example.com",
          locales: {
            "zh-TW": {
              static: { Issues: "新議題", Pulls: "合併請求" },
            },
          },
        }),
      });
    },
  });

  saveLocalSiteTranslations({
    version: 1,
    host: "example.com",
    locales: {
      "zh-TW": {
        static: { Issues: "自訂議題", Custom: "自訂" },
      },
    },
  });

  let changed: unknown = null;
  const initial = await loadSiteTranslations(
    "https://example.com/translations",
    "example.com",
    (next) => {
      changed = next;
    }
  );
  expect(initial?.locales["zh-TW"]?.static?.Issues).toBe("舊議題");

  await new Promise((r) => setTimeout(r, 10));

  expect(changed).not.toBeNull();
  const storedRemote = store["ptr:site-tr-remote:example.com"] as {
    locales: Record<string, { static?: Record<string, string> }>;
  };
  const storedLocal = store["ptr:site-tr-local:example.com"] as {
    locales: Record<string, { static?: Record<string, string> }>;
  };
  expect(storedRemote.locales["zh-TW"].static?.Issues).toBe("新議題");
  expect(storedRemote.locales["zh-TW"].static?.Pulls).toBe("合併請求");
  expect(storedLocal.locales["zh-TW"].static).toEqual({
    Issues: "自訂議題",
    Custom: "自訂",
  });

  const layered = listLayeredSiteTranslations();
  expect(layered).toHaveLength(1);
  expect(layered[0]?.hasLocal).toBe(true);
  expect(layered[0]?.hasRemote).toBe(true);
  expect(layered[0]?.file.locales["zh-TW"]?.static).toEqual({
    Issues: "自訂議題",
    Pulls: "合併請求",
    Custom: "自訂",
  });
});

test("mergeSiteTranslations and mergeLocalSiteLocaleTable layer local over remote per key while preserving untouched remote keys", () => {
  const store: Record<string, unknown> = {};
  configureGmApi({
    GM_getValue: (k: string, d?: unknown) => (k in store ? store[k] : d),
    GM_setValue: (k: string, v: unknown) => {
      store[k] = v;
    },
  });

  const mergedTable = mergeLocaleTables(
    {
      static: { A: "rA", B: "rB" },
      dynamic: { "{v0} d1": "rD1", "{v0} d2": "rD2" },
      scoped: {
        ".nav": {
          static: { Home: "rHome", Docs: "rDocs" },
          dynamic: { "{v0} tabs": "rTabs" },
        },
        ".footer": { static: { Help: "rHelp" } },
      },
    },
    {
      static: { B: "lB", C: "lC" },
      dynamic: { "{v0} d2": "lD2" },
      scoped: {
        ".nav": { static: { Home: "lHome" } },
      },
    }
  );
  expect(mergedTable).toEqual({
    static: { A: "rA", B: "lB", C: "lC" },
    dynamic: { "{v0} d1": "rD1", "{v0} d2": "lD2" },
    scoped: {
      ".nav": {
        static: { Home: "lHome", Docs: "rDocs" },
        dynamic: { "{v0} tabs": "rTabs" },
      },
      ".footer": { static: { Help: "rHelp" } },
    },
  });

  const mergedFile = mergeSiteTranslations(
    {
      version: 1,
      host: "docs.example",
      locales: {
        "zh-TW": { static: { RemoteOnly: "僅遠端", Shared: "遠端" } },
      },
    },
    {
      version: 1,
      host: "docs.example",
      locales: {
        "zh-TW": { static: { Shared: "本地", LocalOnly: "僅本地" } },
      },
    }
  );
  expect(mergedFile?.locales["zh-TW"]?.static).toEqual({
    RemoteOnly: "僅遠端",
    Shared: "本地",
    LocalOnly: "僅本地",
  });

  mergeLocalSiteLocaleTable("docs.example", "zh-TW", {
    static: { Save: "儲存" },
    scoped: { "#nav": { static: { Home: "首頁" } } },
  });
  mergeLocalSiteLocaleTable("docs.example", "zh-TW", {
    dynamic: { "{v0} stars": "{v0} 星" },
    scoped: { "#nav": { static: { About: "關於" } } },
  });
  const local = loadLocalSiteTranslations("docs.example");
  expect(local?.locales["zh-TW"]).toEqual({
    static: { Save: "儲存" },
    dynamic: { "{v0} stars": "{v0} 星" },
    scoped: { "#nav": { static: { Home: "首頁", About: "關於" } } },
  });

  saveCachedSiteTranslations({
    version: 1,
    host: "imported.example",
    locales: { "zh-TW": { static: { Import: "匯入" } } },
  });
  expect(store["ptr:site-tr-local:imported.example"]).toBeDefined();
  expect(loadLocalSiteTranslations("imported.example")?.host).toBe(
    "imported.example"
  );
});

test("deleteLayeredSiteTranslations clears local first keeping remote, then clears remote on second call", () => {
  const store: Record<string, unknown> = {
    "ptr:site-tr-remote:del.example": {
      version: 1,
      host: "del.example",
      locales: { "zh-TW": { static: { Issues: "議題" } } },
    },
    "ptr:site-tr:__index": ["del.example"],
  };
  configureGmApi({
    GM_getValue: (k: string, d?: unknown) => (k in store ? store[k] : d),
    GM_setValue: (k: string, v: unknown) => {
      store[k] = v;
    },
  });

  saveLocalSiteTranslations({
    version: 1,
    host: "del.example",
    locales: { "zh-TW": { static: { Issues: "自訂議題" } } },
  });

  expect(deleteLayeredSiteTranslations("del.example")).toBe("cleared-local");
  expect(loadLocalSiteTranslations("del.example")).toBeNull();
  expect(store["ptr:site-tr-remote:del.example"]).not.toBeNull();
  expect(listLayeredSiteTranslations()).toHaveLength(1);
  expect(listLayeredSiteTranslations()[0]?.hasLocal).toBe(false);
  expect(listLayeredSiteTranslations()[0]?.hasRemote).toBe(true);

  expect(deleteLayeredSiteTranslations("del.example")).toBe("cleared-all");
  expect(store["ptr:site-tr-remote:del.example"]).toBeNull();
  expect(listLayeredSiteTranslations()).toEqual([]);
  expect(deleteLayeredSiteTranslations("del.example")).toBe("noop");

  // deleteCachedSiteTranslations delegates to deleteLayeredSiteTranslations
  store["ptr:site-tr-remote:del2.example"] = {
    version: 1,
    host: "del2.example",
    locales: { "zh-TW": { static: { A: "甲" } } },
  };
  store["ptr:site-tr:__index"] = ["del2.example"];
  saveLocalSiteTranslations({
    version: 1,
    host: "del2.example",
    locales: { "zh-TW": { static: { A: "乙" } } },
  });
  deleteCachedSiteTranslations("del2.example");
  expect(loadLocalSiteTranslations("del2.example")).toBeNull();
  expect(listCachedSiteTranslations()).toHaveLength(1);
  deleteCachedSiteTranslations("del2.example");
  expect(listCachedSiteTranslations()).toEqual([]);
});

test("legacy ptr:site-tr:<host> fallback is readable when split keys are absent", async () => {
  const store: Record<string, unknown> = {
    "ptr:site-tr:legacy.example": {
      version: 1,
      host: "legacy.example",
      locales: { "zh-TW": { static: { Legacy: "舊鍵" } } },
    },
    "ptr:site-tr:__index": ["legacy.example"],
  };
  configureGmApi({
    GM_getValue: (k: string, d?: unknown) => (k in store ? store[k] : d),
    GM_setValue: (k: string, v: unknown) => {
      store[k] = v;
    },
    GM_xmlhttpRequest(details: Record<string, unknown>) {
      (details.onload as (r: unknown) => void)({
        status: 404,
        responseText: "Not Found",
      });
    },
  });

  expect(listCachedSiteTranslations()[0]?.locales["zh-TW"]?.static).toEqual({
    Legacy: "舊鍵",
  });

  const loaded = await loadSiteTranslations(
    "https://example.com/translations",
    "legacy.example"
  );
  expect(loaded?.locales["zh-TW"]?.static?.Legacy).toBe("舊鍵");
  expect(store["ptr:site-tr-remote:legacy.example"]).toBeDefined();
});
