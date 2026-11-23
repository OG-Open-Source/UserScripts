import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { US_PALETTE_OKLCH } from "../src/color";
import { resolveThemeTokens } from "../src/theme-mode";
import { getSimpleCssThemeVarsCss, getUiTokensCss } from "../src/ui-tokens";

const BORDER_1PX_RE = /border:\s*1px/u;
const SCALE_FN_RE = /scale\(/u;
const FORBIDDEN_SIMPLE_CSS_PATTERNS = [
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

test("getSimpleCssThemeVarsCss emits only Simple.css theme custom properties", () => {
  const css = getSimpleCssThemeVarsCss();
  expect(css).toContain(":root");
  expect(css).toContain("@media (prefers-color-scheme: dark)");
  expect(css).toContain(':root:not([data-theme-mode="light"])');
  expect(css).toContain(':root[data-theme-mode="light"]');
  expect(css).toContain(':root[data-theme-mode="dark"]');
  expect(css).toContain(`--accent: ${US_PALETTE_OKLCH.accent}`);
  expect(css).toContain(`--border: ${US_PALETTE_OKLCH.secondary}`);

  for (const forbidden of FORBIDDEN_SIMPLE_CSS_PATTERNS) {
    expect(css).not.toMatch(forbidden);
  }
});

test("settings/shared/tokens.css matches getSimpleCssThemeVarsCss() without drift", () => {
  const tokensPath = resolve(
    import.meta.dir,
    "../../../settings/shared/tokens.css"
  );
  const diskCss = readFileSync(tokensPath, "utf8");
  expect(diskCss).toBe(`${getSimpleCssThemeVarsCss()}\n`);
});
