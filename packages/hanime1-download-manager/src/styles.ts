/**
 * Injected stylesheet.
 *
 * Style priority:
 * 1. Site-native classes for watch page takeover & quality menu
 *    (.more-horiz-panel / .more-horiz-item, .video-show-action-btn).
 * 2. Borderless NovaKit (Oklab/Oklch) tokens for non-native UI: listing card
 *    download chips, batch checkboxes, and the Curved-Outside slim batch dock.
 */
import type {
  NativeTheme,
  ThemeColors,
  ThemeMode,
  ThemeTokens,
} from "@userscripts/shared";
import {
  cssColorToHex,
  getUiTokensCss,
  probeHostColors,
  resolveThemeTokens,
} from "@userscripts/shared";

/** CSS class names reused from the site's own markup. */
export const NATIVE_MENU_CLASS = "more-horiz-panel dropdown-menu";
export const NATIVE_ITEM_CLASS = "more-horiz-item";

export function resolveH1dlHostColors(
  theme: NativeTheme,
  doc: Document | undefined = typeof document === "undefined"
    ? undefined
    : document
): ThemeColors {
  const probedDoc = doc ? probeHostColors(doc) : null;
  if (probedDoc) {
    return probedDoc;
  }
  const bg = cssColorToHex(theme.panelBg) ?? "#18181C";
  const fg = cssColorToHex(theme.panelColor) ?? "#F4F4F5";
  return { bg, fg };
}

export function buildStylesheetText(
  theme: NativeTheme,
  mode: ThemeMode = "host",
  hostTokens?: ThemeTokens | null
): string {
  const effectiveTokens =
    hostTokens ??
    resolveThemeTokens(
      mode,
      mode === "host" ? resolveH1dlHostColors(theme) : null
    );
  const inlineVars = effectiveTokens
    ? `:root[data-h1dl-theme="${mode}"] {
  --us-bg: ${effectiveTokens.bg};
  --us-surface: ${effectiveTokens.surface};
  --us-surface-2: ${effectiveTokens.surface2};
  --us-surface-3: ${effectiveTokens.surface3};
  --us-fg: ${effectiveTokens.fg};
  --us-muted: ${effectiveTokens.muted};
  --us-accent-bg: ${effectiveTokens.accentBg};
  --us-accent-fg: ${effectiveTokens.accentFg};
}`
    : "";

  return `${getUiTokensCss(":root", effectiveTokens ?? undefined)}
:root {
  --h1dl-panel-bg: ${theme.panelBg};
  --h1dl-panel-color: ${theme.panelColor};
  --h1dl-item-hover: ${theme.itemHover};
  --h1dl-action-bg: ${theme.actionBg};
}
${inlineVars}

.h1dl-list-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: none;
  border-radius: var(--us-radius-sm, 6px);
  background: var(--us-surface-2);
  color: var(--us-fg);
  font-size: 11.5px;
  line-height: 1.4;
  cursor: pointer;
  user-select: none;
  opacity: 0;
  white-space: nowrap;
  text-decoration: none;
  box-shadow: var(--us-shadow-sm);
  transition: opacity 180ms var(--us-ease), background-color 180ms var(--us-ease), color 180ms var(--us-ease), box-shadow 200ms var(--us-ease);
}
.h1dl-list-btn .material-icons { font-size: 15px; margin-top: -1px; }
.h1dl-list-btn:hover { background: var(--us-accent-bg); color: var(--us-accent-fg); }
.h1dl-list-btn:active { box-shadow: 0 0 0 3px oklch(from var(--us-accent-bg) l c h / 0.28); }
.h1dl-batch-on .h1dl-list-btn,
.playlist-hover-wrap:hover .h1dl-list-btn,
.video-item-container:hover .h1dl-list-btn { opacity: 1; }
.h1dl-list-btn.h1dl-pinned { opacity: 1 !important; }
.video-item-container .subtitle { position: relative; }
.video-item-container .subtitle .h1dl-list-btn { position: absolute; right: 0; top: 50%; transform: translateY(-50%); }
.h1dl-card { position: relative; }

.h1dl-check {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--us-surface-2);
  color: var(--us-fg);
  border: none;
  border-radius: var(--us-radius-sm, 6px);
  box-shadow: var(--us-shadow-sm);
  cursor: pointer;
  user-select: none;
  font-size: 14px;
  line-height: 1;
  opacity: 0;
  z-index: 5;
  transition: opacity 180ms var(--us-ease), background-color 180ms var(--us-ease), color 180ms var(--us-ease), box-shadow 200ms var(--us-ease);
}
.h1dl-check .material-icons { font-size: 14px; }
.h1dl-batch-on .h1dl-check, .h1dl-card:hover .h1dl-check { opacity: 1; }
.h1dl-check.checked, .h1dl-check.checked .material-icons {
  background: var(--us-accent-bg);
  color: var(--us-accent-fg);
}
.h1dl-check.completed { opacity: 0.35 !important; cursor: default; pointer-events: none; }
.h1dl-spin { animation: 1.2s linear infinite h1dl-rotate; }

@keyframes h1dl-rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;
}

export function getBatchDockCss(hostTokens?: ThemeTokens | null): string {
  return `${getUiTokensCss(":host", hostTokens ?? undefined)}
:host {
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2147483646;
  pointer-events: none;
}
.co-dock {
  position: relative;
  display: flex;
  align-items: center;
  pointer-events: auto;
  filter: drop-shadow(-4px 6px 14px oklch(5% 0.01 264 / 0.35));
}
.co-rail {
  position: relative;
  width: 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 5px;
  background: var(--us-bg);
  color: var(--us-fg);
  border-radius: var(--us-radius-lg) 0 0 var(--us-radius-lg);
}
.co-fillet {
  position: absolute;
  right: 0;
  width: 12px;
  height: 12px;
  pointer-events: none;
  display: block;
}
.co-fillet-top { top: -12px; }
.co-fillet-bot { bottom: -12px; transform: scaleY(-1); }
.co-count {
  font-family: var(--us-mono);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  padding: 3px 6px;
  border-radius: var(--us-radius-sm);
  background: var(--us-surface-2);
}
.co-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 32px;
  padding: 2px;
  border-radius: var(--us-radius-md);
  background: var(--us-surface);
}
.co-group-btn {
  width: 100%;
  height: 28px;
  border: none;
  border-radius: var(--us-radius-sm);
  background: transparent;
  color: var(--us-fg);
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 0;
  transition: background-color 180ms var(--us-ease), color 180ms var(--us-ease), box-shadow 200ms var(--us-ease);
}
.co-group-btn:hover:not(:disabled) { background: var(--us-surface-2); }
.co-group-btn:active:not(:disabled) {
  box-shadow: inset 0 0 0 2px oklch(from var(--us-accent-bg) l c h / 0.45);
}
.co-group-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.co-group-btn[aria-expanded="true"],
.co-group-btn.active,
.co-group-btn.primary {
  background: var(--us-accent-bg);
  color: var(--us-accent-fg);
}
.co-group-btn.primary:hover:not(:disabled) { background: var(--us-accent-hover); }

