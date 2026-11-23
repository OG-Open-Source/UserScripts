import { expect, test } from "bun:test";
import {
  formatOklch,
  formatZeroErrorOklch,
  getAccessibleTextOklch,
  hexToOklab,
  hexToZeroErrorOklch,
  NOVAKIT,
  normalizeHex,
  oklabToOklch,
  oklchToHex,
  US_PALETTE_HEX,
  US_PALETTE_OKLCH,
} from "../src/color";

function requireOklab(hex: string) {
  const lab = hexToOklab(hex);
  if (!lab) {
    throw new Error(`Expected valid hex: ${hex}`);
  }
  return lab;
}

test("converts NovaKit semantic hexes to exact oklch()", () => {
  expect(formatOklch(oklabToOklch(requireOklab("#8844DD")))).toBe(
    "oklch(55.22% 0.2201 299.38)"
  );
  expect(formatOklch(oklabToOklch(requireOklab("#FFCC33")))).toBe(
    "oklch(86.66% 0.1647 88.68)"
  );
  expect(formatOklch(oklabToOklch(requireOklab("#CC3333")))).toBe(
    "oklch(55.94% 0.1900 25.86)"
  );
  expect(formatOklch(oklabToOklch(requireOklab("#0066CC")))).toBe(
    "oklch(52.20% 0.1771 255.83)"
  );
  expect(formatOklch(oklabToOklch(requireOklab("#667799")))).toBe(
    "oklch(56.86% 0.0566 263.97)"
  );
  expect(formatOklch(oklabToOklch(requireOklab("#33CC55")))).toBe(
    "oklch(74.27% 0.2039 146.60)"
  );
  expect(Object.keys(NOVAKIT)).toEqual([
    "purple",
    "yellow",
    "red",
    "blue",
    "gray",
    "green",
  ]);
});

test("derives accessible text lightness from bg without hardcoding gray", () => {
  const dark = requireOklab("#18181c");
  const light = requireOklab("#f4ecd8");
  const darkText = getAccessibleTextOklch(dark);
  const lightText = getAccessibleTextOklch(light);
  expect(darkText.startsWith("oklch(")).toBe(true);
  expect(lightText.startsWith("oklch(")).toBe(true);
  expect(Number.parseFloat(darkText.slice(6))).toBeGreaterThan(60);
  expect(Number.parseFloat(lightText.slice(6))).toBeLessThan(45);
});

test("formatOklch overrides channels and rejects bad hex", () => {
  const lch = oklabToOklch(requireOklab("#0066CC"));
  expect(formatOklch(lch, { l: 0.4 })).toBe("oklch(40.00% 0.1771 255.83)");
  expect(hexToOklab("nope")).toBeNull();
});

test("normalizeHex supports #RGB and #RRGGBB and rejects invalid inputs", () => {
  expect(normalizeHex("#D71")).toBe("#DD7711");
  expect(normalizeHex("677")).toBe("#667777");
  expect(normalizeHex("#334")).toBe("#333344");
  expect(normalizeHex("#aabbcc")).toBe("#AABBCC");
  expect(normalizeHex("nope")).toBeNull();
  expect(normalizeHex("#12")).toBeNull();
});

test("hexToOklab handles 3-digit shorthand identically to 6-digit", () => {
  expect(hexToOklab("#D71")).toEqual(hexToOklab("#DD7711"));
});

test("hexToZeroErrorOklch returns exact 0-error <=2-decimal CSS for brand triad", () => {
  expect(hexToZeroErrorOklch("#D71")).toMatchObject({
    css: "oklch(67.15% 0.16 56)",
    maxChannelError: 0,
  });
  expect(hexToZeroErrorOklch("#677")).toMatchObject({
    css: "oklch(55.54% 0.02 197)",
    maxChannelError: 0,
  });
  expect(hexToZeroErrorOklch("#334")).toMatchObject({
    css: "oklch(32.84% 0.03 285)",
    maxChannelError: 0,
  });
});

const OKLCH_TWO_DECIMAL_RE =
  /^oklch\(\d+(?:\.\d{1,2})?% \d+(?:\.\d{1,2})? \d+(?:\.\d{1,2})?\)$/u;

test("US_PALETTE_HEX entries all round-trip with 0 error and <= 2 decimals", () => {
  for (const [key, hex] of Object.entries(US_PALETTE_HEX) as [
    keyof typeof US_PALETTE_HEX,
    string,
  ][]) {
    const result = hexToZeroErrorOklch(hex);
    expect(result).not.toBeNull();
    if (!result) {
      throw new Error(`Expected non-null result for ${key} (${hex})`);
    }
    expect(result.maxChannelError).toBe(0);
    const css = US_PALETTE_OKLCH[key];
    expect(css).toBe(result.css);
    expect(OKLCH_TWO_DECIMAL_RE.test(css)).toBe(true);
    expect(oklchToHex({ L: result.L, C: result.C, h: result.h })).toBe(
      normalizeHex(hex)
    );
  }
});

test("formatZeroErrorOklch throws RangeError on invalid hex or non-0-error hex", () => {
  expect(() => formatZeroErrorOklch("nope")).toThrow(RangeError);
  expect(() => formatZeroErrorOklch("#112")).toThrow(RangeError);
});
