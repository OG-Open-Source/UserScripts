/**
 * NovaKit Oklab/Oklch color engine.
 *
 * Ported from NovaKit's adaptive color system (Oklab implementation by
 * Björn Ottosson, MIT/Public Domain). Converts hex → Oklab → Oklch, renders
 * `oklch()` CSS strings, and derives accessible text colors from a background
 * by shifting perceptual lightness while keeping the background's hue/chroma.
 */

export interface Oklab {
  a: number;
  b: number;
  L: number;
}

export interface Oklch {
  C: number;
  h: number;
  L: number;
}

/** NovaKit semantic base colors as `oklch()` strings (see docs/mdn-css-oklch.md). */
export const NOVAKIT = {
  purple: "oklch(55.22% 0.2201 299.38)",
  yellow: "oklch(86.66% 0.1647 88.68)",
  red: "oklch(55.94% 0.1900 25.86)",
  blue: "oklch(52.20% 0.1771 255.83)",
  gray: "oklch(56.86% 0.0566 263.97)",
  green: "oklch(74.27% 0.2039 146.60)",
} as const;

function srgbToLinear(component: number): number {
  return component <= 0.040_45
    ? component / 12.92
    : ((component + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(linear: number): number {
  const clamped = Math.max(0, Math.min(1, linear));
  return clamped <= 0.003_130_8
    ? 12.92 * clamped
    : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

const HEX_RE = /^#?(?<r>[a-f\d]{2})(?<g>[a-f\d]{2})(?<b>[a-f\d]{2})$/iu;

/** Parse `#RRGGBB` into Oklab. Returns null on malformed input. */
export function hexToOklab(hex: string): Oklab | null {
  const match = HEX_RE.exec(hex.trim());
  if (!match?.groups) {
    return null;
  }
  const r = srgbToLinear(Number.parseInt(match.groups.r, 16) / 255);
  const g = srgbToLinear(Number.parseInt(match.groups.g, 16) / 255);
  const b = srgbToLinear(Number.parseInt(match.groups.b, 16) / 255);
  const l = Math.cbrt(
    0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b
  );
  const m = Math.cbrt(
    0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b
  );
  const s = Math.cbrt(
    0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b
  );
  return {
    L: 0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
    a: 1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
    b: 0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
  };
}

export function oklabToOklch(lab: Oklab): Oklch {
  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) {
    h += 360;
  }
  return { L: lab.L, C, h };
}

export function oklchToOklab(lch: Oklch): Oklab {
  const rad = (lch.h * Math.PI) / 180;
  return { L: lch.L, a: lch.C * Math.cos(rad), b: lch.C * Math.sin(rad) };
}

/** Render an Oklab color back to sRGB hex (used by host tonal derivation). */
export function oklabToHex(lab: Oklab): string {
  const l_ = lab.L + 0.396_337_777_4 * lab.a + 0.215_803_757_3 * lab.b;
  const m_ = lab.L - 0.105_561_345_8 * lab.a - 0.063_854_172_8 * lab.b;
  const s_ = lab.L - 0.089_484_177_5 * lab.a - 1.291_485_548 * lab.b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const r = Math.round(
    255 *
      linearToSrgb(
        4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s
      )
  );
  const g = Math.round(
    255 *
      linearToSrgb(
        -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s
      )
  );
  const b = Math.round(
    255 *
      linearToSrgb(
        -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s
      )
  );
  const hexPart = (c: number) =>
    Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0");
  return `#${hexPart(r)}${hexPart(g)}${hexPart(b)}`.toUpperCase();
}

/**
 * Render an `oklch()` CSS color string, optionally overriding channels.
 * L renders as a percentage; C and h as fixed-precision numbers.
 */
export function formatOklch(
  lch: Oklch,
  override?: { l?: number; c?: number; h?: number }
): string {
  const L = override?.l ?? lch.L;
  const C = Math.max(0, override?.c ?? lch.C);
  const h = override?.h ?? lch.h;
  return `oklch(${(L * 100).toFixed(2)}% ${C.toFixed(4)} ${h.toFixed(2)})`;
}

/**
 * Derive an accessible text color for a background using NovaKit's
 * contrast-offset rule in Oklch: light backgrounds get dark text (L − 0.55),
 * dark backgrounds get light text (L + 0.52), both clamped, keeping the
 * background's hue at reduced chroma so text feels tonal rather than gray.
 */
export function getAccessibleTextOklch(
  bg: Oklab,
  chromaIntensity = 0.3
): string {
  const lch = oklabToOklch(bg);
  const isLight = bg.L > 0.6;
  const targetL = Math.max(
    0.05,
    Math.min(0.98, isLight ? bg.L - 0.55 : bg.L + 0.52)
  );
  return formatOklch({ L: targetL, C: lch.C * chromaIntensity, h: lch.h });
}
