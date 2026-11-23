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

function localFile(translated: string) {
  return {
    version: 1,
    host: "example.com",
    locales: { "zh-TW": { static: { Hello: translated } } },
  };
}

function loadHumanOnlyModule() {
  return import("../../src/providers/human-only").catch(() => null);
}

function loadInspectModule() {
  return import("../../src/providers/inspect").catch(() => null);
}

function loadTranslatePaModule() {
  return import("../../src/providers/translate-pa").catch(() => null);
}

function loadUpstreamModule() {
  return import("../../src/dict/upstream").catch(() => null);
}

test("human-only local dictionary hit renders normalized OpenCC output with zero API calls", async () => {
  const [humanModule, upstreamModule] = await Promise.all([
    loadHumanOnlyModule(),
    loadUpstreamModule(),
  ]);
  expect(humanModule).not.toBeNull();
  expect(upstreamModule).not.toBeNull();
  if (!(humanModule && upstreamModule)) {
    return;
  }
  const { storage } = createMemoryStorage({
    "ptr:site-tr-local:example.com": localFile("GLM 5.3的确…软件"),
  });
  let upstreamFetches = 0;
  let providerCalls = 0;
  let rendered = "";
  const client = upstreamModule.createUpstreamClient({
    storage,
    fetchText: () => {
      upstreamFetches += 1;
      return Promise.reject(new Error("must not fetch"));
    },
  });
  const provider = humanModule.createHumanOnlyProvider();
  const echo = provider.translateBatch;
  provider.translateBatch = (items, opts) => {
    providerCalls += 1;
    return echo(items, opts);
  };

  const result = await runSegmentPipeline(
    "Hello",
    { ...ZH_CONFIG, openccMode: "s2t" },
    {
      createOpenCC: () => ({
        convert: (html: string) => html.replace("软件", "軟體"),
      }),
      dict: (html, targetLang) =>
        upstreamModule.resolveSegmentDictionary(
          "example.com",
          html,
          targetLang,
          { client, storage }
        ),
      provider,
      render: (html) => {
        rendered = html;
      },
    }
  );

  expect(result).toEqual({ html: "GLM 5.3 的确…軟體", route: "translate" });
  expect(rendered).toBe("GLM 5.3 的确…軟體");
  expect(upstreamFetches).toBe(0);
  expect(providerCalls).toBe(0);
});

test("human-only upstream dictionary hit renders without a provider API call", async () => {
  const [humanModule, upstreamModule] = await Promise.all([
    loadHumanOnlyModule(),
    loadUpstreamModule(),
  ]);
  expect(humanModule).not.toBeNull();
  expect(upstreamModule).not.toBeNull();
  if (!(humanModule && upstreamModule)) {
    return;
  }
  const { storage } = createMemoryStorage();
  let upstreamFetches = 0;
  let providerCalls = 0;
  const client = upstreamModule.createUpstreamClient({
    storage,
    fetchText: () => {
      upstreamFetches += 1;
      return Promise.resolve(JSON.stringify(localFile("上游翻譯")));
    },
  });
  const provider = humanModule.createHumanOnlyProvider();
  provider.translateBatch = () => {
    providerCalls += 1;
    return Promise.resolve(["不應呼叫"]);
  };
  let rendered = "";

  const result = await runSegmentPipeline("Hello", ZH_CONFIG, {
    dict: (html, targetLang) =>
      upstreamModule.resolveSegmentDictionary("example.com", html, targetLang, {
        client,
        storage,
      }),
    provider,
    render: (html) => {
      rendered = html;
    },
  });

  expect(result.html).toBe("上游翻譯");
  expect(rendered).toBe("上游翻譯");
  expect(upstreamFetches).toBe(1);
  expect(providerCalls).toBe(0);
});

test("configured human-only dictionary miss returns the source untouched without render or API calls", async () => {
  const humanModule = await loadHumanOnlyModule();
  expect(humanModule).not.toBeNull();
  if (!humanModule) {
    return;
  }
  expect(humanModule.humanOnlyProvider.id).toBe("human-only");
  let providerCalls = 0;
  let renders = 0;
  let conversions = 0;
  const source = '<span lang="en">Hello world</span>';

  const result = await runSegmentPipeline(
    source,
    { ...ZH_CONFIG, openccMode: "s2t", provider: "human-only" },
    {
      createOpenCC: () => {
        conversions += 1;
        return { convert: (html: string) => html };
      },
      dict: () => ({ hit: false }),
      provider: () => {
        providerCalls += 1;
        return "不應翻譯";
      },
      render: () => {
        renders += 1;
      },
    }
  );

  expect(result).toEqual({ html: source, route: "translate" });
  expect(providerCalls).toBe(0);
  expect(renders).toBe(0);
  expect(conversions).toBe(0);
});

