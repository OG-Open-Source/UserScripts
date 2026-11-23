import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { collectSegments } from "../../src/capture/segmenter";
import { createBatchRunner } from "../../src/core/runner";
import { DEFAULT_CONFIG } from "../../src/platform/config";
import { createPtrMetrics } from "../../src/platform/metrics";
import { restoreAll } from "../../src/render/renderer";
import { parseSiteDelta } from "../../src/structure/site-rules";

function getStyle(el: Element) {
  return {
    display: el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
    visibility: "visible",
  };
}

test("cancelAll() cancels in-flight translation batch so restored DOM stays untouched", async () => {
  const win = new Window();
  win.document.body.innerHTML = "<div>Hello world.</div>";
  const segs = collectSegments(
    win.document.body as unknown as Element,
    parseSiteDelta(""),
    { getStyle }
  );

  let resolveBatch!: (val: string[]) => void;
  const slowProvider = {
    id: "translate-pa" as const,
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

  runner.cancelAll();
  restoreAll(win.document.body as unknown as ParentNode);
  expect(win.document.querySelector("[data-tr-block]")).toBeNull();

  resolveBatch(["你好世界。"]);
  await job;
  expect(win.document.querySelector("[data-tr-block]")).toBeNull();
  expect(win.document.body.textContent).toBe("Hello world.");
});

test("openccMode === 'off' NEVER invokes getOpenCC even on zh-CN -> zh-TW", async () => {
  const win = new Window();
  win.document.body.innerHTML =
    "<div>这是简体中文的网页测试段落，用来验证关闭转换时不调用接口。</div>";
  const segs = collectSegments(
    win.document.body as unknown as Element,
    parseSiteDelta(""),
    { getStyle }
  );

  let openccCalls = 0;
  const runner = createBatchRunner({
    doc: win.document as unknown as Document,
    delta: parseSiteDelta(""),
    getConfig: () => ({
      ...DEFAULT_CONFIG,
      targetLang: "zh-TW",
      openccMode: "off",
    }),
    getProvider: () => ({
      id: "translate-pa",
      translateBatch: (items) => Promise.resolve(items),
    }),
    getOpenCC: () => {
      openccCalls += 1;
      return Promise.resolve({ convert: (s: string) => s });
    },
  });

  await runner.translateBatch(segs);
  expect(openccCalls).toBe(0);
  expect(win.document.querySelector("[data-tr-block]")).toBeNull();
});

test("routes zh-CN local OpenCC when enabled (0 API calls), and volunteer static/dynamic hits (0 API calls)", async () => {
  const win = new Window();
  win.document.body.innerHTML = `
    <div>这是简体中文的网页测试段落，用来验证本地转换。</div>
    <div>Pull requests</div>
    <div>5 hours ago</div>
    <div>Welcome to open source software.</div>
  `;
  const segs = collectSegments(
    win.document.body as unknown as Element,
    parseSiteDelta(""),
    { getStyle }
  );

  const sentToApi: string[] = [];
  const runner = createBatchRunner({
    doc: win.document as unknown as Document,
    delta: parseSiteDelta(""),
    getConfig: () => ({
      ...DEFAULT_CONFIG,
      targetLang: "zh-TW",
      openccMode: "s2twp",
    }),
    getProvider: () => ({
      id: "translate-pa",
      translateBatch(items: string[]) {
        sentToApi.push(...items);
        return Promise.resolve(items.map(() => "歡迎來到開源軟體。"));
      },
    }),
    getOpenCC: () =>
      Promise.resolve({
        convert: (s: string) =>
          s
            .replace("简体", "繁體")
            .replace("网页", "網頁")
            .replace("本地转换", "本地轉換"),
      }),
    getSiteLocaleTable: () => ({
      static: { "Pull requests": "拉取請求" },
      dynamic: { "{v0} hours ago": "{v0} 小時前" },
    }),
  });

  await runner.translateBatch(segs);

  expect(sentToApi.length).toBe(1);
  expect(sentToApi[0]).toContain("Welcome to open source software.");

  const divs = Array.from(win.document.querySelectorAll("body > div"));
  expect(divs[0]?.querySelector("[data-tr-dst]")?.textContent).toContain(
    "繁體"
  );
  expect(divs[1]?.querySelector("[data-tr-dst]")?.textContent).toBe("拉取請求");
  expect(divs[2]?.querySelector("[data-tr-dst]")?.textContent).toBe("5 小時前");
  expect(divs[3]?.querySelector("[data-tr-dst]")?.textContent).toBe(
    "歡迎來到開源軟體。"
  );
});

test("pageCache hits still apply opencc post-processing on zh targets", async () => {
  const win = new Window();
  win.document.body.innerHTML = `
    <div>Hello world</div>
    <div>Hello world</div>
  `;
  const segs = collectSegments(
    win.document.body as unknown as Element,
    parseSiteDelta(""),
    { getStyle }
  );

  let apiCalls = 0;
  const runner = createBatchRunner({
    doc: win.document as unknown as Document,
    delta: parseSiteDelta(""),
    getConfig: () => ({
      ...DEFAULT_CONFIG,
      targetLang: "zh-TW",
      openccMode: "s2t",
    }),
    getProvider: () => ({
      id: "translate-pa",
      translateBatch(items: string[]) {
        apiCalls += 1;
        return Promise.resolve(items.map(() => "你好软件"));
      },
    }),
    getOpenCC: () =>
      Promise.resolve({
        convert: (s: string) => s.replace("软件", "軟體"),
      }),
  });

  const [seg0, seg1] = segs;
  if (!(seg0 && seg1)) {
    throw new Error("Expected 2 segments");
  }
  await runner.translateBatch([seg0]);
  await runner.translateBatch([seg1]);

  expect(apiCalls).toBe(1);
  const divs = Array.from(win.document.querySelectorAll("body > div"));
  expect(divs[0]?.querySelector("[data-tr-dst]")?.textContent).toBe("你好軟體");
  expect(divs[1]?.querySelector("[data-tr-dst]")?.textContent).toBe("你好軟體");
});

test("runner ignores <html lang> and routes each segment purely by its own content + scoped dictionary + metrics", async () => {
  const win = new Window();
  win.document.documentElement.setAttribute("lang", "zh-TW");
  win.document.body.innerHTML = `
    <nav aria-label="Repository"><div id="n1">Insights</div></nav>
    <div id="e1">Welcome to repository insights.</div>
    <div id="z1">這是已經是繁體中文的段落，不應送出翻譯。</div>
  `;
  const segs = collectSegments(
    win.document.body as unknown as Element,
    parseSiteDelta(""),
    { getStyle }
  );

  const metrics = createPtrMetrics();
  const sent: string[] = [];
  const runner = createBatchRunner({
    doc: win.document as unknown as Document,
    delta: parseSiteDelta(""),
    getConfig: () => ({ ...DEFAULT_CONFIG, targetLang: "zh-TW" }),
    getProvider: () => ({
      id: "translate-pa",
      translateBatch(items: string[]) {
        sent.push(...items);
        return Promise.resolve(items.map(() => "歡迎來到倉庫洞察。"));
      },
    }),
    getSiteLocaleTable: () => ({
      static: { Insights: "洞察" },
      dynamic: {},
      scoped: {
        "nav[aria-label='Repository']": { static: { Insights: "洞察分析" } },
      },
    }),
    metrics,
  });

  await runner.translateBatch(segs);
  expect(sent.length).toBe(1);
  expect(win.document.querySelector("#n1 [data-tr-dst]")?.textContent).toBe(
    "洞察分析"
  );
  expect(win.document.querySelector("#z1 [data-tr-block]")).toBeNull();
  expect(metrics.segments.manual).toBe(1);
  expect(metrics.segments.scopedHits).toBe(1);
});

test("human-only provider renders dictionary hits and leaves misses untouched with 0 API calls", async () => {
  const win = new Window();
  win.document.body.innerHTML = `
    <div id="hit">Pull requests</div>
    <div id="miss">Untranslated prose</div>
  `;
  const segs = collectSegments(
    win.document.body as unknown as Element,
    parseSiteDelta(""),
    { getStyle }
  );

  let apiCalls = 0;
  const runner = createBatchRunner({
    doc: win.document as unknown as Document,
    delta: parseSiteDelta(""),
    getConfig: () => ({
      ...DEFAULT_CONFIG,
      targetLang: "zh-TW",
      provider: "human-only",
    }),
    getProvider: () => ({
      id: "human-only",
      translateBatch() {
        apiCalls += 1;
        return Promise.resolve([]);
      },
    }),
    getSiteLocaleTable: () => ({
      static: { "Pull requests": "拉取請求" },
      dynamic: {},
    }),
  });

  await runner.translateBatch(segs);
  expect(apiCalls).toBe(0);
  expect(win.document.querySelector("#hit [data-tr-dst]")?.textContent).toBe(
    "拉取請求"
  );
  expect(win.document.querySelector("#miss [data-tr-block]")).toBeNull();
  expect(win.document.querySelector("#miss")?.textContent).toBe(
    "Untranslated prose"
  );
});

test("isInspectActive gates inspect-only rendering per tab regardless of defaultInspect", async () => {
  const win1 = new Window();
  win1.document.body.innerHTML = `<div id="p1">Inspect only block</div>`;
  const segs1 = collectSegments(
    win1.document.body as unknown as Element,
    parseSiteDelta(""),
    { getStyle }
  );

  const runner1 = createBatchRunner({
    doc: win1.document as unknown as Document,
    delta: parseSiteDelta(""),
    getConfig: () => ({
      ...DEFAULT_CONFIG,
      defaultInspect: false,
      provider: "inspect",
    }),
    getProvider: () => ({
      id: "inspect",
      translateBatch: (items: string[]) => Promise.resolve(items),
    }),
    isInspectActive: () => true,
  });

  await runner1.translateBatch(segs1);
  expect(
    win1.document.querySelector("#p1")?.getAttribute("data-tr-inspect")
  ).toBe("auto");
  expect(win1.document.querySelector("#p1 [data-tr-block]")).toBeNull();

  const win2 = new Window();
  win2.document.body.innerHTML = `<div id="p2">Normal translate block</div>`;
  const segs2 = collectSegments(
    win2.document.body as unknown as Element,
    parseSiteDelta(""),
    { getStyle }
  );

  const runner2 = createBatchRunner({
    doc: win2.document as unknown as Document,
    delta: parseSiteDelta(""),
    getConfig: () => ({
      ...DEFAULT_CONFIG,
      defaultInspect: true,
      provider: "inspect",
    }),
    getProvider: () => ({
      id: "inspect",
      translateBatch: (items: string[]) => Promise.resolve(items.map((x) => x)),
    }),
    isInspectActive: () => false,
  });

  await runner2.translateBatch(segs2);
  expect(win2.document.querySelector("#p2 [data-tr-block]")).not.toBeNull();
  expect(
    win2.document.querySelector("#p2")?.getAttribute("data-tr-inspect")
  ).toBeNull();
});

test("zh-subsystem normalizes cross-element bracket and punctuation seams in rendered DOM with openccMode off", async () => {
  const win = new Window();
  win.document.body.innerHTML = `
    <div id="b1"><span>文字</span>[English]</div>
    <div id="p1"><span>中文</span>, next</div>
    <div id="s1"><span>中文</span>, and <span data-tr-no-space>keep</span>, next</div>
  `;
  const segs = collectSegments(
    win.document.body as unknown as Element,
    parseSiteDelta(""),
    { getStyle }
  );

  const runner = createBatchRunner({
    doc: win.document as unknown as Document,
    delta: parseSiteDelta(""),
    getConfig: () => ({
      ...DEFAULT_CONFIG,
      targetLang: "zh-TW",
      openccMode: "off",
      punctNorm: "zh-norm",
      spacingMode: "off",
    }),
    getProvider: () => ({
      id: "translate-pa",
      translateBatch: () => Promise.resolve([]),
    }),
  });

  await runner.translateBatch(segs);
  expect(win.document.querySelector("#b1 [data-tr-dst]")?.textContent).toBe(
    "文字【English】"
  );
  expect(win.document.querySelector("#p1 [data-tr-dst]")?.textContent).toBe(
    "中文，next"
  );
  expect(win.document.querySelector("#s1 [data-tr-dst]")?.textContent).toBe(
    "中文，and keep, next"
  );
});

test("beforeApiDispatch pauses API batch dispatch until resolved", async () => {
  const win = new Window();
  win.document.body.innerHTML = `<div id="p1">Hello breakpoint world</div>`;
  const segs = collectSegments(
    win.document.body as unknown as Element,
    parseSiteDelta(""),
    { getStyle }
  );

  let releaseGate: (() => void) | null = null;
  let providerCalls = 0;
  const gatePromise = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  const runner = createBatchRunner({
    doc: win.document as unknown as Document,
    delta: parseSiteDelta(""),
    getConfig: () => DEFAULT_CONFIG,
    getProvider: () => ({
      id: "translate-pa",
      translateBatch: (items: string[]) => {
        providerCalls += 1;
        return Promise.resolve(items.map((x) => `ZH:${x}`));
      },
    }),
    beforeApiDispatch: () => gatePromise,
  });

  const pending = runner.translateBatch(segs);
  await Promise.resolve();
  await Promise.resolve();
  expect(providerCalls).toBe(0);

  releaseGate?.();
  await pending;
  expect(providerCalls).toBe(1);
  expect(win.document.querySelector("#p1 [data-tr-dst]")?.textContent).toBe(
    "ZH:Hello breakpoint world"
  );
});

test("cancelAll while paused at beforeApiDispatch prevents provider call after resolution", async () => {
  const win = new Window();
  win.document.body.innerHTML = `<div id="p1">Cancelled while paused</div>`;
  const segs = collectSegments(
    win.document.body as unknown as Element,
    parseSiteDelta(""),
    { getStyle }
  );

  let releaseGate: (() => void) | null = null;
  let providerCalls = 0;
  const gatePromise = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  const runner = createBatchRunner({
    doc: win.document as unknown as Document,
    delta: parseSiteDelta(""),
    getConfig: () => DEFAULT_CONFIG,
    getProvider: () => ({
      id: "translate-pa",
      translateBatch: (items: string[]) => {
        providerCalls += 1;
        return Promise.resolve(items.map((x) => `ZH:${x}`));
      },
    }),
    beforeApiDispatch: () => gatePromise,
  });

  const pending = runner.translateBatch(segs);
  await Promise.resolve();
  await Promise.resolve();
  expect(providerCalls).toBe(0);

  runner.cancelAll();
  releaseGate?.();
  await pending;
  expect(providerCalls).toBe(0);
  expect(win.document.querySelector("#p1 [data-tr-dst]")?.textContent).toBe("");
});
