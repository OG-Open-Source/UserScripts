import { expect, test } from "bun:test";
import { runSegmentPipeline } from "../../src/core/pipeline";

const ZH_CONFIG = {
  debugSpacingMarks: false,
  openccMode: "off",
  punctNorm: "zh-norm",
  spacingMode: "both",
  targetLang: "zh-TW",
} as const;

function createMemoryStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  return {
    data,
    storage: {
      get<T>(key: string, defaultValue: T): T {
        return key in data ? (data[key] as T) : defaultValue;
      },
      set(key: string, value: unknown): void {
        data[key] = value;
      },
    },
  };
}

function siteFile(host: string, translated: string) {
  return {
    version: 1,
    host,
    locales: {
      "zh-TW": {
        static: { Hello: translated, Issues: "議題", Pulls: "提取要求" },
      },
    },
  };
}

function loadUpstreamModule() {
  return import("../../src/dict/upstream").catch(() => null);
}

function loadStoreModule() {
  return import("../../src/dict/store").catch(() => null);
}

function loadTemplateModule() {
  return import("../../src/dict/template").catch(() => null);
}

test("ported template matcher extracts and interpolates dynamic entries", async () => {
  const module = await loadTemplateModule();
  expect(module).not.toBeNull();
  if (!module) {
    return;
  }

  expect(module.extractTemplate("Showing 1,234 results for @octocat")).toEqual({
    kind: "dynamic",
    template: "Showing {v0} results for {v1}",
    values: ["1,234", "@octocat"],
  });
  expect(
    module.matchSiteTranslation("Showing 42 results for @octocat", {
      dynamic: {
        "Showing {v0} results for {v1}": "顯示 {v1} 的 {v0} 筆結果",
      },
    })
  ).toEqual({
    kind: "dynamic",
    html: "顯示 @octocat 的 42 筆結果",
  });
  expect(module.interpolateTemplate("{v0} / {v1}", ["甲"])).toBe("甲 / {v1}");
});

test("local dictionary hit returns before any upstream request", async () => {
  const module = await loadUpstreamModule();
  expect(module).not.toBeNull();
  if (!module) {
    return;
  }
  const { data, storage } = createMemoryStorage();
  data["ptr:site-tr-local:example.com"] = siteFile("example.com", "本機翻譯");
  let fetches = 0;
  const client = module.createUpstreamClient({
    storage,
    fetchText: () => {
      fetches += 1;
      return Promise.reject(new Error("must not fetch"));
    },
  });

  const result = await module.resolveSegmentDictionary(
    " EXAMPLE.COM ",
    "Hello",
    "zh-TW",
    { client, storage }
  );

  expect(result).toEqual({
    hit: true,
    html: "本機翻譯",
    source: "local",
  });
  expect(fetches).toBe(0);
});

test("two concurrent local misses share one fetch and success is cached for the TTL", async () => {
  const module = await loadUpstreamModule();
  expect(module).not.toBeNull();
  if (!module) {
    return;
  }
  const { storage } = createMemoryStorage();
  let now = 1000;
  let fetches = 0;
  let releaseFetch: ((body: string) => void) | undefined;
  const client = module.createUpstreamClient({
    now: () => now,
    storage,
    ttlMs: 1000,
    fetchText: () => {
      fetches += 1;
      return new Promise<string>((resolve) => {
        releaseFetch = resolve;
      });
    },
  });

  const first = module.resolveSegmentDictionary(
    "Example.com",
    "Issues",
    "zh-TW",
    { client, storage }
  );
  const second = module.resolveSegmentDictionary(
    "example.com",
    "Pulls",
    "zh-TW",
    { client, storage }
  );
  expect(fetches).toBe(1);
  releaseFetch?.(JSON.stringify(siteFile("example.com", "你好")));
  expect(await Promise.all([first, second])).toEqual([
    { hit: true, html: "議題", source: "upstream" },
    { hit: true, html: "提取要求", source: "upstream" },
  ]);

  now += 999;
  expect(await client.ensureHost("example.com")).toEqual(
    siteFile("example.com", "你好")
  );
  expect(fetches).toBe(1);
});

test("cold ensureHost calls share the exact in-flight promise", async () => {
  const module = await loadUpstreamModule();
  expect(module).not.toBeNull();
  if (!module) {
    return;
  }
  let releaseFetch: ((body: string) => void) | undefined;
  let fetches = 0;
  const client = module.createUpstreamClient({
    storage: createMemoryStorage().storage,
    fetchText: () => {
      fetches += 1;
      return new Promise<string>((resolve) => {
        releaseFetch = resolve;
      });
    },
  });

  const first = client.ensureHost(" EXAMPLE.COM ");
  const second = client.ensureHost("example.com");
  expect(second).toBe(first);
  releaseFetch?.(JSON.stringify(siteFile("example.com", "你好")));
  expect((await first)?.host).toBe("example.com");
  expect(fetches).toBe(1);
  expect(await client.ensureHost("   ")).toBeNull();
  expect(fetches).toBe(1);
});

