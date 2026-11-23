/**
 * NovaKit Borderless design tokens and base control primitives shared across
 * monorepo-owned Shadow DOM panels and settings pages.
 *
 * Design rules (see docs/superpowers/specs/2026-11-21-novakit-ui-i18n-conflict-release-design.md):
 * - No borders: surfaces are separated by tonal background layers + shadows.
 * - Colors are NovaKit semantic bases in oklch(); text derives contrast via
 *   the Oklab engine (see color.ts / docs/mdn-css-oklab.md).
 * - Radius scale 12/8/6px (rounded-xl/lg/md as in NovaKit).
 * - No transform: scale() — press feedback is color + box-shadow pulse only.
 */
import { US_PALETTE_OKLCH } from "./color";
import type { SimpleCssThemeTokens, ThemeTokens } from "./theme-mode";
import {
  resolveThemeTokens,
  SIMPLE_CSS_DARK_TOKENS,
  SIMPLE_CSS_LIGHT_TOKENS,
} from "./theme-mode";

function scopeAttr(scopeSelector: string, attrSelector: string): string {
  return scopeSelector === ":host"
    ? `:host(${attrSelector})`
    : `${scopeSelector}${attrSelector}`;
}

function tokenVarsBlock(
  tokens: ThemeTokens,
  colorScheme?: "light" | "dark"
): string {
  return `${colorScheme ? `  color-scheme: ${colorScheme};\n` : ""}  --us-bg: ${tokens.bg};
  --us-surface: ${tokens.surface};
  --us-surface-2: ${tokens.surface2};
  --us-surface-3: ${tokens.surface3};
  --us-fg: ${tokens.fg};
  --us-muted: ${tokens.muted};
  --us-accent-bg: ${tokens.accentBg};
  --us-accent-fg: ${tokens.accentFg};
  --bg: var(--us-bg);
  --fg: var(--us-fg);
  --muted: var(--us-muted);
  --line: var(--us-surface-2);
  --surface: var(--us-surface);
  --accent: var(--us-accent-bg);`;
}

