import { markUiRoot } from "@userscripts/shared";
import type { PtrMessageKey } from "../../platform/i18n";
import { MESSAGES_EN } from "../../platform/i18n";
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
  const existing = doc.querySelector(`#${BASIC_HOST_ID}`);
  if (existing) {
    existing.remove();
  }

  const host = doc.createElement("div");
  host.id = BASIC_HOST_ID;
  markUiRoot(host, "ptr");

  const shadow = host.attachShadow({ mode: "open" });
  const styleEl = doc.createElement("style");
  styleEl.textContent = getBasicCss();

  const pill = doc.createElement("section");
  pill.className = "ptr-panel ptr-basic-pill";

  const translateBtn = doc.createElement("button");
  translateBtn.type = "button";
  translateBtn.className = "ptr-btn ptr-btn-primary";
  translateBtn.setAttribute("data-basic-action", "translate");
  translateBtn.textContent = t("translatePage");
  translateBtn.addEventListener("click", () => {
    handlers.onToggleTranslate?.();
  });

  const settingsBtn = doc.createElement("button");
  settingsBtn.type = "button";
  settingsBtn.className = "ptr-btn";
  settingsBtn.setAttribute("data-basic-action", "settings");
  settingsBtn.textContent = t("basicOpenSettings");
  settingsBtn.addEventListener("click", () => {
    handlers.onOpenSettings?.();
  });

  const studioBtn = doc.createElement("button");
  studioBtn.type = "button";
  studioBtn.id = "ptr-basic-studio";
  studioBtn.className = "ptr-btn";
  studioBtn.textContent = t("studioMode");
  studioBtn.setAttribute("aria-pressed", "false");
  studioBtn.addEventListener("click", () => {
    handlers.onToggleStudio();
  });

  pill.append(translateBtn, settingsBtn, studioBtn);
  shadow.append(styleEl, pill);
  (doc.body ?? doc.documentElement).append(host);

  return {
    host,
    render(state: BasicUiState): void {
      applyPtrTheme(host, state.themeMode);
      translateBtn.textContent = state.translated
        ? t("restorePage")
        : t("translatePage");
      translateBtn.setAttribute(
        "aria-pressed",
        state.translated ? "true" : "false"
      );

      const isStudio = state.uiTier === "studio";
      studioBtn.setAttribute("aria-pressed", isStudio ? "true" : "false");
      host.hidden = isStudio;
    },
    destroy(): void {
      host.remove();
    },
  };
}
