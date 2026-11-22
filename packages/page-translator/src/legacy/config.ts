import type { ThemeMode } from "@userscripts/shared";
import { gmGet, gmSet } from "@userscripts/shared";

export type OpenCCMode = "off" | "s2twp" | "tw2sp" | "s2t" | "t2s";
export type ProviderId = "translate-pa" | "inspect";
export type SpacingMode = "js" | "w3c" | "both" | "off";
export type PunctNormMode = "off" | "zh-norm";

export interface TranslatorConfig {
  autoSpacing: boolean;
  autoTranslate: boolean;
  customCss: string;
  customFont: string;
  debugInspect: boolean;
  debugSpacingMarks: boolean;
  openccMode: OpenCCMode;
  provider: ProviderId;
  punctNorm: PunctNormMode;
  siteDeltas: Record<string, string>;
  spaceSkippedCjk: boolean;
  spacingMode: SpacingMode;
  targetLang: string;
  themeMode: ThemeMode;
  translatePaApiKey: string;
  volunteerBlockClicks: boolean;
  volunteerMode: boolean;
}

const CONFIG_KEY = "ptr:config";

export const DEFAULT_CONFIG: TranslatorConfig = {
  targetLang: "zh-TW",
  provider: "translate-pa",
  translatePaApiKey: "AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520",
  customCss: "",
  customFont: "",
  autoSpacing: true,
  spacingMode: "both",
  punctNorm: "zh-norm",
  openccMode: "off",
  spaceSkippedCjk: false,
  themeMode: "system",
  siteDeltas: {},
  autoTranslate: false,
  debugInspect: false,
  debugSpacingMarks: false,
  volunteerMode: false,
  volunteerBlockClicks: false,
};

export function resolveSpacingMode(
  cfg: Pick<TranslatorConfig, "autoSpacing" | "spacingMode">
): SpacingMode {
  if (cfg.spacingMode) {
    return cfg.spacingMode;
  }
  return cfg.autoSpacing ? "both" : "off";
}

export function loadConfig(): TranslatorConfig {
  const stored = gmGet<Partial<TranslatorConfig> | null>(CONFIG_KEY, null);
  if (!stored || typeof stored !== "object") {
    return {
      ...DEFAULT_CONFIG,
      siteDeltas: { ...DEFAULT_CONFIG.siteDeltas },
    };
  }
  const spacingMode: SpacingMode =
    stored.spacingMode ??
    (stored.autoSpacing === false ? "off" : DEFAULT_CONFIG.spacingMode);

  return {
    ...DEFAULT_CONFIG,
    ...stored,
    spacingMode,
    autoSpacing: spacingMode !== "off",
    siteDeltas: {
      ...DEFAULT_CONFIG.siteDeltas,
      ...(stored.siteDeltas && typeof stored.siteDeltas === "object"
        ? stored.siteDeltas
        : {}),
    },
  };
}

export function saveConfig(patch: Partial<TranslatorConfig>): TranslatorConfig {
  const current = loadConfig();
  const nextSpacingMode =
    patch.spacingMode ??
    (patch.autoSpacing === undefined
      ? current.spacingMode
      : patch.autoSpacing
        ? "both"
        : "off");
  const next: TranslatorConfig = {
    ...current,
    ...patch,
    spacingMode: nextSpacingMode,
    autoSpacing: nextSpacingMode !== "off",
    ...(patch.siteDeltas ? { siteDeltas: { ...patch.siteDeltas } } : {}),
  };
  gmSet(CONFIG_KEY, next);
  return next;
}
