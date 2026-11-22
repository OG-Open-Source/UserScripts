import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  matchModifiers,
  parseSiteDelta,
  resolveSiteDeltaForHost,
} from "../src/legacy/site-rules";

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
  const el = win.document.querySelector("div")!;
  const delta = parseSiteDelta(`
    * .a : block
    * .b : keep-orig
    * [invalid=== : no-spacing
  `);
  const mods = matchModifiers(el as unknown as Element, delta);
  expect([...mods].sort()).toEqual(["block", "keep-orig"]);
});
