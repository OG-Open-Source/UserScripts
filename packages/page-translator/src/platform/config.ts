import { gmGet, gmSet } from "@userscripts/shared";
import type { ProviderId } from "../core/types";

export type PtrThemeMode = "dark" | "light" | "system";
export type UiTier = "basic" | "studio";
export type OpenCCMode = "off" | "s2twp" | "tw2sp" | "s2t" | "t2s";
export type SpacingMode = "js" | "w3c" | "both" | "off";
export type PunctNormMode = "off" | "zh-norm";

export interface TranslatorConfig {
  autoSpacing: boolean;
  autoTranslate: boolean;
  customCss: string;
  customFont: string;
  debugSpacingMarks: boolean;
  defaultInspect: boolean;
  defaultVolunteer: boolean;
  openccMode: OpenCCMode;
  provider: ProviderId;
  punctNorm: PunctNormMode;
  siteDeltas: Record<string, string>;
  spacingMode: SpacingMode;
  targetLang: string;
  themeMode: PtrThemeMode;
  translatePaApiKey: string;
  uiTier: UiTier;
  volunteerBlockClicks: boolean;
}

export interface ConfigStorage {
  get: <T>(key: string, defaultValue: T) => T;
  set: (key: string, value: unknown) => void;
}

export interface ConfigOptions {
  storage?: ConfigStorage;
}

export type ConfigPatch = Partial<
  Omit<TranslatorConfig, "provider" | "themeMode" | "uiTier">
> & {
  debugInspect?: unknown;
  provider?: unknown;
  spaceSkippedCjk?: unknown;
  themeMode?: unknown;
  uiTier?: unknown;
  volunteerMode?: unknown;
};

export const CONFIG_KEY = "ptr:config";

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
  themeMode: "system",
  uiTier: "basic",
  siteDeltas: {},
  autoTranslate: false,
  debugSpacingMarks: false,
  defaultInspect: false,
  defaultVolunteer: false,
  volunteerBlockClicks: false,
};

const THEME_MODES = new Set<PtrThemeMode>(["dark", "light", "system"]);
const UI_TIERS = new Set<UiTier>(["basic", "studio"]);
const PROVIDERS = new Set<ProviderId>([
  "translate-pa",
  "inspect",
  "human-only",
]);
const SPACING_MODES = new Set<SpacingMode>(["js", "w3c", "both", "off"]);
const PUNCT_MODES = new Set<PunctNormMode>(["off", "zh-norm"]);
const OPENCC_MODES = new Set<OpenCCMode>([
  "off",
  "s2twp",
  "tw2sp",
  "s2t",
  "t2s",
]);

export const defaultConfigStorage: ConfigStorage = {
  get<T>(key: string, defaultValue: T): T {
    try {
      return gmGet<T>(key, defaultValue);
    } catch {
      return defaultValue;
    }
  },
  set(key: string, value: unknown): void {
    try {
      gmSet(key, value);
    } catch {
      // Config remains available in memory when GM storage is unavailable.
    }
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function enumValue<T extends string>(
  value: unknown,
  values: ReadonlySet<T>,
  fallback: T
): T {
  return typeof value === "string" && values.has(value as T)
    ? (value as T)
    : fallback;
}

function cloneDefault(): TranslatorConfig {
  return { ...DEFAULT_CONFIG, siteDeltas: {} };
}

function resolveStorage(
  options?: ConfigOptions | ConfigStorage
): ConfigStorage {
  if (options && "get" in options && typeof options.get === "function") {
    return options;
  }
  return (
    (options as ConfigOptions | undefined)?.storage ?? defaultConfigStorage
  );
}

function safeGet(
  storage: ConfigStorage,
  key: string,
  defaultValue: unknown
): unknown {
  try {
    return storage.get(key, defaultValue);
  } catch {
    return defaultValue;
  }
}

function safeSet(storage: ConfigStorage, key: string, value: unknown): void {
  try {
    storage.set(key, value);
  } catch {
    // Saving is best-effort in non-userscript and privacy-restricted contexts.
  }
}

function migrateLegacyActivationPatch(
  patch: Record<string, unknown>
): Record<string, unknown> {
  const migrated = { ...patch };
  if (!hasOwn(patch, "defaultInspect") && hasOwn(patch, "debugInspect")) {
    migrated.defaultInspect = patch.debugInspect;
  }
  if (!hasOwn(patch, "defaultVolunteer") && hasOwn(patch, "volunteerMode")) {
    migrated.defaultVolunteer = patch.volunteerMode;
  }
  return migrated;
}

function normalizeConfig(
  input: unknown,
  fallback: TranslatorConfig = DEFAULT_CONFIG
): TranslatorConfig {
  const source = isRecord(input) ? migrateLegacyActivationPatch(input) : {};
  const spacingMode = enumValue(
    source.spacingMode,
    SPACING_MODES,
    source.autoSpacing === false ? "off" : fallback.spacingMode
  );
  const siteDeltas = isRecord(source.siteDeltas)
    ? Object.fromEntries(
        Object.entries(source.siteDeltas).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      )
    : { ...fallback.siteDeltas };

  return {
    targetLang: stringValue(source.targetLang, fallback.targetLang),
    provider: enumValue(source.provider, PROVIDERS, fallback.provider),
    translatePaApiKey: stringValue(
      source.translatePaApiKey,
      fallback.translatePaApiKey
    ),
    customCss: stringValue(source.customCss, fallback.customCss),
    customFont: stringValue(source.customFont, fallback.customFont),
    autoSpacing: spacingMode !== "off",
    spacingMode,
    punctNorm: enumValue(source.punctNorm, PUNCT_MODES, fallback.punctNorm),
    openccMode: enumValue(source.openccMode, OPENCC_MODES, fallback.openccMode),
    themeMode: enumValue(source.themeMode, THEME_MODES, "system"),
    uiTier: enumValue(source.uiTier, UI_TIERS, "basic"),
    siteDeltas,
    autoTranslate: booleanValue(source.autoTranslate, fallback.autoTranslate),
    debugSpacingMarks: booleanValue(
      source.debugSpacingMarks,
      fallback.debugSpacingMarks
    ),
    defaultInspect: booleanValue(
      source.defaultInspect,
      fallback.defaultInspect
    ),
    defaultVolunteer: booleanValue(
      source.defaultVolunteer,
      fallback.defaultVolunteer
    ),
    volunteerBlockClicks: booleanValue(
      source.volunteerBlockClicks,
      fallback.volunteerBlockClicks
    ),
  };
}

export function resolveSpacingMode(
  cfg: Pick<TranslatorConfig, "autoSpacing" | "spacingMode">
): SpacingMode {
  return cfg.autoSpacing ? cfg.spacingMode : "off";
}

export function loadConfig(
  options?: ConfigOptions | ConfigStorage
): TranslatorConfig {
  const storage = resolveStorage(options);
  const stored = safeGet(storage, CONFIG_KEY, null);
  return isRecord(stored) ? normalizeConfig(stored) : cloneDefault();
}

export function saveConfig(
  patch: ConfigPatch,
  options?: ConfigOptions | ConfigStorage
): TranslatorConfig {
  const storage = resolveStorage(options);
  const current = loadConfig({ storage });
  const rawPatch = isRecord(patch) ? migrateLegacyActivationPatch(patch) : {};
  const next = normalizeConfig({ ...current, ...rawPatch }, current);
  safeSet(storage, CONFIG_KEY, next);
  return next;
}
