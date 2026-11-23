import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CaptureCandidate } from "../../src/capture/export";
import { exportCaptureCandidates } from "../../src/capture/export";
import type { SiteStructureAdapter } from "../../src/structure/adapter";
import { fallbackAdapter } from "../../src/structure/fallback";

const BLOCK_TAGS = new Set([
  "ARTICLE",
  "ASIDE",
  "BODY",
  "DIV",
  "FOOTER",
  "HEADER",
  "MAIN",
  "NAV",
  "P",
  "PRE",
]);

function createDocument(markup: string, url = "https://example.test/") {
  const win = new Window({ url });
  win.document.body.innerHTML = markup;
  const doc = win.document as unknown as Document;
  const { body } = doc;
  if (!body) {
    throw new Error("Fixture body is required");
  }
  return { body, doc };
}

function getStyle(el: Element) {
  const html = el as HTMLElement;
  return {
    display:
      html.style.display || (BLOCK_TAGS.has(el.tagName) ? "block" : "inline"),
    fontFamily: html.style.fontFamily || "",
    visibility: html.style.visibility || "visible",
  };
}

function requireElement(root: ParentNode, selector: string): Element {
  const element = root.querySelector(selector);
  if (!element) {
    throw new Error(`Missing fixture element: ${selector}`);
  }
  return element;
}

function candidateById(
  candidates: readonly CaptureCandidate[],
  id: string
): CaptureCandidate {
  const candidate = candidates.find((entry) =>
    entry.domPath.endsWith(`#${id}`)
  );
  if (!candidate) {
    throw new Error(`Missing exported candidate: ${id}`);
  }
  return candidate;
}

function createScopedDocument() {
  const fixture = createDocument(`
    <main id="scope">
      <p id="included" style="font-family: Arial">Hello <span>world</span>   again</p>
      <code id="mono" style="font-family: Consolas, monospace">Mono secret</code>
      <div id="hidden" style="display: none; visibility: hidden">Hidden<span id="hidden-child">Child</span></div>
      <span id="removed" class="remove-me">Removed</span>
      <aside id="foreign" data-us-ui="other">Foreign</aside>
      <div id="managed" data-tr-block="">Managed</div>
      <input id="atomic">
      <span id="modified">Modified</span>
      <div id="editable" contenteditable="true">Editable</div>
      <nav id="adapter-skip">Adapter skip</nav>
    </main>
    <p id="outside">Outside</p>
    <footer id="footer">Footer</footer>
  `);
  const scope = requireElement(fixture.doc, "#scope");
  const footer = requireElement(fixture.doc, "#footer");
  const adapter: SiteStructureAdapter = {
    ...fallbackAdapter,
    id: "scoped-test",
    captureScope: () => [scope],
    regions: () => ({ content: [scope], footer: [footer] }),
    elementPolicy: (el) =>
      el.id === "adapter-skip" ? "skip" : fallbackAdapter.elementPolicy(el),
  };
  const options = {
    adapter,
    getStyle,
    siteDeltas: {
      "example.test": "- .remove-me\n* #modified:inline-atomic",
    },
  };
  return { ...fixture, footer, options, scope };
}

test("exports direct and inherited exclusion reasons without hiding scoped descendants", () => {
  const { body, doc, options } = createScopedDocument();
  const candidates = exportCaptureCandidates(doc, options);
  const expectedReasons = {
    included: null,
    mono: "mono",
    hidden: "hidden",
    "hidden-child": "hidden",
    removed: "removed",
    foreign: "foreign-ui",
    managed: "translator-managed",
    atomic: "atomic",
    modified: "atomic",
    editable: "non-prose",
    "adapter-skip": "adapter-skip",
    outside: "out-of-scope",
    footer: "out-of-scope",
  } as const;

  expect(candidates).toHaveLength(body.querySelectorAll("*").length + 1);
  for (const [id, reason] of Object.entries(expectedReasons)) {
    const candidate = candidateById(candidates, id);
    expect(candidate.included).toBe(reason === null);
    expect(candidate.excludeReason).toBe(reason);
  }
  expect(candidateById(candidates, "scope").included).toBe(true);
  expect(
    candidates.find((candidate) => candidate.domPath === "html > body")
      ?.excludeReason
  ).toBe("out-of-scope");
  expect(candidateById(candidates, "atomic").classification).toBe("atomic");
  expect(candidateById(candidates, "modified").classification).toBe("prose");
});

test("records deterministic DOM paths, region membership, style summaries, and previews", () => {
  const { doc, options } = createScopedDocument();
  const candidates = exportCaptureCandidates(doc, options);
  const included = candidateById(candidates, "included");
  const mono = candidateById(candidates, "mono");

  expect(included).toMatchObject({
    domPath: "html > body > main#scope > p#included",
    region: "content",
    classification: "prose",
    textPreview: "Hello world again",
  });
  expect(candidateById(candidates, "included").computedStyleSummary).toEqual({
    display: "block",
    visibility: "visible",
    fontFamily: "Arial",
  });
  expect(mono.computedStyleSummary).toEqual({
    display: "inline",
    visibility: "visible",
    fontFamily: "Consolas, monospace",
  });
  expect(candidateById(candidates, "hidden").computedStyleSummary).toEqual({
    display: "none",
    visibility: "hidden",
    fontFamily: "",
  });
  expect(candidateById(candidates, "footer").region).toBe("footer");
  expect(candidateById(candidates, "outside").region).toBeNull();
  expect(
    candidates.find((candidate) => candidate.domPath === "html > body")?.region
  ).toBeNull();
  expect(
    candidates.find(
      (candidate) =>
        candidate.domPath === "html > body > main#scope > p#included > span"
    )?.textPreview
  ).toBe("world");

  const paths = candidates.map((candidate) => candidate.domPath);
  expect(new Set(paths).size).toBe(candidates.length);
  expect(
    exportCaptureCandidates(doc, options).map((candidate) => candidate.domPath)
  ).toEqual(paths);
});

