import { markUiRoot } from "@userscripts/shared";
import type { PtrMessageKey } from "../../platform/i18n";
import { MESSAGES_EN } from "../../platform/i18n";
import { applyPtrTheme, getSharedPanelCss } from "../theme";
import type { BasicUiState, PresentationPreset } from "./logic";
import { BASIC_TARGET_LANGS, PRESENTATION_PRESETS } from "./logic";

const BASIC_HOST_ID = "ptr-basic-ui";

export interface BasicViewHandlers {
  onFontChange?: (font: string) => void;
  onOpenSettings?: () => void;
  onPresentationChange?: (preset: PresentationPreset) => void;
  onTargetLangChange?: (lang: string) => void;
  onToggleInspect?: () => void;
  onToggleStudio: () => void;
  onToggleTranslate?: () => void;
  onToggleVolunteer?: () => void;
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

.ptr-basic-shell {
  width: min(320px, calc(100vw - 24px));
  padding: 10px 12px;
  box-shadow: var(--us-shadow);
  display: grid;
  gap: 8px;
}

.ptr-basic-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.ptr-basic-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.ptr-basic-field {
  display: grid;
  gap: 3px;
}

.ptr-basic-label {
  font-size: 11px;
  color: var(--us-muted);
}

.ptr-studio-drawer[hidden] {
  display: none;
}

.ptr-studio-drawer {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 6px;
  background: var(--us-surface);
  border-radius: var(--us-radius-md);
  padding: 8px;
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

  const panel = doc.createElement("section");
  panel.className = "ptr-panel ptr-basic-shell";

  const topRow = doc.createElement("div");
  topRow.className = "ptr-basic-row";

  const translateBtn = doc.createElement("button");
  translateBtn.type = "button";
  translateBtn.className = "ptr-btn ptr-btn-primary";
  translateBtn.setAttribute("data-basic-action", "translate");
  translateBtn.textContent = t("translatePage");
  translateBtn.addEventListener("click", () => {
    handlers.onToggleTranslate?.();
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

  topRow.append(translateBtn, studioBtn);

  const grid = doc.createElement("div");
  grid.className = "ptr-basic-grid";

  const langWrap = doc.createElement("label");
  langWrap.className = "ptr-basic-field";
  const langLabel = doc.createElement("span");
  langLabel.className = "ptr-basic-label";
  langLabel.textContent = "Target";
  const langSelect = doc.createElement("select");
  langSelect.className = "ptr-input";
  langSelect.setAttribute("data-basic-field", "targetLang");
  for (const code of BASIC_TARGET_LANGS) {
    const opt = doc.createElement("option");
    opt.value = code;
    opt.textContent = code;
    langSelect.append(opt);
  }
  langSelect.addEventListener("change", () => {
    handlers.onTargetLangChange?.(langSelect.value);
  });
  langWrap.append(langLabel, langSelect);

  const presetWrap = doc.createElement("label");
  presetWrap.className = "ptr-basic-field";
  const presetLabel = doc.createElement("span");
  presetLabel.className = "ptr-basic-label";
  presetLabel.textContent = "Style";
  const presetSelect = doc.createElement("select");
  presetSelect.className = "ptr-input";
  presetSelect.setAttribute("data-basic-field", "presentation");
  for (const preset of PRESENTATION_PRESETS) {
    const opt = doc.createElement("option");
    opt.value = preset;
    opt.textContent = preset;
    presetSelect.append(opt);
  }
  presetSelect.addEventListener("change", () => {
    handlers.onPresentationChange?.(presetSelect.value as PresentationPreset);
  });
  presetWrap.append(presetLabel, presetSelect);

  const fontWrap = doc.createElement("label");
  fontWrap.className = "ptr-basic-field";
  const fontLabel = doc.createElement("span");
  fontLabel.className = "ptr-basic-label";
  fontLabel.textContent = "Font";
  const fontInput = doc.createElement("input");
  fontInput.type = "text";
  fontInput.className = "ptr-input";
  fontInput.placeholder = "system-ui";
  fontInput.setAttribute("data-basic-field", "font");
  fontInput.addEventListener("change", () => {
    handlers.onFontChange?.(fontInput.value);
  });
  fontWrap.append(fontLabel, fontInput);

  grid.append(langWrap, presetWrap, fontWrap);

  const studioDrawer = doc.createElement("div");
  studioDrawer.className = "ptr-studio-drawer";
  studioDrawer.setAttribute("data-tier", "studio-controls");
  studioDrawer.hidden = true;

  const inspectBtn = doc.createElement("button");
  inspectBtn.type = "button";
  inspectBtn.className = "ptr-btn";
  inspectBtn.setAttribute("data-studio-action", "inspect");
  inspectBtn.textContent = t("hudTitle");
  inspectBtn.addEventListener("click", () => {
    handlers.onToggleInspect?.();
  });

  const volunteerBtn = doc.createElement("button");
  volunteerBtn.type = "button";
  volunteerBtn.className = "ptr-btn";
  volunteerBtn.setAttribute("data-studio-action", "volunteer");
  volunteerBtn.textContent = t("tierStudio");
  volunteerBtn.addEventListener("click", () => {
    handlers.onToggleVolunteer?.();
  });

  const settingsBtn = doc.createElement("button");
  settingsBtn.type = "button";
  settingsBtn.className = "ptr-btn";
  settingsBtn.setAttribute("data-studio-action", "settings");
  settingsBtn.textContent = t("openSettings");
  settingsBtn.addEventListener("click", () => {
    handlers.onOpenSettings?.();
  });

  studioDrawer.append(inspectBtn, volunteerBtn, settingsBtn);

  panel.append(topRow, grid, studioDrawer);
  shadow.append(styleEl, panel);
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
      if (
        !Array.from(langSelect.options).some(
          (opt) => opt.value === state.targetLang
        )
      ) {
        const extra = doc.createElement("option");
        extra.value = state.targetLang;
        extra.textContent = state.targetLang;
        langSelect.append(extra);
      }
      langSelect.value = state.targetLang;
      presetSelect.value = state.presentation;
      fontInput.value = state.customFont;

      const isStudio = state.uiTier === "studio";
      studioBtn.setAttribute("aria-pressed", isStudio ? "true" : "false");
      studioDrawer.hidden = !isStudio;
    },
    destroy(): void {
      host.remove();
    },
  };
}
