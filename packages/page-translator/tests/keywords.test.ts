import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { decodeTranslatedHtml } from "../src/capture/inline-codec";
import {
  extractPageKeywords,
  maskKeywordsInHtml,
} from "../src/transform/keywords";

test("extractPageKeywords detects repeated CamelCase/brand/proper nouns across segments", () => {
  const kw = extractPageKeywords([
    "Welcome to Violentmonkey extension docs.",
    "Configure Violentmonkey and TypeScript easily.",
    "Violentmonkey runs TypeScript bundles in Chrome and TypeScript stays fast.",
  ]);
  expect(kw).toContain("Violentmonkey");
  expect(kw).toContain("TypeScript");
  expect(kw).not.toContain("Welcome");
});

test("maskKeywordsInHtml wraps non-tag occurrences with translate=no and decodeTranslatedHtml unwraps cleanly", () => {
  const masked = maskKeywordsInHtml(
    'Search <x id="0">GitHub</x> for TypeScript tips.',
    ["GitHub", "TypeScript"]
  );
  expect(masked).toBe(
    'Search <x id="0"><span translate="no" data-ptr-kw="1">GitHub</span></x> for <span translate="no" data-ptr-kw="1">TypeScript</span> tips.'
  );

  const win = new Window();
  const link = win.document.createElement("a");
  link.setAttribute("href", "https://github.com");
  const frag = decodeTranslatedHtml(
    '在<x id="0"><span translate="no" data-ptr-kw="1">GitHub</span></x>搜尋<span translate="no" data-ptr-kw="1">TypeScript</span>技巧。',
    [
      {
        id: 0,
        element: link as unknown as Element,
        atomic: false,
        modifiers: new Set(),
      },
    ],
    win.document as unknown as Document
  );
  expect(frag.querySelector("[data-ptr-kw]")).toBeNull();
  expect(frag.querySelector("a")?.textContent).toBe("GitHub");
  expect(frag.textContent).toBe("在GitHub搜尋TypeScript技巧。");
});
