import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  appendSiteDeltaRule,
  matchModifiers,
  parseSiteDelta,
  removeSiteDeltaRule,
  resolveSiteDeltaForHost,
  safeMatches,
  serializeSiteDelta,
  suggestSelectorForElement,
} from "../../src/structure/site-rules";

test("parseSiteDelta parses +, -, * lines and ignores comments/blanks", () => {
  const delta = parseSiteDelta(`
    # Twitter / X overrides
    + [data-testid="tweetText"]
    - [data-testid="User-Name"]
    * pre, code : inline-atomic, no-spacing, no-opencc
    * .quote-card : block, keep-orig
  `);
  expect(delta.addSelectors).toEqual(['[data-testid="tweetText"]']);
  expect(delta.removeSelectors).toEqual(['[data-testid="User-Name"]']);
  expect(delta.modRules).toEqual([
    {
      selector: "pre, code",
      modifiers: ["inline-atomic", "no-spacing", "no-opencc"],
    },
    { selector: ".quote-card", modifiers: ["block", "keep-orig"] },
  ]);
});

test("resolveSiteDeltaForHost merges wildcard and exact host deltas", () => {
  const merged = resolveSiteDeltaForHost("x.com", {
    "*": "- code\n- pre",
    "*.x.com": '+ [data-testid="tweetText"]',
    "x.com": "* .handle : inline-atomic",
  });
  expect(merged.removeSelectors).toEqual(["code", "pre"]);
  expect(merged.addSelectors).toEqual(['[data-testid="tweetText"]']);
  expect(merged.modRules[0]?.modifiers).toEqual(["inline-atomic"]);
});

test("matchModifiers returns combined modifiers and ignores invalid CSS selectors safely", () => {
  const win = new Window();
  win.document.body.innerHTML = `<div class="a b"></div>`;
  const el = win.document.querySelector("div");
  if (!el) {
    throw new Error("expected div");
  }
  const delta = parseSiteDelta(`
    * .a : block
    * .b : keep-orig
    * [invalid=== : no-spacing
  `);
  const mods = matchModifiers(el as unknown as Element, delta);
  expect([...mods].sort((a, b) => a.localeCompare(b))).toEqual([
    "block",
    "keep-orig",
  ]);
});

test("serializeSiteDelta emits canonical +, -, and * rule lines", () => {
  const canonical = "+ .a\n- .b\n* .c : inline-atomic, no-spacing";
  expect(serializeSiteDelta(parseSiteDelta(canonical))).toBe(canonical);
});

test("appendSiteDeltaRule preserves comments/rules, trims whitespace, and deduplicates exact lines", () => {
  const initial = "# Site rules\r\n+ .keep\r\n";
  const withNew = appendSiteDeltaRule(initial, "  - .noise  ");
  expect(withNew).toBe("# Site rules\n+ .keep\n- .noise");

  const deduplicated = appendSiteDeltaRule(withNew, "- .noise");
  expect(deduplicated).toBe("# Site rules\n+ .keep\n- .noise");

  expect(appendSiteDeltaRule("", "  + .first  ")).toBe("+ .first");
  expect(appendSiteDeltaRule(withNew, "   ")).toBe(
    "# Site rules\n+ .keep\n- .noise"
  );
});

test("removeSiteDeltaRule drops matching rule lines while preserving comments and other rules", () => {
  const source = "# Header comment\n+ .keep\n- .remove-me\n* .mod : block";
  expect(removeSiteDeltaRule(source, "  - .remove-me  ")).toBe(
    "# Header comment\n+ .keep\n* .mod : block"
  );
  expect(removeSiteDeltaRule(source, "- .missing")).toBe(source);
});

test("suggestSelectorForElement prefers stable #id, [aria-label], or tag.class and always matches", () => {
  const win = new Window();
  win.document.body.innerHTML = `
    <div id="main-content" class="css-1a2b3c4 p-4"></div>
    <div id="123456" aria-label='Main "Feed"'></div>
    <article class="css-9x8y7z _1a2b3c data-tr-block post-body"></article>
    <section id="odd:id[0].x"></section>
    <div id="wrapper"><span>One</span><span>Two</span></div>
  `;
  const doc = win.document as unknown as Document;

  const mainContent = doc.querySelector("#main-content") as Element;
  const ariaEl = doc.querySelector("[aria-label]") as Element;
  const articleEl = doc.querySelector("article") as Element;
  const oddEl = doc.querySelector("section") as Element;
  const secondSpan = doc.querySelectorAll("#wrapper span")[1] as Element;

  const mainSel = suggestSelectorForElement(mainContent);
  expect(mainSel).toBe("#main-content");
  expect(safeMatches(mainContent, mainSel)).toBe(true);

  const ariaSel = suggestSelectorForElement(ariaEl);
  expect(ariaSel).toContain("div[aria-label=");
  expect(safeMatches(ariaEl, ariaSel)).toBe(true);

  const articleSel = suggestSelectorForElement(articleEl);
  expect(articleSel).toBe("article.post-body");
  expect(safeMatches(articleEl, articleSel)).toBe(true);

  const oddSel = suggestSelectorForElement(oddEl);
  expect(safeMatches(oddEl, oddSel)).toBe(true);

  const spanSel = suggestSelectorForElement(secondSpan);
  expect(spanSel).toContain("span:nth-of-type(2)");
  expect(safeMatches(secondSpan, spanSel)).toBe(true);
});
