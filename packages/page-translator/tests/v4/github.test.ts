import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import githubJson from "../../fingerprints/github.json" with { type: "json" };
import { collectSegments } from "../../src/capture/segmenter";
import { matchSiteTranslation } from "../../src/legacy/transform/template";
import { createSpaRescanController } from "../../src/platform/lifecycle";
import { discourseAdapter } from "../../src/structure/discourse";
import { fallbackAdapter } from "../../src/structure/fallback";
import type { FingerprintData } from "../../src/structure/fingerprints";
import { defaultAdapters, resolveAdapter } from "../../src/structure/registry";
import { parseSiteDelta } from "../../src/structure/site-rules";
import githubTranslations from "../../translations/github.com.json" with {
  type: "json",
};

const FIXTURE = readFileSync(
  new URL("./fixtures/github-repository.html", import.meta.url),
  "utf8"
);
const SCOPED_SELECTOR = "nav[aria-label='Insights'], .Subhead";
const BLOCK_TAGS = new Set([
  "ARTICLE",
  "ASIDE",
  "BODY",
  "BUTTON",
  "DIV",
  "FOOTER",
  "H1",
  "H2",
  "HEADER",
  "LI",
  "MAIN",
  "NAV",
  "P",
  "PRE",
  "SECTION",
  "UL",
]);

function createDocument(body: string, head = "") {
  const win = new Window({ url: "https://example.test/" });
  win.document.head.innerHTML = head;
  win.document.body.innerHTML = body;
  return { doc: win.document as unknown as Document, win };
}

function setupFixture() {
  const win = new Window({
    url: "https://github.com/OG-Open-Source/UserScripts",
  });
  win.document.write(FIXTURE);
  return { doc: win.document as unknown as Document, win };
}

function requireElement(root: ParentNode, selector: string): Element {
  const element = root.querySelector(selector);
  if (!element) {
    throw new Error(`Missing fixture element: ${selector}`);
  }
  return element;
}

function getStyle(el: Element) {
  const html = el as HTMLElement;
  return {
    display:
      html.style.display || (BLOCK_TAGS.has(el.tagName) ? "block" : "inline"),
    fontFamily: html.style.fontFamily,
    visibility: html.style.visibility || "visible",
  };
}

function collectGitHubSegments(doc: Document) {
  const adapter = resolveAdapter({ host: "github.com", doc });
  expect(adapter.id).toBe("github");
  return adapter.captureScope(doc).flatMap((root) =>
    collectSegments(root, parseSiteDelta(""), {
      adapter,
      getStyle,
    })
  );
}

function segmentText(segment: ReturnType<typeof collectSegments>[number]) {
  return segment.nodes
    .map((node) => node.textContent ?? "")
    .join("")
    .trim();
}

function capturedText(segments: ReturnType<typeof collectSegments>): string {
  return segments.map(segmentText).join("\n");
}

function requireSegment(
  segments: ReturnType<typeof collectSegments>,
  text: string
) {
  const segment = segments.find((entry) => segmentText(entry) === text);
  if (!segment) {
    throw new Error(`Missing captured segment: ${text}`);
  }
  return segment;
}

async function loadGitHubModule() {
  try {
    return await import("../../src/structure/github");
  } catch {
    return null;
  }
}

test("detect accepts GitHub hosts and GitHub meta or DOM markers", () => {
  const cases = [
    { body: "<main>Repository</main>", head: "", host: "GITHUB.COM" },
    { body: "<main>Gist</main>", head: "", host: "gist.github.com" },
    {
      body: "<main>GitHub mirror</main>",
      head: '<meta name="hostname" content="github.com">',
      host: "example.test",
    },
    {
      body: "<main>GitHub app</main>",
      head: '<meta name="apple-itunes-app" content="app-name=GitHub">',
      host: "example.test",
    },
    {
      body: '<header class="AppHeader"></header><main>GitHub DOM</main>',
      head: "",
      host: "example.test",
    },
  ];

  for (const fixture of cases) {
    const { doc } = createDocument(fixture.body, fixture.head);
    const adapter = defaultAdapters.find((entry) => entry.id === "github");
    expect(adapter?.detect({ host: fixture.host, doc })).toBe(true);
    expect(resolveAdapter({ host: fixture.host, doc }).id).toBe("github");
  }
});