.co-mini-ticks {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 28px;
  max-height: 112px;
  overflow-y: auto;
  scrollbar-width: none;
  padding: 4px;
  border-radius: var(--us-radius-sm);
  background: var(--us-surface);
}
.co-mini-ticks::-webkit-scrollbar { display: none; }
.dl-track {
  position: relative;
  height: 3px;
  width: 100%;
  border-radius: 2px;
  background: var(--us-surface-3);
  overflow: hidden;
  flex: none;
}
.dl-fill,
.h1dl-batch-fill {
  position: absolute;
  inset: 0;
  width: 100%;
  background: var(--nk-blue);
  transform-origin: left center;
  transform: scaleX(0);
  will-change: transform;
  transition: transform 240ms var(--us-ease);
}
.h1dl-batch-tick.done .h1dl-batch-fill,
.dl-fill.done {
  background: var(--nk-green);
  transform: scaleX(1);
}
.h1dl-batch-tick.error .h1dl-batch-fill,
.dl-fill.error {
  background: var(--nk-red);
  transform: scaleX(1);
}

.co-flyout {
  position: absolute;
  right: calc(100% + 10px);
  top: 50%;
  transform: translateY(-50%) translateX(0);
  opacity: 1;
  width: 232px;
  background: var(--us-bg);
  color: var(--us-fg);
  border-radius: var(--us-radius-lg);
  box-shadow: var(--us-shadow);
  overflow: hidden;
  z-index: 20;
  transition: opacity 220ms var(--us-ease), transform 240ms var(--us-ease);
}
.co-flyout[data-open="false"] {
  opacity: 0;
  transform: translateY(-50%) translateX(12px);
  pointer-events: none;
}
.co-body-head {
  padding: 8px 11px;
  background: var(--us-surface);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  font-weight: 600;
}
.co-body-list {
  padding: 8px;
  display: grid;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
}
.dl-item {
  padding: 7px 9px;
  background: var(--us-surface);
  border-radius: var(--us-radius-md);
  display: grid;
  gap: 5px;
}
.dl-item-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
}
.dl-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prefs-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
`;
}

/** Build the <style> element and append it to <head>. */
export function injectStyles(
  theme: NativeTheme,
  mode: ThemeMode = "host",
  hostTokens?: ThemeTokens | null
): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = buildStylesheetText(theme, mode, hostTokens);
  document.documentElement.setAttribute("data-h1dl-theme", mode);
  document.head.appendChild(style);
  return style;
}