test("human-only provider object also preserves a dictionary miss", async () => {
  const humanModule = await loadHumanOnlyModule();
  expect(humanModule).not.toBeNull();
  if (!humanModule) {
    return;
  }
  let providerCalls = 0;
  let renders = 0;
  const provider = humanModule.createHumanOnlyProvider();
  provider.translateBatch = () => {
    providerCalls += 1;
    return Promise.resolve([]);
  };

  const result = await runSegmentPipeline("Hello world", ZH_CONFIG, {
    dict: () => null,
    provider,
    render: () => {
      renders += 1;
    },
  });

  expect(result).toEqual({ html: "Hello world", route: "translate" });
  expect(providerCalls).toBe(0);
  expect(renders).toBe(0);
});

test("a structured dictionary hit skips a non-human provider", async () => {
  let providerCalls = 0;
  let rendered = "";
  const result = await runSegmentPipeline(
    "這是中文段落",
    { ...ZH_CONFIG, targetLang: "en-US" },
    {
      dict: () => ({ hit: true, html: "Dictionary result" }),
      provider: () => {
        providerCalls += 1;
        return "Provider result";
      },
      render: (html) => {
        rendered = html;
      },
    }
  );

  expect(result).toEqual({ html: "Dictionary result", route: "translate" });
  expect(rendered).toBe("Dictionary result");
  expect(providerCalls).toBe(0);
});

test("a regular provider object handles a dictionary miss through translateBatch", async () => {
  const calls: Array<{ items: string[]; targetLang: string }> = [];
  const result = await runSegmentPipeline("Hello", ZH_CONFIG, {
    dict: () => undefined,
    provider: {
      id: "translate-pa",
      translateBatch: (items, opts) => {
        calls.push({ items, targetLang: opts.targetLang });
        return Promise.resolve(["服務提供器翻譯"]);
      },
    },
  });

  expect(result.html).toBe("服務提供器翻譯");
  expect(calls).toEqual([{ items: ["Hello"], targetLang: "zh-TW" }]);
});

test("human-only and inspect providers echo their inputs directly", async () => {
  const [humanModule, inspectModule] = await Promise.all([
    loadHumanOnlyModule(),
    loadInspectModule(),
  ]);
  expect(humanModule).not.toBeNull();
  expect(inspectModule).not.toBeNull();
  if (!(humanModule && inspectModule)) {
    return;
  }
  const input = ["Hello", "<strong>World</strong>"];

  await expect(
    humanModule.humanOnlyProvider.translateBatch(input, {
      targetLang: "zh-TW",
    })
  ).resolves.toEqual(input);
  const inspect = inspectModule.createInspectProvider();
  expect(inspect.id).toBe("inspect");
  await expect(
    inspect.translateBatch(input, { targetLang: "zh-TW" })
  ).resolves.toEqual(input);
});

test("translate-pa uses its injected request and parses grouped response HTML", async () => {
  const module = await loadTranslatePaModule();
  expect(module).not.toBeNull();
  if (!module) {
    return;
  }
  const requests: Record<string, unknown>[] = [];
  const provider = module.createTranslatePaProvider({
    apiKey: "TEST_KEY",
    request: (options) => {
      requests.push(options);
      return Promise.resolve({
        responseText: JSON.stringify([
          [
            '<div data-ptr-g="0"><p data-ptr-s="a">儲存</p><p data-ptr-s="b">取消</p></div>',
          ],
          "en",
        ]),
      });
    },
  });

  const grouped = await provider.translateGrouped?.(
    [
      [
        { id: "a", html: "Save" },
        { id: "b", html: "Cancel" },
      ],
    ],
    { targetLang: "zh-TW" }
  );
  expect(provider.id).toBe("translate-pa");
  expect(requests).toHaveLength(1);
  expect(requests[0]?.headers).toEqual({
    "Content-Type": "application/json+protobuf",
    "X-Goog-Api-Key": "TEST_KEY",
  });
  expect(grouped?.get("a")).toBe("儲存");
  expect(grouped?.get("b")).toBe("取消");
  expect(
    module
      .parseGroupedResponseHtml(['<p data-ptr-s="single">單獨</p>'])
      .get("single")
  ).toBe("單獨");
});

test("translate-pa respects an already-aborted signal without requesting", async () => {
  const module = await loadTranslatePaModule();
  expect(module).not.toBeNull();
  if (!module) {
    return;
  }
  let requests = 0;
  const provider = module.createTranslatePaProvider({
    apiKey: "TEST_KEY",
    request: () => {
      requests += 1;
      return Promise.resolve({ responseText: '[["你好"]]' });
    },
  });
  const controller = new AbortController();
  controller.abort();

  await expect(
    provider.translateBatch(["Hello"], {
      targetLang: "zh-TW",
      signal: controller.signal,
    })
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(requests).toBe(0);
});