test("resolveAdapter returns the exported githubAdapter", async () => {
  const githubModule = await loadGitHubModule();
  expect(githubModule).not.toBeNull();
  if (!githubModule) {
    return;
  }
  const { doc } = setupFixture();

  expect(resolveAdapter({ host: "github.com", doc })).toBe(
    githubModule.githubAdapter
  );
});

test("generic Turbo pages and Discourse pages do not detect as GitHub", () => {
  const generic = createDocument("<main>Generic Turbo content</main>");
  generic.doc.body?.setAttribute("data-turbo-body", "");
  expect(resolveAdapter({ host: "example.test", doc: generic.doc })).toBe(
    fallbackAdapter
  );

  const discourse = createDocument(
    '<header class="d-header"></header><main id="main-outlet">Discourse</main>',
    '<meta name="generator" content="Discourse 3.5.0">'
  );
  const github = defaultAdapters.find((entry) => entry.id === "github");
  expect(github?.detect({ host: "linux.do", doc: discourse.doc })).toBe(false);
  expect(resolveAdapter({ host: "linux.do", doc: discourse.doc })).toBe(
    discourseAdapter
  );
});

test("regions map repository navigation, insights, markdown, and page chrome", () => {
  const { doc } = setupFixture();
  const adapter = resolveAdapter({ host: "github.com", doc });
  const regions = adapter.regions(doc);

  expect(regions.topbar).toEqual([
    requireElement(doc, "#topbar"),
    requireElement(doc, "#legacy-topbar"),
  ]);
  expect(regions.sidebar).toEqual([requireElement(doc, "#sidebar")]);
  expect(regions.content).toEqual([requireElement(doc, "#main-content")]);
  expect(regions.footer).toEqual([
    requireElement(doc, "#main-footer"),
    requireElement(doc, "#site-footer"),
  ]);
  expect(regions.nav).toEqual([requireElement(doc, "#repo-nav")]);
  expect(regions.insights).toEqual([requireElement(doc, "#insights-nav")]);
  expect(regions.markdownBody).toEqual([requireElement(doc, "#readme")]);
});

test("capture scope retains repository prose and navigation but excludes chrome and code", () => {
  const { doc } = setupFixture();
  const adapter = resolveAdapter({ host: "github.com", doc });
  const scope = adapter.captureScope(doc);
  const segments = scope.flatMap((root) =>
    collectSegments(root, parseSiteDelta(""), { adapter, getStyle })
  );
  const captured = capturedText(segments);

  expect(scope).toEqual([requireElement(doc, "#main-content")]);
  expect(captured).toContain("README repository documentation.");
  expect(captured).toContain("Issue report body.");
  expect(captured).toContain("Pull request discussion body.");
  expect(captured).toContain("Issues");
  expect(captured).toContain("Pulse");
  expect(captured).toContain("Code frequency");
  expect(captured).not.toContain("Site header chrome");
  expect(captured).not.toContain("Legacy site header chrome");
  expect(captured).not.toContain("Nested footer chrome");
  expect(captured).not.toContain("Site footer chrome");
  expect(captured).not.toContain("DO_NOT_TRANSLATE_CODE");
  expect(captured).not.toContain("DO_NOT_TRANSLATE_MONOSPACE");
});

