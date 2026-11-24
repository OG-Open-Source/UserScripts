import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { US_PALETTE_OKLCH } from "../src/color";
import { resolveThemeTokens } from "../src/theme-mode";
import { getSettingsTokensCss, getUiTokensCss } from "../src/ui-tokens";

const BORDER_1PX_RE = /border:\s*1px/u;
const SCALE_FN_RE = /scale\(/u;
const FORBIDDEN_SETTINGS_TOKEN_PATTERNS = [
  /\bbody\b/u,
  /\bheader\b/u,
  /\.us-/u,
  /(?<![-\w])border:/u,
  /(?<![-\w])padding:/u,
  /(?<![-\w])margin:/u,
] as const;

test("emits borderless NovaKit tokens, radius scale, and pulse keyframes", () => {
  const css = getUiTokensCss(":host");
  expect(css).toContain("--us-radius-lg: 12px");
  expect(css).toContain("--us-radius-md: 8px");
  expect(css).toContain("--us-radius-sm: 6px");
  expect(css).toContain("oklch(55.22% 0.2201 299.38)");
  expect(css).toContain("@keyframes us-pulse-ring");
  expect(css).toContain("prefers-color-scheme: dark");
  // Borderless: no 1px boxes; no deformation
  expect(css).not.toMatch(BORDER_1PX_RE);
  expect(css).not.toMatch(SCALE_FN_RE);
});

test("appends host token block when host tokens provided", () => {
  const host = resolveThemeTokens("host", { bg: "#f4ecd8", fg: "#2b2114" });
  const css = getUiTokensCss(":host", host ?? undefined);
  expect(css).toContain("--us-bg: oklch(");
});

test("keeps legacy class names for existing consumers", () => {
  const css = getUiTokensCss();
  for (const cls of [
    ".us-panel",
    ".us-panel-head",
    ".us-panel-sec",
    ".us-btn",
    ".us-btn-sm",
    ".us-btn-primary",
    ".us-input",
    ".us-chip",
    ".us-dot",
    ".us-checkbox",
    ".us-chevron",
  ]) {
    expect(css).toContain(cls);
  }
  expect(css).toContain(".us-btn-group");
  expect(css).toContain(".us-collapse");
});

test("emits media overlay contrast tokens and variable-driven button hover states", () => {
  const css = getUiTokensCss(":host");
  expect(css).toContain("--us-overlay-bg:");
  expect(css).toContain("--us-overlay-hover:");
  expect(css).toContain("--us-overlay-fg:");
  expect(css).toContain("--us-overlay-shadow:");
  expect(css).toContain("--_btn-bg");
  expect(css).toContain("--_btn-fg");
  expect(css).toContain("--_btn-hover-bg");
  expect(css).toContain("--_btn-hover-fg");
});

test("getSettingsTokensCss emits --us-* OkLch tokens across system, light, and dark themes", () => {
  const css = getSettingsTokensCss();
  expect(css).toContain(":root {");
  expect(css).toContain("@media (prefers-color-scheme: dark)");
  expect(css).toContain(':root:not([data-theme-mode="light"])');
  expect(css).toContain(':root[data-theme-mode="light"]');
  expect(css).toContain(':root[data-theme-mode="dark"]');
  expect(css).toContain(`--us-bg: ${US_PALETTE_OKLCH.canvasLight}`);
  expect(css).toContain(`--us-surface: ${US_PALETTE_OKLCH.surfaceLight}`);
  expect(css).toContain(`--us-accent-bg: ${US_PALETTE_OKLCH.accent}`);
  expect(css).toContain("--us-surface-2:");
  expect(css).toContain("--us-surface-3:");
  expect(css).toContain("--us-fg:");
  expect(css).toContain("--us-muted:");
  expect(css).toContain("--us-accent-fg:");
  expect(css).toContain("--us-accent-hover:");
  expect(css).toContain("--us-focus:");
  expect(css).toContain("--us-radius-lg: 12px");
  expect(css).toContain("--us-radius-md: 8px");
  expect(css).toContain("--us-radius-sm: 6px");
  expect(css).toContain("--us-shadow:");
  expect(css).toContain("--us-shadow-sm:");
  expect(css).toContain("--us-sans:");
  expect(css).toContain("--us-mono:");
  expect(css).toContain("--us-ease:");
  expect(css).not.toMatch(BORDER_1PX_RE);
  expect(css).not.toMatch(SCALE_FN_RE);

  for (const forbidden of FORBIDDEN_SETTINGS_TOKEN_PATTERNS) {
    expect(css).not.toMatch(forbidden);
  }
});

test("settings/shared/tokens.css matches getSettingsTokensCss() without drift", () => {
  const tokensPath = resolve(
    import.meta.dir,
    "../../../settings/shared/tokens.css"
  );
  const diskCss = readFileSync(tokensPath, "utf8");
  expect(diskCss).toBe(`${getSettingsTokensCss()}\n`);
});

test("applies superellipse(2) squircle shape to .us-btn", () => {
  const css = getUiTokensCss(":host");
  expect(css).toContain("--rho: 0.5;");
  expect(css).toContain("border-radius: calc(var(--rho) * min(240px, 60px));");
  expect(css).toContain("corner-shape: superellipse(2);");
});
