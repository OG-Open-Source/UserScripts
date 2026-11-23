import type {
  PtrThemeMode,
  TranslatorConfig,
  UiTier,
} from "../../platform/config";

export interface BasicUiState {
  themeMode: PtrThemeMode;
  translated: boolean;
  uiTier: UiTier;
}

export function toggleUiTier(current: UiTier): UiTier {
  return current === "studio" ? "basic" : "studio";
}

export function diffStudioTier(
  previous: UiTier | null,
  next: UiTier
): "mount" | "unmount" | "none" {
  if (next === "studio" && previous !== "studio") {
    return "mount";
  }
  if (next === "basic" && previous === "studio") {
    return "unmount";
  }
  return "none";
}

export function computeBasicUiState(
  cfg: Pick<TranslatorConfig, "themeMode" | "uiTier">,
  translated: boolean
): BasicUiState {
  return {
    themeMode: cfg.themeMode,
    translated,
    uiTier: cfg.uiTier,
  };
}
