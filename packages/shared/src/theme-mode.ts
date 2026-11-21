/**
 * Four-mode theme resolver: dark / light / system / host.
 *
 * `dark` and `light` return concrete NovaKit borderless token sets in oklch().
 * `system` returns null so the CSS `prefers-color-scheme` media query in
 * getUiTokensCss() owns the tokens. `host` derives a tonal scale from the
 * host page's own background/foreground via the Oklab engine — hue is kept,
 * lightness is stepped, and text contrast follows NovaKit's rule. Host colors
 * are never hardcoded: callers probe the page (e.g. probeHostColors()) and pass
 * what they find.
 */
import type { Oklch } from "./color";
import {
  formatOklch,
  getAccessibleTextOklch,
  hexToOklab,
  oklabToOklch,
} from "./color";

export type ThemeMode = "dark" | "light" | "system" | "host";

export interface ThemeColors {
  /** Host page background, any CSS-parseable hex or rgb() (used for Oklab derivation). */
  bg: string;
  /** Host page foreground, any CSS-parseable hex or rgb(). */
  fg: string;
}

export interface ThemeTokens {
  accentBg: string;
  accentFg: string;
  bg: string;
  fg: string;
  muted: string;
  surface: string;
  surface2: string;
  surface3: string;
}

export const DEFAULT_THEME_MODE_STORAGE_KEY = "us:theme-mode";

const THEME_MODES: readonly ThemeMode[] = ["dark", "light", "system", "host"];

const DARK_TOKENS: ThemeTokens = {
  bg: "oklch(17.00% 0.0140 264.00)",
  surface: "oklch(22.50% 0.0180 264.00)",
  surface2: "oklch(27.50% 0.0220 264.00)",
  surface3: "oklch(33.00% 0.0260 264.00)",
  fg: "oklch(95.00% 0.0060 264.00)",
  muted: "oklch(68.00% 0.0220 264.00)",
  accentBg: "oklch(58.00% 0.1800 255.83)",
  accentFg: "oklch(98.50% 0.0040 255.83)",
};

const LIGHT_TOKENS: ThemeTokens = {
  bg: "oklch(98.00% 0.0040 264.00)",
  surface: "oklch(94.50% 0.0070 264.00)",
  surface2: "oklch(90.50% 0.0100 264.00)",
  surface3: "oklch(86.00% 0.0140 264.00)",
  fg: "oklch(16.00% 0.0140 264.00)",
  muted: "oklch(46.00% 0.0240 264.00)",
  accentBg: "oklch(52.20% 0.1771 255.83)",
  accentFg: "oklch(98.00% 0.0060 255.83)",
};

const HEX_6_RE = /^#([a-f\d]{6})$/iu;
const HEX_3_RE = /^#([a-f\d])([a-f\d])([a-f\d])$/iu;
const RGB_FUNC_RE =
  /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d+(?:\.\d+)?%?))?\s*\)$/iu;

function toHexByte(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");
}

/**
 * Normalize a CSS `#hex` or `rgb()/rgba()` color into `#RRGGBB`.
 * Returns null for `transparent`, zero-alpha colors, or unsupported strings.
 */