test("captured GitHub segments preserve scoped and global dictionary matches", () => {
  const { doc } = setupFixture();
  const segments = collectGitHubSegments(doc);
  const table = githubTranslations.locales["zh-Hant-TW"];
  const pulse = requireSegment(segments, "Pulse");
  const codeFrequency = requireSegment(segments, "Code frequency");
  const issues = requireSegment(segments, "Issues");
  const stars = requireSegment(segments, "12 stars");
  const outside = requireElement(doc, "#outside-pulse");

  expect(matchSiteTranslation("Pulse", table, pulse.container)).toEqual({
    kind: "static",
    html: "脈動",
    scope: SCOPED_SELECTOR,
  });
  expect(
    matchSiteTranslation("Code frequency", table, codeFrequency.container)
  ).toEqual({
    kind: "static",
    html: "程式碼頻率",
    scope: SCOPED_SELECTOR,
  });
  expect(matchSiteTranslation("Issues", table, issues.container)).toEqual({
    kind: "static",
    html: "議題",
  });
  expect(matchSiteTranslation("12 stars", table, stars.container)).toEqual({
    kind: "dynamic",
    html: "12 顆星",
  });
  expect(matchSiteTranslation("Pulse", table, outside)).toBeNull();
});

test("element policies enforce code and chrome skips before fingerprint rules", async () => {
  const githubModule = await loadGitHubModule();
  expect(githubModule).not.toBeNull();
  if (!githubModule) {
    return;
  }
  const { doc } = createDocument(
    '<code class="Subhead" id="code-title">skip</code><span class="markdown-body" id="mono-markdown" style="font-family: Consolas, monospace">skip</span><header class="AppHeader"><nav id="chrome-nav">skip</nav></header><nav id="repo-menu">menu</nav><button id="action">action</button><div class="Subhead" id="title">title</div><span class="Counter" id="badge">2</span><article class="markdown-body" id="prose">prose</article><input id="primitive"><p id="ordinary">ordinary</p>'
  );
  const adapter = githubModule.githubAdapter;

  expect(adapter.elementPolicy(requireElement(doc, "#code-title"))).toBe(
    "skip"
  );
  expect(adapter.elementPolicy(requireElement(doc, "#mono-markdown"))).toBe(
    "skip"
  );
  expect(adapter.elementPolicy(requireElement(doc, "#chrome-nav"))).toBe(
    "skip"
  );
  expect(adapter.elementPolicy(requireElement(doc, "#repo-menu"))).toBe("menu");
  expect(adapter.elementPolicy(requireElement(doc, "#action"))).toBe("button");
  expect(adapter.elementPolicy(requireElement(doc, "#title"))).toBe("title");
  expect(adapter.elementPolicy(requireElement(doc, "#badge"))).toBe("badge");
  expect(adapter.elementPolicy(requireElement(doc, "#prose"))).toBe("prose");
  expect(adapter.elementPolicy(requireElement(doc, "#primitive"))).toBe(
    "atomic"
  );
  expect(adapter.elementPolicy(requireElement(doc, "#ordinary"))).toBe("prose");
});

test("injected fingerprints deduplicate nested capture and SPA roots in either order", async () => {
  const githubModule = await loadGitHubModule();
  expect(githubModule).not.toBeNull();
  if (!githubModule) {
    return;
  }
  const { doc } = setupFixture();
  const fingerprint: FingerprintData = {
    ...(githubJson as FingerprintData),
    captureSelectors: [".markdown-body", "main"],
    spaRescanSelectors: [".markdown-body", "main"],
  };
  const adapter = githubModule.createGitHubAdapter(fingerprint);
  const main = requireElement(doc, "#main-content");

  expect(adapter.captureScope(doc)).toEqual([main]);
  expect(adapter.onSpaNavigate(doc)).toEqual([main]);
});

test("SPA navigation rescans content regions only through the controller", async () => {
  const { doc } = setupFixture();
  const adapter = resolveAdapter({ host: "github.com", doc });
  const main = requireElement(doc, "#main-content");
  const batches: Element[][] = [];
  const regions = adapter.onSpaNavigate(doc);

  expect(regions).toEqual([main]);
  expect(regions).not.toContain(doc.body);
  expect(regions).not.toContain(doc.documentElement);
  expect(regions).not.toContain(requireElement(doc, "#topbar"));
  expect(regions).not.toContain(requireElement(doc, "#site-footer"));

  const controller = createSpaRescanController({
    adapter,
    rescan: (contentRegions) => {
      batches.push(contentRegions);
    },
  });
  expect(await controller.onSpaNavigate(doc)).toBe(true);
  expect(batches).toEqual([[main]]);
});