test("offline misses allow provider fallback and negative-cache retries are throttled", async () => {
  const module = await loadUpstreamModule();
  expect(module).not.toBeNull();
  if (!module) {
    return;
  }
  const { storage } = createMemoryStorage();
  let now = 0;
  let fetches = 0;
  let providerCalls = 0;
  const client = module.createUpstreamClient({
    now: () => now,
    negativeTtlMs: 60_000,
    storage,
    fetchText: () => {
      fetches += 1;
      return Promise.reject(new Error("offline"));
    },
  });
  const hooks = {
    dict: (html: string, targetLang: string) =>
      module.resolveSegmentDictionary("offline.example", html, targetLang, {
        client,
        storage,
      }),
    provider: () => {
      providerCalls += 1;
      return "離線備援";
    },
  };

  const first = await runSegmentPipeline("Hello", ZH_CONFIG, hooks);
  expect(first.html).toBe("離線備援");
  expect(providerCalls).toBe(1);
  expect(fetches).toBe(1);

  await runSegmentPipeline("Hello", ZH_CONFIG, hooks);
  expect(providerCalls).toBe(2);
  expect(fetches).toBe(1);

  now = 60_001;
  await runSegmentPipeline("Hello", ZH_CONFIG, hooks);
  expect(providerCalls).toBe(3);
  expect(fetches).toBe(2);
});

test("a hung fetch times out to null and uses the brief negative cache", async () => {
  const module = await loadUpstreamModule();
  expect(module).not.toBeNull();
  if (!module) {
    return;
  }
  let fetches = 0;
  const client = module.createUpstreamClient({
    storage: createMemoryStorage().storage,
    timeoutMs: 10,
    negativeTtlMs: 60_000,
    fetchText: () => {
      fetches += 1;
      return new Promise<string>(() => {
        // Intentionally pending to exercise the client-side timeout.
      });
    },
  });
  let guard: ReturnType<typeof setTimeout> | undefined;
  const hungGuard = new Promise<"hung">((resolve) => {
    guard = setTimeout(() => resolve("hung"), 250);
  });

  const result = await Promise.race([
    client.ensureHost("slow.example"),
    hungGuard,
  ]);
  if (guard) {
    clearTimeout(guard);
  }
  expect(result).toBeNull();
  expect(await client.ensureHost("slow.example")).toBeNull();
  expect(fetches).toBe(1);
});

test("invalid upstream JSON resolves null instead of rejecting", async () => {
  const module = await loadUpstreamModule();
  expect(module).not.toBeNull();
  if (!module) {
    return;
  }
  const client = module.createUpstreamClient({
    storage: createMemoryStorage().storage,
    fetchText: () => Promise.resolve("not valid JSON"),
  });

  await expect(client.ensureHost("invalid.example")).resolves.toBeNull();
});

test("upstream rejects a response whose normalized host differs from the request", async () => {
  const module = await loadUpstreamModule();
  expect(module).not.toBeNull();
  if (!module) {
    return;
  }
  const { data, storage } = createMemoryStorage();
  const client = module.createUpstreamClient({
    storage,
    fetchText: () =>
      Promise.resolve(JSON.stringify(siteFile("other.example", "其他主機"))),
  });

  expect(await client.ensureHost("requested.example")).toBeNull();
  expect(data["ptr:site-tr-remote:other.example"]).toBeUndefined();
  expect(data["ptr:site-tr-remote:requested.example"]).toBeUndefined();
});

test("remote writes preserve the local layer verbatim", async () => {
  const module = await loadUpstreamModule();
  expect(module).not.toBeNull();
  if (!module) {
    return;
  }
  const local = siteFile("example.com", "自訂翻譯");
  const { data, storage } = createMemoryStorage({
    "ptr:site-tr-local:example.com": local,
  });
  const client = module.createUpstreamClient({
    baseUrl: "https://dictionaries.example/base/",
    storage,
    fetchText: (url) => {
      expect(url).toBe("https://dictionaries.example/base/example.com.json");
      return Promise.resolve(
        JSON.stringify(siteFile("example.com", "遠端翻譯"))
      );
    },
  });

  expect(
    (await client.ensureHost("example.com"))?.locales["zh-TW"]?.static
  ).toEqual(siteFile("example.com", "遠端翻譯").locales["zh-TW"].static);
  expect(data["ptr:site-tr-local:example.com"]).toEqual(local);
  expect(data["ptr:site-tr-remote:example.com"]).toEqual(
    siteFile("example.com", "遠端翻譯")
  );
});