export function getUiTokensCss(
  scopeSelector = ":host",
  hostTokens?: ThemeTokens
): string {
  const lightTokens = resolveThemeTokens("light");
  const darkTokens = resolveThemeTokens("dark");
  if (!(lightTokens && darkTokens)) {
    throw new Error("Failed to resolve default light/dark theme tokens");
  }
  const hostOverride = hostTokens
    ? `
${scopeAttr(scopeSelector, '[data-theme-mode="host"]')} {
${tokenVarsBlock(hostTokens)}
}`
    : "";

  return `
${scopeSelector} {
  color-scheme: light dark;
  /* NovaKit semantic palette (oklch) */
  --nk-purple: oklch(55.22% 0.2201 299.38);
  --nk-yellow: oklch(86.66% 0.1647 88.68);
  --nk-red: oklch(55.94% 0.1900 25.86);
  --nk-blue: oklch(52.20% 0.1771 255.83);
  --nk-gray: oklch(56.86% 0.0566 263.97);
  --nk-green: oklch(74.27% 0.2039 146.60);

  /* Borderless tonal surfaces (light default) */
${tokenVarsBlock(lightTokens)}
  --us-accent-hover: ${US_PALETTE_OKLCH.accentDeep};
  --us-focus: ${US_PALETTE_OKLCH.accent};

  /* Media overlay contrast tokens (over bright/dark video or images) */
  --us-overlay-bg: oklch(16.00% 0.0140 264.00 / 0.78);
  --us-overlay-hover: oklch(22.00% 0.0180 264.00 / 0.90);
  --us-overlay-fg: oklch(97.00% 0.0050 264.00);
  --us-overlay-shadow: 0 2px 10px oklch(4% 0.01 264 / 0.50);

  /* NovaKit radius scale */
  --us-radius-lg: 12px;
  --us-radius-md: 8px;
  --us-radius-sm: 6px;

  --us-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --us-sans: 13px/1.48 system-ui, -apple-system, sans-serif;
  --us-shadow: 0 10px 30px oklch(15% 0.02 264 / 0.14), 0 2px 8px oklch(15% 0.02 264 / 0.07);
  --us-shadow-sm: 0 2px 8px oklch(15% 0.02 264 / 0.08);
  --us-ease: cubic-bezier(0.22, 1, 0.36, 1);

  --mono: var(--us-mono);
  font: var(--us-sans);
  color: var(--us-fg);
}

@media (prefers-color-scheme: dark) {
  ${scopeAttr(scopeSelector, ':not([data-theme-mode="light"])')} {
${tokenVarsBlock(darkTokens, "dark")}
    --us-accent-hover: ${US_PALETTE_OKLCH.accentSoft};
    --us-focus: ${US_PALETTE_OKLCH.accent};
    --us-shadow: 0 14px 36px oklch(5% 0.01 264 / 0.55), 0 3px 10px oklch(5% 0.01 264 / 0.35);
    --us-shadow-sm: 0 2px 10px oklch(5% 0.01 264 / 0.40);
  }
}

${scopeAttr(scopeSelector, '[data-theme-mode="light"]')} {
${tokenVarsBlock(lightTokens, "light")}
  --us-accent-hover: ${US_PALETTE_OKLCH.accentDeep};
  --us-focus: ${US_PALETTE_OKLCH.accent};
  --us-shadow: 0 10px 30px oklch(15% 0.02 264 / 0.14), 0 2px 8px oklch(15% 0.02 264 / 0.07);
  --us-shadow-sm: 0 2px 8px oklch(15% 0.02 264 / 0.08);
}

${scopeAttr(scopeSelector, '[data-theme-mode="dark"]')} {
${tokenVarsBlock(darkTokens, "dark")}
  --us-accent-hover: ${US_PALETTE_OKLCH.accentSoft};
  --us-focus: ${US_PALETTE_OKLCH.accent};
  --us-shadow: 0 14px 36px oklch(5% 0.01 264 / 0.55), 0 3px 10px oklch(5% 0.01 264 / 0.35);
  --us-shadow-sm: 0 2px 10px oklch(5% 0.01 264 / 0.40);
}
${hostOverride}

*,
*::before,
*::after {
  box-sizing: border-box;
}

.us-panel {
  background: var(--us-bg);
  color: var(--us-fg);
  border-radius: var(--us-radius-lg);
  box-shadow: var(--us-shadow);
  font: var(--us-sans);
  overflow: hidden;
  contain: layout style paint;
  isolation: isolate;
}

.us-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: var(--us-surface);
  cursor: grab;
  user-select: none;
  touch-action: none;
  transition: background-color 180ms var(--us-ease);
}

.us-panel-head.dragging {
  cursor: grabbing;
  background: var(--us-surface-2);
}

.us-panel-title {
  font-weight: 600;
  font-size: 12px;
}

.us-panel-sec {
  padding: 8px 12px;
}

.us-panel-sec + .us-panel-sec {
  margin-top: 2px;
}

.us-muted {
  color: var(--us-muted);
}

.us-mono {
  font-family: var(--us-mono);
  font-variant-numeric: tabular-nums;
  font-size: 11.5px;
}

.us-btn,
button.us-btn {
  position: relative;
  overflow: hidden;
  font: inherit;
  font-size: 12px;
  line-height: 1.25;
  padding: 6px 11px;
  background: var(--_btn-bg, var(--us-surface-2));
  color: var(--_btn-fg, var(--us-fg));
  border: none;
  border-radius: var(--us-radius-md);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  transition:
    background-color 200ms var(--us-ease),
    color 200ms var(--us-ease),
    box-shadow 220ms var(--us-ease);
}

.us-btn:hover:not(:disabled),
button.us-btn:hover:not(:disabled) {
  background: var(--_btn-hover-bg, var(--us-surface-3));
  color: var(--_btn-hover-fg, var(--_btn-fg, var(--us-fg)));
  box-shadow: var(--us-shadow-sm);
}

/* Tactile color + glow pulse on press — zero scale deformation */
.us-btn:active:not(:disabled),
button.us-btn:active:not(:disabled) {
  background: var(--us-accent-bg);
  color: var(--us-accent-fg);
  box-shadow: 0 0 0 3px oklch(from var(--us-accent-bg) l c h / 0.28);
}

.us-btn.flash-done,
button.us-btn.flash-done {
  animation: us-pulse-ring 420ms var(--us-ease);
}

@keyframes us-pulse-ring {
  0% {
    box-shadow: 0 0 0 0 oklch(from var(--nk-green) l c h / 0.55);
    background: var(--nk-green);
    color: oklch(15% 0.02 146.60);
  }
  100% {
    box-shadow: 0 0 0 8px oklch(from var(--nk-green) l c h / 0);
  }
}

.us-btn:focus-visible,
button.us-btn:focus-visible,
.us-input:focus-visible {
  outline: 2px solid var(--us-focus);
  outline-offset: 2px;
}

.us-btn-sm,
button.us-btn-sm {
  padding: 4px 9px;
  font-size: 11.5px;
  border-radius: var(--us-radius-sm);
}

.us-btn-primary,
button.us-btn-primary,
.us-btn[aria-pressed="true"],
button.us-btn[aria-pressed="true"] {
  --_btn-bg: var(--us-accent-bg);
  --_btn-fg: var(--us-accent-fg);
  --_btn-hover-bg: var(--us-accent-hover);
  --_btn-hover-fg: var(--us-accent-fg);
  font-weight: 600;
}

.us-btn-group {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--us-radius-md);
  background: var(--us-surface);
}

.us-btn-group > .us-btn,
.us-btn-group > button.us-btn {
  border-radius: var(--us-radius-sm);
}

.us-input,
input.us-input {
  width: 100%;
  font: inherit;
  font-size: 12px;
  padding: 6px 9px;
  background: var(--us-surface);
  color: var(--us-fg);
  border: none;
  border-radius: var(--us-radius-sm);
  transition:
    background-color 180ms var(--us-ease),
    box-shadow 200ms var(--us-ease);
}

.us-input:focus,
input.us-input:focus {
  background: var(--us-surface-2);
  box-shadow: 0 0 0 2px oklch(from var(--us-focus) l c h / 0.35);
  outline: none;
}

.us-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 7px;
  background: var(--us-surface-2);
  color: var(--us-fg);
  font-size: 11px;
  line-height: 1.3;
  border-radius: var(--us-radius-sm);
  font-variant-numeric: tabular-nums;
}

.us-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
  display: inline-block;
}

.us-dot.static { background: var(--nk-blue); }
.us-dot.dyn { background: var(--nk-purple); }
.us-dot.plus { background: var(--nk-green); }
.us-dot.manual { background: var(--nk-yellow); }
.us-dot.err { background: var(--nk-red); }

.us-chevron {
  width: 12px;
  height: 12px;
  flex: none;
  color: var(--us-muted);
  transition: transform 240ms var(--us-ease), color 180ms var(--us-ease);
}

[aria-expanded="true"] .us-chevron {
  transform: rotate(180deg);
  color: var(--us-fg);
}

.us-checkbox,
input.us-checkbox {
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
  width: 16px;
  height: 16px;
  flex: none;
  border: none;
  border-radius: var(--us-radius-sm);
  background: var(--us-surface-2);
  cursor: pointer;
  display: inline-grid;
  place-items: center;
  transition: background-color 200ms var(--us-ease), box-shadow 200ms var(--us-ease);
}

.us-checkbox:hover,
input.us-checkbox:hover {
  background: var(--us-surface-3);
}

.us-checkbox:active,
input.us-checkbox:active {
  box-shadow: 0 0 0 3px oklch(from var(--us-accent-bg) l c h / 0.28);
}

.us-checkbox::after,
input.us-checkbox::after {
  content: "";
  width: 8px;
  height: 4.5px;
  border-left: 1.8px solid var(--us-accent-fg);
  border-bottom: 1.8px solid var(--us-accent-fg);
  transform: translateY(-1px) rotate(-45deg);
  opacity: 0;
  transition: opacity 180ms var(--us-ease);
}

.us-checkbox:checked,
input.us-checkbox:checked {
  background: var(--us-accent-bg);
}

.us-checkbox:checked::after,
input.us-checkbox:checked::after {
  opacity: 1;
}

.us-collapse {
  display: grid;
  grid-template-rows: 1fr;
  opacity: 1;
  transition: grid-template-rows 260ms var(--us-ease), opacity 200ms var(--us-ease);
}

.us-collapse[data-collapsed="true"] {
  grid-template-rows: 0fr;
  opacity: 0;
  pointer-events: none;
}

.us-collapse-inner {
  overflow: hidden;
  min-height: 0;
}
`.trim();
}

