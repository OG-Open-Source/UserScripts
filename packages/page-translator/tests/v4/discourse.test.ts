import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import discourseJson from "../../fingerprints/discourse.json" with {
  type: "json",
};
import {
  decodeTranslatedHtml,
  encodeInlineNodes,
} from "../../src/capture/inline-codec";
import { collectSegments } from "../../src/capture/segmenter";
import { runSegmentPipeline } from "../../src/core/pipeline";
import { createSpaRescanController } from "../../src/platform/lifecycle";
import type { SiteStructureAdapter } from "../../src/structure/adapter";
import { fallbackAdapter } from "../../src/structure/fallback";
import type { FingerprintData } from "../../src/structure/fingerprints";
import { defaultAdapters, resolveAdapter } from "../../src/structure/registry";
import { parseSiteDelta } from "../../src/structure/site-rules";
import { normalizeChineseText } from "../../src/text/normalize";

const FIXTURE = readFileSync(
  new URL("./fixtures/discourse-badge.html", import.meta.url),
  "utf8"
);
const NORMALIZE_OPTIONS = {
  punctNorm: "zh-norm",
  spacingMode: "both",
} as const;
const BLOCK_TAGS = new Set([
  "ARTICLE",
  "ASIDE",
  "BODY",
  "DIV",
  "FOOTER",
  "H1",
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
  const win = new Window({ url: "https://linux.do/" });
  win.document.head.innerHTML = head;
  win.document.body.innerHTML = body;
  return { doc: win.document as unknown as Document, win };
}

function setupFixture() {
  const win = new Window({ url: "https://linux.do/t/badges/1" });
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

function resolveDiscourse(doc: Document): SiteStructureAdapter {
  const adapter = resolveAdapter({ host: "linux.do", doc });
  expect(adapter.id).toBe("discourse");
  return adapter;
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

function capturedText(segments: ReturnType<typeof collectSegments>): string {
  return segments
    .flatMap((segment) => segment.nodes.map((node) => node.textContent ?? ""))
    .join("\n");
}

test("registry detects every Discourse document marker", () => {
  const cases = [
    {
      body: "<main>Discourse meta page</main>",
      head: '<meta name="generator" content="Discourse 3.5.0">',
    },
    { body: '<div class="discourse-root"></div>', head: "" },
    { body: '<div data-discourse="true"></div>', head: "" },
    {
      body: '<header class="d-header"></header><main id="main-outlet"></main>',
      head: "",
    },
  ];

  for (const fixture of cases) {
    const { doc } = createDocument(fixture.body, fixture.head);
    const adapter = resolveDiscourse(doc);
    expect(adapter.detect({ host: "linux.do", doc })).toBe(true);
  }
});

test("resolveAdapter returns the exported discourseAdapter", async () => {
  const { doc } = setupFixture();
  const resolved = resolveDiscourse(doc);
  const { discourseAdapter } = await import("../../src/structure/discourse");

  expect(resolved).toBe(discourseAdapter);
});

test("generic pages do not detect as Discourse and retain the fallback", () => {
  const { doc } = createDocument(
    '<main id="main-outlet"><p>Generic page content.</p></main>'
  );
  const adapter = defaultAdapters.find((entry) => entry.id === "discourse");

  expect(adapter?.detect({ host: "example.test", doc })).toBe(false);
  expect(resolveAdapter({ host: "example.test", doc })).toBe(fallbackAdapter);
});

test("createDiscourseAdapter honors an injected fingerprint", async () => {
  const fixture = setupFixture();
  resolveDiscourse(fixture.doc);
  const { createDiscourseAdapter } = await import(
    "../../src/structure/discourse"
  );
  const fingerprint: FingerprintData = {
    ...discourseJson,
    captureSelectors: [".custom-content"],
    detectSelectors: [".custom-discourse"],
    excludeSelectors: [],
    policies: { ".custom-content": "prose" },
    regions: { content: [".custom-content"] },
    spaRescanSelectors: [".custom-content"],
  };
  const { doc } = createDocument(
    '<div class="custom-discourse"><section class="custom-content">Custom content</section></div><footer>Excluded by scope</footer>'
  );
  const adapter = createDiscourseAdapter(fingerprint);
  const content = requireElement(doc, ".custom-content");

  expect(adapter.detect({ host: "community.example", doc })).toBe(true);
  expect(adapter.regions(doc)).toEqual({ content: [content] });
  expect(adapter.captureScope(doc)).toEqual([content]);
  expect(adapter.onSpaNavigate(doc)).toEqual([content]);
});

test("regions map Discourse chrome and content without duplicate elements", () => {
  const { doc } = setupFixture();
  const regions = resolveDiscourse(doc).regions(doc);

  expect(regions.topbar).toEqual([requireElement(doc, "#topbar")]);
  expect(regions.sidebar).toEqual([requireElement(doc, "#sidebar")]);
  expect(regions.content).toEqual([requireElement(doc, "#main-outlet")]);
  expect(regions.footer).toEqual([requireElement(doc, "#site-footer")]);
  expect(regions.nav).toHaveLength(3);
  expect(new Set(regions.nav)).toEqual(
    new Set([
      requireElement(doc, "#site-navigation"),
      requireElement(doc, "#navigation-pills"),
      requireElement(doc, "#content-navigation"),
    ])
  );
});

test("capture scope and segments retain posts and badges but exclude chrome and code", () => {
  const { doc } = setupFixture();
  const adapter = resolveDiscourse(doc);
  const mainOutlet = requireElement(doc, "#main-outlet");
  const scope = adapter.captureScope(doc);
  const segments = scope.flatMap((root) =>
    collectSegments(root, parseSiteDelta(""), { adapter, getStyle })
  );
  const captured = capturedText(segments);

  expect(scope).toEqual([mainOutlet]);
  expect(captured).toContain("LINUX.DO badge punctuation");
  expect(captured).toContain("LINUX.DO members discuss platform details.");
  expect(captured).toContain("Only Apple can do");
  expect(captured).toContain("（徽章）");
  expect(captured).toContain("iOS/iPadOS…");
  expect(captured).not.toContain("Site header chrome");
  expect(captured).not.toContain("Sidebar navigation");
  expect(captured).not.toContain("Topic navigation chrome");
  expect(captured).not.toContain("Reply navigation");
  expect(captured).not.toContain("Copyright LINUX.DO");
  expect(captured).not.toContain("DO_NOT_TRANSLATE_CODE");
});

test("capture fallback stays scoped and SPA rescans stay empty without main-outlet", () => {
  const { doc } = createDocument(
    '<div class="discourse-root"><header class="d-header">Header chrome</header><aside class="sidebar-wrapper">Sidebar chrome</aside><nav class="navigation-controls">Navigation chrome</nav><article class="cooked" id="fallback-post">Fallback post content</article><footer><span class="copyright">Footer copyright</span></footer></div>'
  );
  const adapter = resolveDiscourse(doc);
  const scope = adapter.captureScope(doc);
  const captured = capturedText(
    scope.flatMap((root) =>
      collectSegments(root, parseSiteDelta(""), { adapter, getStyle })
    )
  );

  expect(scope).toEqual([requireElement(doc, "#fallback-post")]);
  expect(captured).toContain("Fallback post content");
  expect(captured).not.toContain("Header chrome");
  expect(captured).not.toContain("Sidebar chrome");
  expect(captured).not.toContain("Navigation chrome");
  expect(captured).not.toContain("Footer copyright");
  expect(adapter.onSpaNavigate(doc)).toEqual([]);
});

test("element policies preserve the code hard floor and classify Discourse elements", () => {
  const fixture = setupFixture();
  const adapter = resolveDiscourse(fixture.doc);
  const { doc } = createDocument(
    '<div class="discourse-root"><code class="badge-wrapper" id="code-badge">skip code</code><span class="cooked" id="mono-cooked" style="font-family: Consolas, monospace">skip mono</span><input id="primitive"><span id="ordinary">Ordinary prose</span></div>'
  );

  expect(adapter.elementPolicy(requireElement(doc, "#code-badge"))).toBe(
    "skip"
  );
  expect(adapter.elementPolicy(requireElement(doc, "#mono-cooked"))).toBe(
    "skip"
  );
  expect(adapter.elementPolicy(requireElement(doc, "#primitive"))).toBe(
    "atomic"
  );
  expect(adapter.elementPolicy(requireElement(doc, "#ordinary"))).toBe("prose");
  expect(adapter.elementPolicy(requireElement(fixture.doc, "#topbar"))).toBe(
    "skip"
  );
  expect(adapter.elementPolicy(requireElement(fixture.doc, "#sidebar"))).toBe(
    "skip"
  );
  expect(
    adapter.elementPolicy(requireElement(fixture.doc, "#site-footer"))
  ).toBe("skip");
  expect(
    adapter.elementPolicy(requireElement(fixture.doc, "#content-navigation"))
  ).toBe("skip");
  expect(adapter.elementPolicy(requireElement(fixture.doc, ".copyright"))).toBe(
    "skip"
  );
  expect(
    adapter.elementPolicy(requireElement(fixture.doc, "#linux-do-badge"))
  ).toBe("badge");
  expect(
    adapter.elementPolicy(requireElement(fixture.doc, "#reply-button"))
  ).toBe("button");
  expect(
    adapter.elementPolicy(requireElement(fixture.doc, "#topic-menu"))
  ).toBe("menu");
  expect(
    adapter.elementPolicy(requireElement(fixture.doc, "#topic-title"))
  ).toBe("title");
  expect(
    adapter.elementPolicy(requireElement(fixture.doc, "#post-content"))
  ).toBe("prose");
});

test("nested LINUX.DO badge markup stays non-atomic through normalization and decode", async () => {
  const { doc } = setupFixture();
  const adapter = resolveDiscourse(doc);
  const badge = requireElement(doc, "#linux-do-badge");
  const encoded = encodeInlineNodes([badge], parseSiteDelta(""));
  const source =
    '<x id="0"><x id="1"><x id="2">Only Apple can do<x id="3">（徽章）</x>. iOS/iPadOS…</x></x></x>';
  const normalized =
    '<x id="0"><x id="1"><x id="2">Only Apple can do<x id="3">（徽章）</x>。iOS/iPadOS…</x></x></x>';
  let conversions = 0;

  expect(adapter.elementPolicy(badge)).toBe("badge");
  expect(encoded.payloadHtml).toBe(source);
  expect(encoded.slots.every((slot) => !slot.atomic)).toBe(true);
  expect(normalizeChineseText(encoded.payloadHtml, NORMALIZE_OPTIONS)).toBe(
    normalized
  );

  const result = await runSegmentPipeline(
    encoded.payloadHtml,
    {
      debugSpacingMarks: false,
      openccMode: "off",
      ...NORMALIZE_OPTIONS,
      targetLang: "zh-TW",
    },
    {
      createOpenCC: () => {
        conversions += 1;
        return { convert: (text: string) => text };
      },
    }
  );
  expect(result).toEqual({ html: normalized, route: "zh-subsystem" });
  expect(conversions).toBe(0);

  const fragment = decodeTranslatedHtml(result.html, encoded.slots, doc);
  expect(fragment.textContent).toBe("Only Apple can do（徽章）。iOS/iPadOS…");
  expect(fragment.querySelector("#linux-do-badge")).not.toBeNull();
  expect(fragment.querySelector("[data-tr-no-space]")).toBeNull();
  expect(fragment.querySelector("[data-tr-no-opencc]")).toBeNull();
});

test("SPA navigation rescans only main-outlet through the controller", async () => {
  const { doc } = setupFixture();
  const adapter = resolveDiscourse(doc);
  const mainOutlet = requireElement(doc, "#main-outlet");
  const batches: Element[][] = [];
  const regions = adapter.onSpaNavigate(doc);

  expect(regions).toEqual([mainOutlet]);
  expect(regions).not.toContain(doc.body);
  expect(regions).not.toContain(requireElement(doc, "#topbar"));
  expect(regions).not.toContain(requireElement(doc, "#sidebar"));
  expect(regions).not.toContain(requireElement(doc, "#site-footer"));

  const controller = createSpaRescanController({
    adapter,
    rescan: (contentRegions) => {
      batches.push(contentRegions);
    },
  });
  expect(await controller.onSpaNavigate(doc)).toBe(true);
  expect(batches).toEqual([[mainOutlet]]);
});