test("warm remote storage returns stale data immediately and refreshes once in background", async () => {
  const module = await loadUpstreamModule();
  expect(module).not.toBeNull();
  if (!module) {
    return;
  }
  const stale = siteFile("example.com", "舊翻譯");
  const fresh = siteFile("example.com", "新翻譯");
  const local = siteFile("example.com", "本機翻譯");
  const { data, storage } = createMemoryStorage({
    "ptr:site-tr-remote:example.com": stale,
    "ptr:site-tr-local:example.com": local,
  });
  let fetches = 0;
  let releaseFetch: ((body: string) => void) | undefined;
  let notifyUpdate: (() => void) | undefined;
  const updated = new Promise<void>((resolve) => {
    notifyUpdate = resolve;
  });
  const updates: unknown[] = [];
  const client = module.createUpstreamClient({
    storage,
    onUpdate: (next) => {
      updates.push(next);
      notifyUpdate?.();
    },
    fetchText: () => {
      fetches += 1;
      return new Promise<string>((resolve) => {
        releaseFetch = resolve;
      });
    },
  });

  expect(await client.ensureHost("example.com")).toEqual(stale);
  expect(await client.ensureHost("example.com")).toEqual(stale);
  expect(fetches).toBe(1);
  releaseFetch?.(JSON.stringify(fresh));
  await updated;

  expect(updates).toEqual([fresh]);
  expect(data["ptr:site-tr-remote:example.com"]).toEqual(fresh);
  expect(data["ptr:site-tr-local:example.com"]).toEqual(local);
  expect(await client.ensureHost("example.com")).toEqual(fresh);
  expect(fetches).toBe(1);
});

test("background onUpdate failures reach onUpdateError", async () => {
  const module = await loadUpstreamModule();
  expect(module).not.toBeNull();
  if (!module) {
    return;
  }
  const stale = siteFile("example.com", "舊翻譯");
  const updateError = new Error("update failed");
  let notifyError: (() => void) | undefined;
  const reported = new Promise<unknown>((resolve) => {
    notifyError = () => resolve(updateError);
  });
  const errors: unknown[] = [];
  const client = module.createUpstreamClient({
    storage: createMemoryStorage({
      "ptr:site-tr-remote:example.com": stale,
    }).storage,
    fetchText: () =>
      Promise.resolve(JSON.stringify(siteFile("example.com", "新翻譯"))),
    onUpdate: () => {
      throw updateError;
    },
    onUpdateError: (error) => {
      errors.push(error);
      notifyError?.();
    },
  });

  expect(await client.ensureHost("example.com")).toEqual(stale);
  expect(await reported).toBe(updateError);
  expect(errors).toEqual([updateError]);
});

test("layered store merges local over remote and reads the legacy fallback", async () => {
  const module = await loadStoreModule();
  expect(module).not.toBeNull();
  if (!module) {
    return;
  }
  const { data, storage } = createMemoryStorage();
  module.saveRemoteSiteTranslations(siteFile("example.com", "遠端"), storage);
  module.saveLocalSiteTranslations(
    {
      version: 2,
      host: "example.com",
      locales: { "zh-TW": { static: { Hello: "本機" } } },
    },
    storage
  );

  expect(module.loadRemoteSiteTranslations("EXAMPLE.COM", storage)).toEqual(
    siteFile("example.com", "遠端")
  );
  expect(module.listLayeredSiteTranslations(storage)).toEqual([
    {
      file: {
        version: 2,
        host: "example.com",
        locales: {
          "zh-TW": {
            static: {
              Hello: "本機",
              Issues: "議題",
              Pulls: "提取要求",
            },
          },
        },
      },
      hasLocal: true,
      hasRemote: true,
    },
  ]);
  expect(
    module.pickLocaleTable(
      module.loadLocalSiteTranslations("example.com", storage),
      "zh-TW"
    )?.static
  ).toEqual({ Hello: "本機" });

  data["ptr:site-tr:legacy.example"] = siteFile("legacy.example", "舊鍵");
  data["ptr:site-tr:__index"] = ["example.com", "legacy.example"];
  expect(module.loadRemoteSiteTranslations("legacy.example", storage)).toEqual(
    siteFile("legacy.example", "舊鍵")
  );
  expect(module.listCachedSiteTranslations(storage)).toHaveLength(2);
  expect(module.deleteLayeredSiteTranslations("example.com", storage)).toBe(
    "cleared-local"
  );
  expect(
    module.deleteCachedSiteTranslations("example.com", storage)
  ).toBeUndefined();
  expect(module.listCachedSiteTranslations(storage)).toHaveLength(1);
});

test("layered listing merges local overrides with legacy remote entries", async () => {
  const module = await loadStoreModule();
  expect(module).not.toBeNull();
  if (!module) {
    return;
  }
  const host = "legacy-merge.example";
  const { storage } = createMemoryStorage({
    "ptr:site-tr-local:legacy-merge.example": {
      version: 2,
      host,
      locales: { "zh-TW": { static: { Hello: "本機覆寫" } } },
    },
    "ptr:site-tr:legacy-merge.example": {
      version: 1,
      host,
      locales: {
        "zh-TW": { static: { Hello: "舊遠端", Issues: "舊議題" } },
      },
    },
    "ptr:site-tr:__index": [host],
  });

  expect(module.listLayeredSiteTranslations(storage)).toEqual([
    {
      file: {
        version: 2,
        host,
        locales: {
          "zh-TW": {
            static: { Hello: "本機覆寫", Issues: "舊議題" },
          },
        },
      },
      hasLocal: true,
      hasRemote: true,
    },
  ]);
});
