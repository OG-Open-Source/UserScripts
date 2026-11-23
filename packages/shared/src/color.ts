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

export interface ZeroErrorOklchResult {
  C: number;
  css: string;
  h: number;
  hex: string;
  L: number;
  maxChannelError: number;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

const HEX_SHORT_RE = /^#?(?<r>[a-f\d])(?<g>[a-f\d])(?<b>[a-f\d])$/iu;
const HEX_FULL_RE = /^#?(?<r>[a-f\d]{2})(?<g>[a-f\d]{2})(?<b>[a-f\d]{2})$/iu;

/** Normalize `#RGB` or `#RRGGBB` (with or without `#`) to `#RRGGBB`. Returns null on invalid input. */
export function normalizeHex(hex: string): string | null {
  const trimmed = hex.trim();
  const short = HEX_SHORT_RE.exec(trimmed);
  if (short?.groups) {
    const { r, g, b } = short.groups;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  const full = HEX_FULL_RE.exec(trimmed);
  if (full?.groups) {
    const { r, g, b } = full.groups;
    return `#${r}${g}${b}`.toUpperCase();
  }
  return null;
}

function parseHexBytes(normalizedHex: string): [number, number, number] {
  return [
    Number.parseInt(normalizedHex.slice(1, 3), 16),
    Number.parseInt(normalizedHex.slice(3, 5), 16),
    Number.parseInt(normalizedHex.slice(5, 7), 16),
  ];
}

/** Parse `#RGB` or `#RRGGBB` into Oklab. Returns null on malformed input. */
export function hexToOklab(hex: string): Oklab | null {
  const normalized = normalizeHex(hex);
  if (!normalized) {
    return null;
  }
  const [rb, gb, bb] = parseHexBytes(normalized);
  const r = srgbToLinear(rb / 255);
  const g = srgbToLinear(gb / 255);
  const b = srgbToLinear(bb / 255);
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

function oklabToRgbBytes(lab: Oklab): [number, number, number] {
  const l_ = lab.L + 0.396_337_777_4 * lab.a + 0.215_803_757_3 * lab.b;
  const m_ = lab.L - 0.105_561_345_8 * lab.a - 0.063_854_172_8 * lab.b;
  const s_ = lab.L - 0.089_484_177_5 * lab.a - 1.291_485_548 * lab.b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const toByte = (linear: number) =>
    Math.max(0, Math.min(255, Math.round(255 * linearToSrgb(linear))));
  return [
    toByte(4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s),
    toByte(-1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s),
    toByte(-0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s),
  ];
}

/** Render an Oklab color back to sRGB hex (used by host tonal derivation). */
export function oklabToHex(lab: Oklab): string {
  const [r, g, b] = oklabToRgbBytes(lab);
  const hexPart = (c: number) => c.toString(16).padStart(2, "0");
  return `#${hexPart(r)}${hexPart(g)}${hexPart(b)}`.toUpperCase();
}

/** Render an Oklch color back to `#RRGGBB` hex. */
export function oklchToHex(lch: Oklch): string {
  return oklabToHex(oklchToOklab(lch));
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

function outwardOffsets(maxSteps: number): number[] {
  const offsets = [0];
  for (let i = 1; i <= maxSteps; i += 1) {
    offsets.push(i, -i);
  }
  return offsets;
}

function normalizeHue(h: number): number {
  const mod = roundTo(((h % 360) + 360) % 360, 2);
  return mod === 360 ? 0 : mod;
}

function evaluateCandidate(
  lPercent: number,
  cVal: number,
  hVal: number,
  targetRgb: readonly [number, number, number],
  normalizedHex: string
): ZeroErrorOklchResult {
  const lRounded = roundTo(Math.max(0, Math.min(100, lPercent)), 2);
  const cRounded = roundTo(Math.max(0, cVal), 2);
  const hRounded = cRounded === 0 ? 0 : normalizeHue(hVal);
  const L = lRounded / 100;
  const [r, g, b] = oklabToRgbBytes(
    oklchToOklab({ L, C: cRounded, h: hRounded })
  );
  const maxChannelError = Math.max(
    Math.abs(r - targetRgb[0]),
    Math.abs(g - targetRgb[1]),
    Math.abs(b - targetRgb[2])
  );
  return {
    L,
    C: cRounded,
    h: hRounded,
    hex: normalizedHex,
    css: `oklch(${lRounded}% ${cRounded} ${hRounded})`,
    maxChannelError,
  };
}

function searchIntegerHue(
  L2: number,
  C2: number,
  H0: number,
  targetRgb: readonly [number, number, number],
  normalized: string
): ZeroErrorOklchResult | null {
  const lOffsets = outwardOffsets(50);
  for (const dC of [0, 0.01, -0.01]) {
    const cCand = roundTo(Math.max(0, C2 + dC), 2);
    for (const dH of [0, 1, -1, 2, -2]) {
      const hCand = cCand === 0 ? 0 : H0 + dH;
      for (const dL of lOffsets) {
        const cand = evaluateCandidate(
          L2 + dL * 0.01,
          cCand,
          hCand,
          targetRgb,
          normalized
        );
        if (cand.maxChannelError === 0) {
          return cand;
        }
      }
    }
  }
  return null;
}

function searchFineHue(
  L2: number,
  C2: number,
  H0: number,
  targetRgb: readonly [number, number, number],
  normalized: string
): ZeroErrorOklchResult | null {
  if (C2 === 0) {
    return null;
  }
  const hOffsets = outwardOffsets(100);
  const lOffsets = outwardOffsets(30);
  for (const dH of hOffsets) {
    const hCand = H0 + dH * 0.01;
    for (const dL of lOffsets) {
      const cand = evaluateCandidate(
        L2 + dL * 0.01,
        C2,
        hCand,
        targetRgb,
        normalized
      );
      if (cand.maxChannelError === 0) {
        return cand;
      }
    }
  }
  return null;
}

/**
 * Convert a hex color (`#RGB` or `#RRGGBB`) to a `<= 2`-decimal `oklch()`
 * representation that round-trips back to the exact 8-bit sRGB bytes.
 */
export function hexToZeroErrorOklch(hex: string): ZeroErrorOklchResult | null {
  const normalized = normalizeHex(hex);
  const lab = normalized ? hexToOklab(normalized) : null;
  if (!(normalized && lab)) {
    return null;
  }
  const targetRgb = parseHexBytes(normalized);
  const lch = oklabToOklch(lab);
  const L2 = roundTo(lch.L * 100, 2);
  const C2 = roundTo(lch.C, 2);
  const H0 = C2 === 0 ? 0 : Math.round(lch.h) % 360;

  const tier1 = evaluateCandidate(L2, C2, H0, targetRgb, normalized);
  if (tier1.maxChannelError === 0) {
    return tier1;
  }

  return (
    searchIntegerHue(L2, C2, H0, targetRgb, normalized) ??
    searchFineHue(L2, C2, H0, targetRgb, normalized) ??
    tier1
  );
}

/**
 * Format a hex color as a 0-error `<= 2`-decimal `oklch()` CSS string.
 * Throws `RangeError` if the hex is invalid or has no 0-error candidate.
 */
export function formatZeroErrorOklch(hex: string): string {
  const result = hexToZeroErrorOklch(hex);
  if (result?.maxChannelError !== 0) {
    throw new RangeError(
      `Cannot represent "${hex}" as 0-error <= 2-decimal oklch()`
    );
  }
  return result.css;
}

/** Brand hex anchors for Simple.css and Shadow DOM themes. */
export const US_PALETTE_HEX = {
  accent: "#D71",
  accentDeep: "#952",
  accentSoft: "#C72",
  secondary: "#677",
  mutedDark: "#899",
  slate: "#334",
  inkDark: "#111",
  surfaceDark: "#222",
  surfaceDark3: "#444",
  surfaceLight3: "#CCC",
  borderLight: "#DDD",
  surfaceLight: "#EEE",
  canvasLight: "#FFF",
} as const;

type PaletteKey = keyof typeof US_PALETTE_HEX;

/** Derived 0-error `<= 2`-decimal `oklch()` CSS strings for every brand anchor. */
export const US_PALETTE_OKLCH: Readonly<Record<PaletteKey, string>> =
  Object.freeze(
    Object.fromEntries(
      (Object.entries(US_PALETTE_HEX) as [PaletteKey, string][]).map(
        ([key, hex]) => [key, formatZeroErrorOklch(hex)]
      )
    ) as Record<PaletteKey, string>
  );
