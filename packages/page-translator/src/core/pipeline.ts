import type { TranslatorConfig } from "../legacy/config";
import { extractVisibleText, normalizeChineseText } from "../text/normalize";
import type { OpenCCConverter } from "../text/opencc";
import { scheduleOpenCC } from "../text/opencc";
import type { PrimaryRoute } from "./router";
import { parseBcp47, routePrimary } from "./router";

export type SegmentPipelineConfig = Pick<
  TranslatorConfig,
  | "debugSpacingMarks"
  | "openccMode"
  | "punctNorm"
  | "spacingMode"
  | "targetLang"
>;

type MaybePromise<T> = Promise<T> | T;
type TextHook = (html: string, targetLang: string) => MaybePromise<string>;

export interface SegmentPipelineHooks {
  createOpenCC?: (
    mode: Exclude<TranslatorConfig["openccMode"], "off">
  ) => MaybePromise<OpenCCConverter>;
  dict?: TextHook;
  provider?: TextHook;
  render?: (html: string) => MaybePromise<void>;
}

export interface SegmentPipelineResult {
  html: string;
  route: PrimaryRoute;
}

export async function runSegmentPipeline(
  sourceHtml: string,
  cfg: SegmentPipelineConfig,
  hooks: SegmentPipelineHooks = {}
): Promise<SegmentPipelineResult> {
  const route = routePrimary(extractVisibleText(sourceHtml), cfg.targetLang);
  if (route === "skip") {
    return { html: sourceHtml, route };
  }

  let html = sourceHtml;
  if (route === "translate") {
    if (hooks.dict) {
      html = await hooks.dict(html, cfg.targetLang);
    }
    if (hooks.provider) {
      html = await hooks.provider(html, cfg.targetLang);
    }
    if (parseBcp47(cfg.targetLang).lang !== "zh") {
      await hooks.render?.(html);
      return { html, route };
    }
  }

  html = normalizeChineseText(html, {
    debugSpacingMarks: cfg.debugSpacingMarks,
    punctNorm: cfg.punctNorm,
    spacingMode: cfg.spacingMode,
  });

  const opencc = scheduleOpenCC(cfg);
  if (opencc.enabled) {
    if (!hooks.createOpenCC) {
      throw new Error(
        `OpenCC mode "${opencc.mode}" requires hooks.createOpenCC`
      );
    }
    const converter = await hooks.createOpenCC(opencc.mode);
    html = converter.convert(html);
  }

  await hooks.render?.(html);
  return { html, route };
}
