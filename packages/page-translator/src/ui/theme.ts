import { applyThemeModeToElement, getUiTokensCss } from "@userscripts/shared";
import type { PtrThemeMode } from "../platform/config";

export function applyPtrTheme(host: HTMLElement, mode: PtrThemeMode): void {
  applyThemeModeToElement(host, mode);
}

/**
 * Panel-level CSS shared by Basic controls, Capture Preview HUD, and Volunteer Workbench.
 * Borderless NovaKit tokens come from @userscripts/shared with only dark/light/system modes.
 */
export function getSharedPanelCss(): string {
  return `
${getUiTokensCss(":host")}

.ptr-panel {
  background: var(--us-bg);
  color: var(--us-fg);
  border-radius: var(--us-radius-lg);
  font: var(--us-sans);
  contain: layout style paint;
  isolation: isolate;
}

.ptr-surface {
  background: var(--us-surface);
  border-radius: var(--us-radius-sm);
}

.ptr-muted {
  color: var(--us-muted);
}

.ptr-mono {
  font-family: var(--us-mono);
  font-variant-numeric: tabular-nums;
  font-size: 11.5px;
}

.ptr-btn,
button.ptr-btn {
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

.ptr-btn:hover:not(:disabled),
button.ptr-btn:hover:not(:disabled) {
  background: var(--_btn-hover-bg, var(--us-surface-3));
  color: var(--_btn-hover-fg, var(--_btn-fg, var(--us-fg)));
  box-shadow: var(--us-shadow-sm);
}

.ptr-btn:active:not(:disabled),
button.ptr-btn:active:not(:disabled) {
  background: var(--us-accent-bg);
  color: var(--us-accent-fg);
  box-shadow: 0 0 0 3px oklch(from var(--us-accent-bg) l c h / 0.28);
}

.ptr-btn:disabled,
button.ptr-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.ptr-btn.flash-done,
button.ptr-btn.flash-done {
  animation: us-pulse-ring 420ms var(--us-ease);
}

.ptr-btn-primary,
button.ptr-btn-primary,
.ptr-btn[aria-pressed="true"],
button.ptr-btn[aria-pressed="true"] {
  --_btn-bg: var(--us-accent-bg);
  --_btn-fg: var(--us-accent-fg);
  --_btn-hover-bg: var(--us-accent-hover);
  --_btn-hover-fg: var(--us-accent-fg);
  font-weight: 600;
}

.ptr-input,
input.ptr-input,
select.ptr-input,
textarea.ptr-input {
  box-sizing: border-box;
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

.ptr-input:focus,
input.ptr-input:focus,
select.ptr-input:focus,
textarea.ptr-input:focus {
  background: var(--us-surface-2);
  box-shadow: 0 0 0 2px oklch(from var(--us-focus) l c h / 0.35);
  outline: none;
}

textarea.ptr-input {
  font-family: var(--us-mono);
  font-size: 11.5px;
  resize: vertical;
}

.ptr-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 7px;
  border-radius: var(--us-radius-sm);
  background: var(--us-surface-2);
  color: var(--us-fg);
  font-size: 11px;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
}

.drag-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 12px;
  min-width: 0;
}

.drag-grip {
  width: 11px;
  height: 14px;
  color: var(--us-muted);
  flex: none;
  transition: color 180ms var(--us-ease);
}

.us-panel-head.dragging .drag-grip {
  color: var(--us-fg);
}

.us-kv {
  margin: 6px 0 0;
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 4px 8px;
  font-size: 11.5px;
  align-items: start;
}

.us-kv dt {
  color: var(--us-muted);
  font-size: 11px;
  padding-top: 2px;
}

.us-kv dd {
  margin: 0;
  min-width: 0;
  word-break: break-word;
}

.code-inline {
  display: block;
  padding: 4px 7px;
  background: var(--us-surface);
  border-radius: var(--us-radius-sm);
  font-family: var(--us-mono);
  font-size: 11px;
  word-break: break-word;
}

.us-stat-strip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}

.us-stat-cell {
  padding: 6px 8px;
  border-radius: var(--us-radius-md);
  background: var(--us-surface);
  display: grid;
  gap: 1px;
}

.us-stat-val {
  font-family: var(--us-mono);
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  font-weight: 700;
}

.us-stat-label {
  font-size: 10.5px;
  color: var(--us-muted);
}

.us-metric-table {
  display: grid;
  grid-template-columns: 1fr auto minmax(5.5ch, auto);
  align-items: baseline;
  font-size: 11.5px;
  border-radius: var(--us-radius-md);
  background: var(--us-surface);
  padding: 3px 0;
}

.us-metric-row {
  display: contents;
}

.us-metric-row > span {
  padding: 3px 0;
}

.m-label {
  padding-left: 9px;
  padding-right: 10px;
  color: var(--us-muted);
  white-space: nowrap;
}

.m-val {
  font-family: var(--us-mono);
  font-variant-numeric: tabular-nums;
  text-align: right;
  font-weight: 600;
  padding-left: 6px;
  padding-right: 6px;
}

.m-unit {
  font-family: var(--us-mono);
  color: var(--us-muted);
  text-align: left;
  padding-right: 9px;
  white-space: pre;
}
`.trim();
}
