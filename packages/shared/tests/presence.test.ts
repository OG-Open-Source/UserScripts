import { expect, test } from "bun:test";
import {
  isManagerPage,
  isTopFrame,
  publishPresence,
  readPresence,
} from "../src/presence";

test("publishPresence merges across isolated userscript sandboxes via DOM registry", () => {
  let registryEl: { type: string; id: string; textContent: string } | null =
    null;
  const mockDoc = {
    querySelector: (selector: string) =>
      selector === "#userscript-registry" ? registryEl : null,
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
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  };

  try {
    // Sandbox 1 publishes h1dl
    (globalThis as Record<string, unknown>).__userscriptPresence = undefined;
    publishPresence({
      id: "h1dl",
      name: "Hanime1 Download Manager",
      description: "dl",
      localeUrl: "https://example.com/h1dl/locales.json",
    });

    // Sandbox 2 has its own empty globalThis.__userscriptPresence and publishes ptr
    (globalThis as Record<string, unknown>).__userscriptPresence = undefined;
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
    (globalThis as Record<string, unknown>).__userscriptPresence = undefined;
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

test("isTopFrame returns true only when self === top and false on cross-origin error", () => {
  const topWin = {} as Window;
  (topWin as { self: unknown; top: unknown }).self = topWin;
  (topWin as { self: unknown; top: unknown }).top = topWin;
  expect(isTopFrame(topWin)).toBe(true);
  expect(isTopFrame(null)).toBe(true);

  const childWin = { self: {}, top: topWin } as unknown as Window;
  expect(isTopFrame(childWin)).toBe(false);

  const throwingWin = {
    get self() {
      throw new Error("SecurityError");
    },
    top: topWin,
  } as unknown as Window;
  expect(isTopFrame(throwingWin)).toBe(false);
});
