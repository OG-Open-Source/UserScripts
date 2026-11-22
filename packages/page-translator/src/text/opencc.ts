import type { OpenCCMode, TranslatorConfig } from "../legacy/config";

export interface OpenCCConverter {
  convert: (text: string) => string;
}

export type OpenCCSchedule =
  | { enabled: false }
  | { enabled: true; mode: Exclude<OpenCCMode, "off"> };

export function scheduleOpenCC(
  cfg: Pick<TranslatorConfig, "openccMode">
): OpenCCSchedule {
  if (cfg.openccMode === "off") {
    return { enabled: false };
  }
  return { enabled: true, mode: cfg.openccMode };
}
