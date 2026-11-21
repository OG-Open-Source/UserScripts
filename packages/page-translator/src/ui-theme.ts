import { getUiTokensCss } from "@userscripts/shared";

export function getSharedPanelCss(): string {
	return `
${getUiTokensCss(":host")}

.ptr-panel {
  background: var(--us-bg);
  color: var(--us-fg);
  border: 1px solid var(--us-line);
  border-radius: 6px;
  font: var(--us-sans);
  contain: layout style paint;
  isolation: isolate;
}

.ptr-surface {
  background: var(--us-surface);
  border: 1px solid var(--us-line);
  border-radius: 4px;
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

.ptr-btn:hover,
button.ptr-btn:hover {
  border-color: var(--us-line-strong);
}

.ptr-btn-primary,
button.ptr-btn-primary {
  background: var(--us-fg);
  color: var(--us-bg);
  border-color: var(--us-fg);
  font-weight: 500;
}

.ptr-input,
input.ptr-input,
select.ptr-input,
textarea.ptr-input {
  box-sizing: border-box;
  width: 100%;
  font: inherit;
  font-size: 12.5px;
  padding: 5px 8px;
  background: var(--us-bg);
  color: var(--us-fg);
  border: 1px solid var(--us-line);
  border-radius: 4px;
}

textarea.ptr-input {
  font-family: var(--us-mono);
  font-size: 11.5px;
}

.ptr-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  border: 1px solid var(--us-line);
  border-radius: 4px;
  background: var(--us-surface);
  font-size: 11px;
  line-height: 1.3;
}
`.trim();
}
