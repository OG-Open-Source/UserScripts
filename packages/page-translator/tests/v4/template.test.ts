import { expect, test } from "bun:test";
import { configureGmApi } from "@userscripts/shared";
import { Window } from "happy-dom";
import {
  deleteLayeredSiteTranslations,
  listLayeredSiteTranslations,
  loadLocalSiteTranslations,
  loadRemoteSiteTranslations,
  mergeLocalSiteLocaleTable,
  mergeSiteTranslations,
  saveLocalSiteTranslations,
  saveRemoteSiteTranslations,
} from "../../src/dict/store";
import {
  extractTemplate,
  interpolateTemplate,
  matchSiteTranslation,
  suggestScopeSelector,
} from "../../src/dict/template";
import { createUpstreamClient } from "../../src/dict/upstream";

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

test("createUpstreamClient caches per-host volunteer JSON in GM storage and handles 404 gracefully", async () => {
  const store: Record<string, unknown> = {};
  configureGmApi({
    GM_getValue: (k: string, d?: unknown) => (k in store ? store[k] : d),
    GM_setValue: (k: string, v: unknown) => {
      store[k] = v;
    },
  });

  const client = createUpstreamClient({
    baseUrl: "https://example.com/translations",
    fetchText: (url) => {
      if (url.endsWith("/github.com.json")) {
        return Promise.resolve(
          JSON.stringify({
            version: 1,
            host: "github.com",
            locales: {
              "zh-Hant-TW": {
                static: { Issues: "議題" },
                dynamic: { "{v0} stars": "{v0} 顆星" },
              },
            },
          })
        );
      }
      return Promise.reject(new Error("404"));
    },
  });

  const gh = await client.ensureHost("github.com");
  expect(gh?.locales["zh-Hant-TW"]?.static.Issues).toBe("議題");
  expect(
    loadRemoteSiteTranslations("github.com")?.locales["zh-Hant-TW"]?.static
      .Issues
  ).toBe("議題");

  const missing = await client.ensureHost("unknown.example");
  expect(missing).toBeNull();
});

test("matchSiteTranslation evaluates scoped CSS selectors before global static/dynamic and survives invalid selectors", () => {
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
      win.document.querySelector("#nav-ins") as unknown as Element
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
      win.document.querySelector("#doc-ins") as unknown as Element
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
      win.document.querySelector("#other") as unknown as Element
    )
  ).toEqual({
    kind: "static",
    html: "洞察",
  });
});

test("suggestScopeSelector picks stable ancestor id/data-testid/aria-label without hashed classes", () => {
  const win = new Window();
  win.document.body.innerHTML = `<section aria-label="Insights Nav"><div class="Box_1a2b3c"><span id="t">Pulse</span></div></section>`;
  expect(
    suggestScopeSelector(win.document.querySelector("#t") as unknown as Element)
  ).toBe('section[aria-label="Insights Nav"]');

  win.document.body.innerHTML = `
    <div id="repo-nav" data-testid="nav-root"><span id="a">A</span></div>
    <div data-testid="card-header"><span id="b">B</span></div>
    <div class="Box_99aabb Layout-sidebar"><span id="c">C</span></div>
    <span id="d">D</span>
  `;
  expect(
    suggestScopeSelector(win.document.querySelector("#a") as unknown as Element)
  ).toBe("#repo-nav");
  expect(
    suggestScopeSelector(win.document.querySelector("#b") as unknown as Element)
  ).toBe('[data-testid="card-header"]');
  expect(
    suggestScopeSelector(win.document.querySelector("#c") as unknown as Element)
  ).toBe(".Layout-sidebar");
});

test("layered site translation store merges remote + local with local override priority", () => {
  const store: Record<string, unknown> = {};
  configureGmApi({
    GM_getValue: (k: string, d?: unknown) => (k in store ? store[k] : d),
    GM_setValue: (k: string, v: unknown) => {
      store[k] = v;
    },
  });

  saveRemoteSiteTranslations({
    version: 1,
    host: "github.com",
    locales: {
      "zh-Hant-TW": {
        static: { Code: "程式碼", Issues: "議題" },
        dynamic: {},
      },
    },
  });
  saveLocalSiteTranslations({
    version: 1,
    host: "github.com",
    locales: {
      "zh-Hant-TW": {
        static: { Issues: "問題" },
        dynamic: {},
      },
    },
  });

  const merged = mergeSiteTranslations(
    loadRemoteSiteTranslations("github.com"),
    loadLocalSiteTranslations("github.com")
  );
  expect(merged?.locales["zh-Hant-TW"]?.static.Code).toBe("程式碼");
  expect(merged?.locales["zh-Hant-TW"]?.static.Issues).toBe("問題");

  mergeLocalSiteLocaleTable("github.com", "zh-Hant-TW", {
    static: { Pulls: "拉取" },
    dynamic: {},
  });
  expect(
    loadLocalSiteTranslations("github.com")?.locales["zh-Hant-TW"]?.static.Pulls
  ).toBe("拉取");
  expect(listLayeredSiteTranslations().length).toBeGreaterThanOrEqual(1);

  deleteLayeredSiteTranslations("github.com");
  expect(loadLocalSiteTranslations("github.com")).toBeNull();
});
