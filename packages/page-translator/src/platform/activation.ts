import type { TranslatorConfig } from "./config";
import { loadConfig } from "./config";

export type ActivationMode = "inspect" | "volunteer";
export type ActivationConfig = Pick<
  TranslatorConfig,
  "defaultInspect" | "defaultVolunteer"
>;
export type TabStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export const TAB_ACTIVATION_KEYS: Record<ActivationMode, string> = {
  inspect: "ptr:tab-inspect",
  volunteer: "ptr:tab-volunteer",
};

export interface ActivationOptions {
  config?: ActivationConfig;
  getConfig?: () => ActivationConfig;
  storage?: TabStorage | null;
}

export interface TabActivationManagerOptions {
  getConfig?: () => ActivationConfig;
  storage?: TabStorage | null;
}

function defaultStorage(): TabStorage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function readOverride(
  mode: ActivationMode,
  storage: TabStorage | null
): boolean | null {
  if (!storage) {
    return null;
  }
  try {
    const value = storage.getItem(TAB_ACTIVATION_KEYS[mode]);
    if (value === "1") {
      return true;
    }
    if (value === "0") {
      return false;
    }
    return null;
  } catch {
    return null;
  }
}

function configDefault(mode: ActivationMode, cfg: ActivationConfig): boolean {
  return mode === "inspect" ? cfg.defaultInspect : cfg.defaultVolunteer;
}

export function isActive(
  mode: ActivationMode,
  options: ActivationOptions = {}
): boolean {
  const storage =
    options.storage === undefined ? defaultStorage() : options.storage;
  const override = readOverride(mode, storage);
  if (override !== null) {
    return override;
  }
  const cfg = options.config ?? options.getConfig?.() ?? loadConfig();
  return configDefault(mode, cfg);
}

export function setTabActive(
  mode: ActivationMode,
  active: boolean,
  options: Pick<ActivationOptions, "storage"> = {}
): void {
  const storage =
    options.storage === undefined ? defaultStorage() : options.storage;
  try {
    storage?.setItem(TAB_ACTIVATION_KEYS[mode], active ? "1" : "0");
  } catch {
    // Session storage can be unavailable in sandboxed or privacy contexts.
  }
}

export function clearTabOverride(
  mode: ActivationMode,
  options: Pick<ActivationOptions, "storage"> = {}
): void {
  const storage =
    options.storage === undefined ? defaultStorage() : options.storage;
  try {
    storage?.removeItem(TAB_ACTIVATION_KEYS[mode]);
  } catch {
    // Session storage can be unavailable in sandboxed or privacy contexts.
  }
}

export function createTabActivationManager(
  options: TabActivationManagerOptions = {}
) {
  const getConfig = options.getConfig ?? loadConfig;
  const storage =
    options.storage === undefined ? defaultStorage() : options.storage;
  const initial = getConfig();
  const baseline: Record<ActivationMode, boolean> = {
    inspect: configDefault("inspect", initial),
    volunteer: configDefault("volunteer", initial),
  };

  return {
    isActive(mode: ActivationMode): boolean {
      return readOverride(mode, storage) ?? baseline[mode];
    },
    setActive(mode: ActivationMode, active: boolean): void {
      setTabActive(mode, active, { storage });
    },
    clearTabOverride(mode: ActivationMode): void {
      clearTabOverride(mode, { storage });
    },
    getBaseline(mode: ActivationMode): boolean {
      return baseline[mode];
    },
  };
}
