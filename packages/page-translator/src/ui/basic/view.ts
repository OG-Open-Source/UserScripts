import "../lit-dom";

import { html } from "lit";
import type { PtrMessageKey } from "../../platform/i18n";
import { MESSAGES_EN } from "../../platform/i18n";
import { mountLitShadow } from "../lit-render";
import { applyPtrTheme, getSharedPanelCss } from "../theme";
import type { BasicUiState } from "./logic";

const BASIC_HOST_ID = "ptr-basic-ui";

export interface BasicViewHandlers {
  onOpenSettings?: () => void;
  onToggleStudio: () => void;
  onToggleTranslate?: () => void;
}

export interface BasicView {
  destroy: () => void;
  host: HTMLElement;
  render: (state: BasicUiState) => void;
}

function getBasicCss(): string {
  return `
${getSharedPanelCss()}

:host {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483645;
  display: block;
}

:host([hidden]) {
  display: none;
}

.ptr-basic-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  --rho: 0.5;
  border-radius: calc(var(--rho) * min(240px, 60px));
  corner-shape: superellipse(2);
  box-shadow: var(--us-shadow);
}
`.trim();
}

export function mountBasicView(
  doc: Document,
  handlers: BasicViewHandlers,
  t: (key: PtrMessageKey) => string = (key) => MESSAGES_EN[key]
): BasicView {
  const mounted = mountLitShadow({
    css: getBasicCss(),
    doc,
    hostId: BASIC_HOST_ID,
  });

  const renderState = (state: BasicUiState): void => {
    const isStudio = state.uiTier === "studio";
    applyPtrTheme(mounted.host, state.themeMode);
    mounted.host.hidden = isStudio;

    mounted.render(html`
      <section class="ptr-panel ptr-basic-pill">
        <button
          type="button"
          class="ptr-btn ptr-btn-primary"
          data-basic-action="translate"
          aria-pressed=${state.translated ? "true" : "false"}
          @click=${() => {
            handlers.onToggleTranslate?.();
          }}
        >${state.translated ? t("restorePage") : t("translatePage")}</button>
        <button
          type="button"
          class="ptr-btn"
          data-basic-action="settings"
          @click=${() => {
            handlers.onOpenSettings?.();
          }}
        >${t("basicOpenSettings")}</button>
        <button
          type="button"
          id="ptr-basic-studio"
          class="ptr-btn"
          aria-pressed=${isStudio ? "true" : "false"}
          @click=${() => {
            handlers.onToggleStudio();
          }}
        >${t("studioMode")}</button>
      </section>
    `);
  };

  renderState({
    themeMode: "system",
    translated: false,
    uiTier: "basic",
  });

  return {
    host: mounted.host,
    render: renderState,
    destroy: mounted.destroy,
  };
}