function simpleCssVarsBlock(
  tokens: SimpleCssThemeTokens,
  colorScheme: "light" | "dark" | "light dark",
  indent = "  "
): string {
  return [
    `${indent}--bg: ${tokens.bg};`,
    `${indent}--accent-bg: ${tokens.accentBg};`,
    `${indent}--text: ${tokens.text};`,
    `${indent}--text-light: ${tokens.textLight};`,
    `${indent}--border: ${tokens.border};`,
    `${indent}--accent: ${tokens.accent};`,
    `${indent}--accent-hover: ${tokens.accentHover};`,
    `${indent}--accent-text: ${tokens.accentText};`,
    `${indent}--code: ${tokens.code};`,
    `${indent}--preformatted: ${tokens.preformatted};`,
    `${indent}--marked: ${tokens.marked};`,
    `${indent}--disabled: ${tokens.disabled};`,
    `${indent}color-scheme: ${colorScheme};`,
  ].join("\n");
}

/**
 * Emit Simple.css theme custom properties ONLY (light/dark/data-theme-mode),
 * with zero layout, typography, or component overrides.
 */
export function getSimpleCssThemeVarsCss(): string {
  return [
    "/* Generated by tools/sync-settings-tokens.mjs from @userscripts/shared. Do not edit by hand. */",
    ":root {",
    simpleCssVarsBlock(SIMPLE_CSS_LIGHT_TOKENS, "light dark"),
    "}",
    "",
    "@media (prefers-color-scheme: dark) {",
    '  :root:not([data-theme-mode="light"]) {',
    simpleCssVarsBlock(SIMPLE_CSS_DARK_TOKENS, "dark", "    "),
    "  }",
    "}",
    "",
    ':root[data-theme-mode="light"] {',
    simpleCssVarsBlock(SIMPLE_CSS_LIGHT_TOKENS, "light"),
    "}",
    "",
    ':root[data-theme-mode="dark"] {',
    simpleCssVarsBlock(SIMPLE_CSS_DARK_TOKENS, "dark"),
    "}",
  ].join("\n");
}
