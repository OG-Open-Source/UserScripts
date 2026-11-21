import { expect, test } from "bun:test";
import { isManagerPage, publishPresence, readPresence } from "../src/presence";

test("publishPresence merges across isolated userscript sandboxes via DOM registry", () => {
  let registryEl: { type: string; id: string; textContent: string } | null =
    null;
  const mockDoc = {
    getElementById: (id: string) =>
      id === "userscript-registry" ? registryEl : null,
    createElement: () => ({ type: "", id: "", textContent: "" }),
    head: {
      append: (el: { type: string; id: string; textContent: string }) => {
        registryEl = el;
      },
    },
  };
  const mockWin = { dispatchEvent: () => true };

  const prevDoc = (globalThis as Record<string, unknown>).document;
  const prevWin = (globalThis as Record<string, unknown>).window;
  const prevEvent = (globalThis as Record<string, unknown>).CustomEvent;
  (globalThis as Record<string, unknown>).document = mockDoc;
  (globalThis as Record<string, unknown>).window = mockWin;
  (globalThis as Record<string, unknown>).CustomEvent = class {
    constructor(public type: string) {}
  };

  try {
    // Sandbox 1 publishes h1dl
    delete (globalThis as Record<string, unknown>).__userscriptPresence;
    publishPresence({
      id: "h1dl",
      name: "Hanime1 Download Manager",
      description: "dl",
      localeUrl: "https://example.com/h1dl/locales.json",
    });

    // Sandbox 2 has its own empty globalThis.__userscriptPresence and publishes ptr
    delete (globalThis as Record<string, unknown>).__userscriptPresence;
    publishPresence({
      id: "ptr",
      name: "Page Translator",
      description: "tr",
      localeUrl: "https://example.com/ptr/locales.json",
    });

    const list = readPresence();
    expect(list.map((s) => s.id)).toEqual(["h1dl", "ptr"]);
  } finally {
    (globalThis as Record<string, unknown>).document = prevDoc;
    (globalThis as Record<string, unknown>).window = prevWin;
    (globalThis as Record<string, unknown>).CustomEvent = prevEvent;
    delete (globalThis as Record<string, unknown>).__userscriptPresence;
  }
});

test("isManagerPage matches hosted settings path or manager meta tag on localhost", () => {
  const noMetaDoc = { querySelector: () => null };
  const withMetaDoc = {
    querySelector: (sel: string) =>
      sel.includes("userscripts-manager") ? ({} as Element) : null,
  };
  expect(
    isManagerPage(noMetaDoc, {
      hostname: "og-open-source.github.io",
      pathname: "/UserScripts/settings/translate/",
    })
  ).toBe(true);
  expect(
    isManagerPage(noMetaDoc, {
      hostname: "github.com",
      pathname: "/UserScripts",
    })
  ).toBe(false);
  expect(
    isManagerPage(withMetaDoc, {
      hostname: "localhost",
      pathname: "/settings/translate/",
    })
  ).toBe(true);
});
