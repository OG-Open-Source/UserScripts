import { expect, test } from "bun:test";
import {
  formatOklch,
  getAccessibleTextOklch,
  hexToOklab,
  NOVAKIT,
  oklabToOklch,
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
