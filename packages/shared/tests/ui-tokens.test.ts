import { expect, test } from "bun:test";
import { resolveThemeTokens } from "../src/theme-mode";
import { getUiTokensCss } from "../src/ui-tokens";

const BORDER_1PX_RE = /border:\s*1px/u;
const SCALE_FN_RE = /scale\(/u;

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