test("normalizes and truncates text previews with JSON-serializable output", () => {
  const { doc } = createDocument(
    '<main><p id="preview">  Alpha\n beta\t gamma </p></main>'
  );
  const candidates = exportCaptureCandidates(doc, {
    getStyle,
    maxPreviewLength: 8,
  });
  const preview = candidateById(candidates, "preview");

  expect(preview.textPreview).toBe("Alpha be");
  expect(JSON.parse(JSON.stringify(candidates))).toEqual(candidates);
  expect(
    candidateById(exportCaptureCandidates(doc, { getStyle }), "preview")
      .textPreview
  ).toBe("Alpha beta gamma");
});

test("resolves Discourse and composes host site deltas with adapter policies", () => {
  const win = new Window({ url: "https://linux.do/t/example/1" });
  win.document.head.innerHTML =
    '<meta name="generator" content="Discourse 3.5.0">';
  win.document.body.innerHTML = `
    <header class="d-header" id="topbar">Header</header>
    <aside class="sidebar-wrapper" id="sidebar">Sidebar</aside>
    <main id="main-outlet">
      <article class="cooked" id="post">
        <p id="post-prose">Post prose</p>
        <p class="delta-remove" id="discourse-removed">Remove</p>
        <nav class="navigation-controls" id="discourse-nav">Navigation</nav>
        <code id="discourse-code">Code</code>
      </article>
    </main>
    <footer id="site-footer">Footer</footer>
  `;
  const doc = win.document as unknown as Document;
  const candidates = exportCaptureCandidates(doc, {
    getStyle,
    siteDeltas: { "linux.do": "- .delta-remove" },
  });

  expect(candidateById(candidates, "post")).toMatchObject({
    classification: "prose",
    included: true,
    region: "content",
  });
  expect(candidateById(candidates, "discourse-removed").excludeReason).toBe(
    "removed"
  );
  expect(candidateById(candidates, "discourse-nav")).toMatchObject({
    excludeReason: "adapter-skip",
    region: ["content", "nav"],
  });
  expect(candidateById(candidates, "discourse-code").excludeReason).toBe(
    "mono"
  );
  expect(candidateById(candidates, "topbar")).toMatchObject({
    excludeReason: "out-of-scope",
    region: "topbar",
  });
  expect(candidateById(candidates, "sidebar").region).toBe("sidebar");
  expect(candidateById(candidates, "site-footer").region).toBe("footer");
});

test("resolves GitHub and retains every matching nested region name", () => {
  const { doc } = createDocument(
    `
      <header class="AppHeader" id="github-topbar">Header</header>
      <main id="github-main">
        <article class="markdown-body" id="readme">
          <p id="github-prose">Documentation</p>
          <p class="delta-remove" id="github-removed">Remove</p>
        </article>
        <nav aria-label="Repository" id="repo-nav">Repository</nav>
      </main>
      <footer id="github-footer">Footer</footer>
    `,
    "https://github.com/OG-Open-Source/UserScripts"
  );
  const candidates = exportCaptureCandidates(doc, {
    getStyle,
    siteDeltas: { "github.com": "- .delta-remove" },
  });

  expect(candidateById(candidates, "github-prose")).toMatchObject({
    classification: "prose",
    included: true,
    region: ["content", "markdownBody"],
  });
  expect(candidateById(candidates, "github-removed").excludeReason).toBe(
    "removed"
  );
  expect(candidateById(candidates, "repo-nav")).toMatchObject({
    classification: "menu",
    included: true,
    region: ["content", "nav"],
  });
  expect(candidateById(candidates, "github-topbar")).toMatchObject({
    excludeReason: "out-of-scope",
    region: "topbar",
  });
  expect(candidateById(candidates, "github-footer").region).toBe("footer");
});

test("uses the fallback adapter and honors an explicit traversal root", () => {
  const { doc } = createDocument(
    '<main id="fallback-root"><p id="fallback-inside">Inside</p></main><p id="fallback-outside">Outside</p>',
    "https://unknown.example/"
  );
  const root = requireElement(doc, "#fallback-root");
  const candidates = exportCaptureCandidates(doc, {
    getStyle,
    root,
    siteDeltas: { "unknown.example": "- #fallback-inside" },
  });

  expect(candidates.map((candidate) => candidate.domPath)).toEqual([
    "html > body > main#fallback-root",
    "html > body > main#fallback-root > p#fallback-inside",
  ]);
  expect(candidateById(candidates, "fallback-root")).toMatchObject({
    included: true,
    region: "content",
  });
  expect(candidateById(candidates, "fallback-inside").excludeReason).toBe(
    "removed"
  );
});
