/**
 * Canonical Monochrome Hairline design tokens and base control primitives
 * shared across monorepo-owned Shadow DOM panels.
 */
export function getUiTokensCss(scopeSelector = ":host"): string {
	return `
${scopeSelector} {
  color-scheme: light dark;
  --us-bg: #ffffff;
  --us-surface: #f7f7f8;
  --us-fg: #141414;
  --us-muted: #666666;
  --us-line: #e4e4e4;
  --us-line-strong: #c8c8cc;
  --us-focus: #2563eb;
  --us-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --us-sans: 12.5px/1.45 system-ui, -apple-system, sans-serif;
  --us-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  --bg: var(--us-bg);
  --fg: var(--us-fg);
  --muted: var(--us-muted);
  --line: var(--us-line);
  --surface: var(--us-surface);
  --accent: var(--us-fg);
  --mono: var(--us-mono);
  font: var(--us-sans);
  color: var(--us-fg);
}

@media (prefers-color-scheme: dark) {
  ${scopeSelector} {
    --us-bg: #141414;
    --us-surface: #1c1c1e;
    --us-fg: #ededed;
    --us-muted: #8e8e93;
    --us-line: #2a2a2c;
    --us-line-strong: #3e3e42;
    --us-focus: #60a5fa;
    --us-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    --bg: var(--us-bg);
    --fg: var(--us-fg);
    --muted: var(--us-muted);
    --line: var(--us-line);
    --surface: var(--us-surface);
    --accent: var(--us-fg);
  }
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

.us-panel {
  background: var(--us-bg);
  color: var(--us-fg);
  border: 1px solid var(--us-line);
  border-radius: 6px;
  box-shadow: var(--us-shadow);
  font: var(--us-sans);
  contain: layout style paint;
  isolation: isolate;
}

.us-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--us-line);
}

.us-panel-title {
  font-weight: 600;
  font-size: 12px;
}

.us-panel-sec {
  padding: 8px 10px;
  border-bottom: 1px solid var(--us-line);
}

.us-panel-sec:last-child {
  border-bottom: none;
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
  font: inherit;
  font-size: 12px;
  line-height: 1.2;
  padding: 5px 10px;
  background: var(--us-surface);
  color: var(--us-fg);
  border: 1px solid var(--us-line);
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.us-btn:hover,
button.us-btn:hover {
  border-color: var(--us-line-strong);
}

.us-btn:focus-visible,
button.us-btn:focus-visible,
.us-input:focus-visible {
  outline: 2px solid var(--us-focus);
  outline-offset: 1px;
}

.us-btn-sm,
button.us-btn-sm {
  padding: 3px 8px;
  font-size: 11.5px;
}

.us-btn-primary,
button.us-btn-primary,
.us-btn[aria-pressed="true"],
button.us-btn[aria-pressed="true"] {
  background: var(--us-fg);
  color: var(--us-bg);
  border-color: var(--us-fg);
  font-weight: 500;
}

.us-btn-primary:hover,
button.us-btn-primary:hover {
  opacity: 0.88;
  border-color: var(--us-fg);
}

.us-input,
input.us-input {
  width: 100%;
  font: inherit;
  font-size: 12.5px;
  padding: 5px 8px;
  background: var(--us-bg);
  color: var(--us-fg);
  border: 1px solid var(--us-line);
  border-radius: 4px;
}

.us-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  border: 1px solid var(--us-line);
  border-radius: 4px;
  background: var(--us-surface);
  font-size: 11px;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
}

.us-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
  display: inline-block;
}

.us-chevron {
  width: 12px;
  height: 12px;
  flex: none;
  color: var(--us-muted);
  transition: transform 150ms cubic-bezier(0.2, 0.8, 0.2, 1), color 120ms ease;
}

[aria-expanded="true"] .us-chevron {
  transform: rotate(180deg);
  color: var(--us-fg);
}
`.trim();
}
