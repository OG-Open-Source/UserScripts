import type { TranslatorConfig } from "../legacy/config";
import { extractVisibleText, normalizeChineseText } from "../text/normalize";
import type { OpenCCConverter } from "../text/opencc";
import { scheduleOpenCC } from "../text/opencc";
import type { PrimaryRoute } from "./router";
import { parseBcp47, routePrimary } from "./router";
import type { ProviderId, TranslationProvider } from "./types";

export type SegmentPipelineConfig = Pick<
  TranslatorConfig,
  | "debugSpacingMarks"
  | "openccMode"
  | "punctNorm"
  | "spacingMode"
  | "targetLang"
> & {
  provider?: ProviderId;
};

type MaybePromise<T> = Promise<T> | T;
type TextHook = (html: string, targetLang: string) => MaybePromise<string>;
type DictionaryHookResult =
  | string
  | { hit: true; html: string }
  | { hit: false }
  | null
  | undefined;
type DictionaryHook = (
  html: string,
  targetLang: string
) => MaybePromise<DictionaryHookResult>;

export interface SegmentPipelineHooks {
  createOpenCC?: (
    mode: Exclude<TranslatorConfig["openccMode"], "off">
  ) => MaybePromise<OpenCCConverter>;
  dict?: DictionaryHook;
  provider?: TextHook | TranslationProvider;
  render?: (html: string) => MaybePromise<void>;
}

export interface SegmentPipelineResult {
  html: string;
  route: PrimaryRoute;
}

function isTranslationProvider(
  provider: TextHook | TranslationProvider
): provider is TranslationProvider {
  return (
    typeof provider === "object" &&
    typeof provider.translateBatch === "function"
  );
}

async function applyDictionary(
  sourceHtml: string,
  targetLang: string,
  dict: DictionaryHook | undefined
): Promise<{ html: string; hit: boolean }> {
  if (!dict) {
    return { html: sourceHtml, hit: false };
  }
  const result = await dict(sourceHtml, targetLang);
  if (typeof result === "string") {
    return { html: result, hit: false };
  }
  if (result?.hit === true) {
    const { html } = result;
    return { html, hit: true };
  }
  return { html: sourceHtml, hit: false };
}

function isHumanOnly(
  configuredProvider: ProviderId | undefined,
  provider: TextHook | TranslationProvider | undefined
): boolean {
  if (configuredProvider === "human-only") {
    return true;
  }
  return Boolean(
    provider && isTranslationProvider(provider) && provider.id === "human-only"
  );
}

async function applyProvider(
  html: string,
  targetLang: string,
  provider: TextHook | TranslationProvider | undefined
): Promise<string> {
  if (typeof provider === "function") {
    return provider(html, targetLang);
  }
  if (provider) {
    const translations = await provider.translateBatch([html], { targetLang });
    return translations[0] ?? html;
  }
  return html;
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
    const { html: dictionaryHtml, hit: dictionaryHit } = await applyDictionary(
      sourceHtml,
      cfg.targetLang,
      hooks.dict
    );
    html = dictionaryHtml;
    const humanOnly = isHumanOnly(cfg.provider, hooks.provider);
    if (humanOnly && !dictionaryHit) {
      return { html: sourceHtml, route };
    }
    if (!(dictionaryHit || humanOnly)) {
      html = await applyProvider(html, cfg.targetLang, hooks.provider);
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
