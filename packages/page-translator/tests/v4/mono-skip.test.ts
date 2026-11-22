import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  collectSegments,
  evaluateCaptureCandidate,
  isCodeOrMonospace,
} from "../../src/capture/segmenter";
import type { SiteStructureAdapter } from "../../src/structure/adapter";
import { fallbackAdapter } from "../../src/structure/fallback";
import { parseSiteDelta } from "../../src/structure/site-rules";

const CODE_TAGS = ["code", "pre", "kbd", "samp", "var", "tt"] as const;

function createDocument(markup: string) {
  const win = new Window();
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
      html.style.display ||
      (["BODY", "DIV", "P", "PRE"].includes(el.tagName) ? "block" : "inline"),
    fontFamily: html.style.fontFamily,
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

function capturedText(segments: ReturnType<typeof collectSegments>): string {
  return segments
    .flatMap((segment) => segment.nodes.map((node) => node.textContent ?? ""))
    .join("\n");
}

function permissiveAdapter(scope: Element): SiteStructureAdapter {
  return {
    id: "permissive-test",
    detect: () => true,
    regions: () => ({ content: [scope] }),
    captureScope: () => [scope],
    onSpaNavigate: () => [scope],
    elementPolicy: () => "prose",
  };
}

test("code-family tags stay hard-skipped inside adapter scope and user + selectors", () => {
  const codeMarkup = CODE_TAGS.map(
    (tag) => `<${tag} class="forced-code">skip-${tag}</${tag}>`
  ).join("");
  const { body, doc } = createDocument(
    `<div id="scope"><p>Visible before.</p>${codeMarkup}<p>Visible after.</p></div>`
  );
  const delta = parseSiteDelta("+ .forced-code");
  const adapter = permissiveAdapter(body);
  const segments = collectSegments(body, delta, { adapter, getStyle });
  const captured = capturedText(segments);

  expect(adapter.captureScope(doc)).toEqual([body]);
  expect(captured).toContain("Visible before.");
  expect(captured).toContain("Visible after.");
  for (const tag of CODE_TAGS) {
    expect(captured).not.toContain(`skip-${tag}`);
    expect(fallbackAdapter.elementPolicy(requireElement(body, tag))).toBe(
      "skip"
    );
  }
});

test("computed monospace stays hard-skipped even when adapter and user + request prose", () => {
  const { body } = createDocument(
    '<div><span class="mono" style="font-family: Consolas, monospace">mono secret</span><span class="copy">Visible prose.</span></div>'
  );
  const mono = requireElement(body, ".mono");
  const adapter = permissiveAdapter(body);
  const delta = parseSiteDelta("+ .mono");
  const segments = collectSegments(body, delta, { adapter, getStyle });
  const captured = capturedText(segments);

  expect(isCodeOrMonospace(mono, getStyle)).toBe(true);
  expect(fallbackAdapter.elementPolicy(mono)).toBe("skip");
  expect(captured).toContain("Visible prose.");
  expect(captured).not.toContain("mono secret");
  expect(evaluateCaptureCandidate(mono, delta, { adapter, getStyle })).toEqual({
    included: false,
    excludeReason: "mono",
    classification: "skip",
    computedStyleSummary: {
      display: "inline",
      visibility: "visible",
      fontFamily: "Consolas, monospace",
    },
  });
});

test("candidate decisions expose reusable exclusion reasons and style summaries", () => {
  const { body } = createDocument(
    '<div id="scope"><span class="removed">Removed</span><span class="hidden" style="display: none">Hidden</span><div class="editable" contenteditable="true">Ignored</div><aside data-us-ui="other">Foreign</aside></div><p class="outside">Outside</p>'
  );
  const scope = requireElement(body, "#scope");
  const delta = parseSiteDelta("- .removed");
  const cases = [
    [".removed", "removed"],
    [".hidden", "hidden"],
    [".editable", "non-prose"],
    ["aside", "foreign-ui"],
    [".outside", "out-of-scope"],
  ] as const;

  for (const [selector, reason] of cases) {
    const decision = evaluateCaptureCandidate(
      requireElement(body, selector),
      delta,
      { getStyle, scope: [scope] }
    );
    expect(decision.included).toBe(false);
    expect(decision.excludeReason).toBe(reason);
    expect(decision.computedStyleSummary).toHaveProperty("display");
    expect(decision.computedStyleSummary).toHaveProperty("visibility");
    expect(decision.computedStyleSummary).toHaveProperty("fontFamily");
  }
});
