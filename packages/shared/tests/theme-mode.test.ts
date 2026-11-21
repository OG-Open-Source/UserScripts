import { expect, test } from "bun:test";
import { readThemeMode, resolveThemeTokens } from "../src/theme-mode";

test("dark/light return concrete oklch token sets", () => {
  const dark = resolveThemeTokens("dark");
  expect(dark).not.toBeNull();
  expect(dark!.fg.startsWith("oklch(")).toBe(true);
  expect(dark!.accentBg.startsWith("oklch(")).toBe(true);
  const light = resolveThemeTokens("light");
  expect(light).not.toBeNull();
  expect(light!.bg.startsWith("oklch(")).toBe(true);
});

test("system returns null so prefers-color-scheme CSS owns tokens", () => {
  expect(resolveThemeTokens("system")).toBeNull();
});

test("host derives tonal scale from sepia page keeping hue", () => {
  const tokens = resolveThemeTokens("host", { bg: "#f4ecd8", fg: "#2b2114" });
  expect(tokens).not.toBeNull();
  expect(tokens!.bg.startsWith("oklch(")).toBe(true);
  // hue of #f4ecd8 ≈ 87 (yellow): chroma must not collapse to gray
  expect(Number.parseFloat(tokens!.bg.split(" ")[1])).toBeGreaterThan(0.004);
  // text on light bg must be dark
  expect(Number.parseFloat(tokens!.fg.slice(6))).toBeLessThan(45);
});

test("host without colors falls back to dark tokens", () => {
  const tokens = resolveThemeTokens("host", null);
  expect(tokens).not.toBeNull();
});

test("readThemeMode validates storage values", () => {
  expect(readThemeMode("bogus" as unknown as Storage)).toBe("system");
});

test("cssColorToHex parses rgb/rgba/short-hex and skips transparent", async () => {
  const { cssColorToHex } = await import("../src/theme-mode");
  expect(cssColorToHex("rgb(24, 24, 28)")).toBe("#18181C");
  expect(cssColorToHex("rgba(255, 255, 255, 0)")).toBeNull();
  expect(cssColorToHex("#abc")).toBe("#AABBCC");
});
