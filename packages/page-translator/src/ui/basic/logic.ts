import type {
  PtrThemeMode,
  TranslatorConfig,
  UiTier,
} from "../../platform/config";

export type PresentationPreset = "default" | "clean" | "contrast";

export interface BasicUiState {
  customFont: string;
  presentation: PresentationPreset;
  targetLang: string;
  themeMode: PtrThemeMode;
  translated: boolean;
  uiTier: UiTier;
}

export const BASIC_TARGET_LANGS: readonly string[] = [
  "zh-TW",
  "zh-CN",
  "en",
  "ja",
  "ko",
];

export const PRESENTATION_PRESETS: readonly PresentationPreset[] = [
  "default",
  "clean",
  "contrast",
];

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

export function resolvePresentationPreset(
  customCss: string
): PresentationPreset {
  const trimmed = customCss.trim();
  if (trimmed.includes("ptr-preset:contrast")) {
    return "contrast";
  }
  if (trimmed.includes("ptr-preset:clean")) {
    return "clean";
  }
  return "default";
}

export function presetToCustomCss(preset: PresentationPreset): string {
  switch (preset) {
    case "clean":
      return "/* ptr-preset:clean */ [data-tr-dst]{font-weight:inherit;}";
    case "contrast":
      return "/* ptr-preset:contrast */ [data-tr-dst]{letter-spacing:0.01em;}";
    default:
      return "";
  }
}

export function computeBasicUiState(
  cfg: Pick<
    TranslatorConfig,
    "customCss" | "customFont" | "targetLang" | "themeMode" | "uiTier"
  >,
  translated: boolean
): BasicUiState {
  return {
    targetLang: cfg.targetLang,
    customFont: cfg.customFont,
    presentation: resolvePresentationPreset(cfg.customCss),
    themeMode: cfg.themeMode,
    uiTier: cfg.uiTier,
    translated,
  };
}