export function cssColorToHex(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const s = raw.trim();
  if (HEX_6_RE.test(s)) {
    return s.toUpperCase();
  }
  const m3 = HEX_3_RE.exec(s);
  if (m3) {
    return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toUpperCase();
  }
  const mRgb = RGB_FUNC_RE.exec(s);
  if (mRgb) {
    const alphaRaw = mRgb[4];
    if (alphaRaw !== undefined) {
      const alpha = alphaRaw.endsWith("%")
        ? Number.parseFloat(alphaRaw) / 100
        : Number.parseFloat(alphaRaw);
      if (alpha <= 0.05) {
        return null;
      }
    }
    const r = Number.parseFloat(mRgb[1] ?? "0");
    const g = Number.parseFloat(mRgb[2] ?? "0");
    const b = Number.parseFloat(mRgb[3] ?? "0");
    return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`.toUpperCase();
  }
  return null;
}

/**
 * Probe the host document's computed background and foreground colors as hex.
 * Walks `body` -> `documentElement`, returning null when unavailable or transparent.
 */
export function probeHostColors(doc: Document = document): ThemeColors | null {
  const view = doc.defaultView;
  const gcs =
    view && typeof view.getComputedStyle === "function"
      ? view.getComputedStyle.bind(view)
      : typeof getComputedStyle === "function"
        ? getComputedStyle
        : null;
  if (!gcs) {
    return null;
  }
  let bgHex: string | null = null;
  let fgHex: string | null = null;
  for (const el of [doc.body, doc.documentElement]) {
    if (!el) {
      continue;
    }
    const cs = gcs(el);
    if (!bgHex) {
      bgHex = cssColorToHex(cs.backgroundColor);
    }
    if (!fgHex) {
      fgHex = cssColorToHex(cs.color);
    }
    if (bgHex && fgHex) {
      break;
    }
  }
  if (!bgHex) {
    return null;
  }
  return { bg: bgHex, fg: fgHex ?? "#FFFFFF" };
}

function step(lch: Oklch, dL: number, chromaScale: number): string {
  const L = Math.max(0.04, Math.min(0.99, lch.L + dL));
  return formatOklch({ L, C: Math.min(0.03, lch.C * chromaScale), h: lch.h });
}

/**
 * Resolve a theme mode into concrete oklch tokens.
 *
 * - `dark`/`light`: fixed NovaKit borderless tables.
 * - `system`: null — CSS `prefers-color-scheme` owns the tokens.
 * - `host`: derived from the host page via Oklab tonal stepping; falls back
 *   to the dark table when no host colors are available.
 */
export function resolveThemeTokens(
  mode: ThemeMode,
  host?: ThemeColors | null
): ThemeTokens | null {
  if (mode === "system") {
    return null;
  }
  if (mode !== "host" || !host) {
    return mode === "light" ? LIGHT_TOKENS : DARK_TOKENS;
  }

  const bgHex = cssColorToHex(host.bg) ?? host.bg;
  const bg = hexToOklab(bgHex);
  if (!bg) {
    return DARK_TOKENS;
  }

  const lch = oklabToOklch(bg);
  const dark = bg.L < 0.55;
  return {
    bg: formatOklch(lch),
    surface: step(lch, dark ? 0.055 : -0.04, 0.65),
    surface2: step(lch, dark ? 0.105 : -0.08, 0.65),
    surface3: step(lch, dark ? 0.16 : -0.12, 0.65),
    fg: getAccessibleTextOklch(bg, 0.3),
    muted: formatOklch({
      L: Math.max(0.1, Math.min(0.9, dark ? bg.L + 0.45 : bg.L - 0.42)),
      C: Math.min(0.035, lch.C * 0.7),
      h: lch.h,
    }),
    accentBg: dark ? DARK_TOKENS.accentBg : LIGHT_TOKENS.accentBg,
    accentFg: dark ? DARK_TOKENS.accentFg : LIGHT_TOKENS.accentFg,
  };
}

/** Apply `data-theme-mode` and any concrete host tokens onto an element (e.g., Shadow DOM host). */
export function applyThemeModeToElement(
  el: HTMLElement,
  mode: ThemeMode,
  host?: ThemeColors | null
): void {
  el.setAttribute("data-theme-mode", mode);
  const tokens = resolveThemeTokens(mode, host);
  const vars: Record<keyof ThemeTokens, string> = {
    bg: "--us-bg",
    surface: "--us-surface",
    surface2: "--us-surface-2",
    surface3: "--us-surface-3",
    fg: "--us-fg",
    muted: "--us-muted",
    accentBg: "--us-accent-bg",
    accentFg: "--us-accent-fg",
  };
  for (const [prop, cssVar] of Object.entries(vars)) {
    if (tokens) {
      el.style.setProperty(cssVar, tokens[prop as keyof ThemeTokens]);
    } else {
      el.style.removeProperty(cssVar);
    }
  }
}

/** Validate an arbitrary value as a ThemeMode, falling back to `system`. */
export function parseThemeMode(raw: unknown): ThemeMode {
  return THEME_MODES.includes(raw as ThemeMode) ? (raw as ThemeMode) : "system";
}

/** Read and validate a theme mode from web storage (defaults to `system`). */
export function readThemeMode(
  storage: Pick<Storage, "getItem"> = localStorage
): ThemeMode {
  try {
    return parseThemeMode(storage.getItem(DEFAULT_THEME_MODE_STORAGE_KEY));
  } catch {
    return "system";
  }
}
