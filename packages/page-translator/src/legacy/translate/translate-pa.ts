import { gmRequest } from "@userscripts/shared";
import type {
  GroupedTranslateItem,
  TranslationProvider,
  TranslationRequestOptions,
} from "./provider";

const TRANSLATE_PA_ENDPOINT =
  "https://translate-pa.googleapis.com/v1/translateHtml";

export interface TranslatePaOptions {
  apiKey: string;
}

function escapeAttr(val: string): string {
  return val.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;");
}

const GROUPED_ITEM_RE =
  /<p\b[^>]*\bdata-ptr-s=["'](?<id>[^"']+)["'][^>]*>(?<inner>[\s\S]*?)<\/p>/giu;

export function parseGroupedResponseHtml(
  htmlList: readonly string[]
): Map<string, string> {
  const out = new Map<string, string>();
  for (const html of htmlList) {
    GROUPED_ITEM_RE.lastIndex = 0;
    let match = GROUPED_ITEM_RE.exec(html);
    while (match !== null) {
      const id = match.groups?.id;
      const inner = match.groups?.inner;
      if (id !== undefined && inner !== undefined) {
        out.set(id, inner);
      }
      match = GROUPED_ITEM_RE.exec(html);
    }
  }
  return out;
}

export function createTranslatePaProvider(
  options: TranslatePaOptions
): TranslationProvider {
  async function translateBatch(
    items: string[],
    opts: TranslationRequestOptions
  ): Promise<string[]> {
    if (items.length === 0) {
      return [];
    }
    const payload = [
      [items, opts.sourceLang ?? "auto", opts.targetLang],
      "wt_lib",
    ];
    const res = await gmRequest({
      method: "POST",
      url: TRANSLATE_PA_ENDPOINT,
      headers: {
        "Content-Type": "application/json+protobuf",
        "X-Goog-Api-Key": options.apiKey,
      },
      data: JSON.stringify(payload),
      timeout: 25_000,
    });

    const parsed = JSON.parse(res.responseText) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("[ptr] Unexpected translate-pa response shape");
    }
    const [translations] = parsed as unknown[];
    if (!Array.isArray(translations)) {
      throw new Error("[ptr] Unexpected translate-pa response shape");
    }
    if (translations.length !== items.length) {
      throw new Error(
        `[ptr] translate-pa count mismatch: expected ${items.length}, got ${translations.length}`
      );
    }
    return translations.map((v) => String(v ?? ""));
  }

  async function translateGrouped(
    groups: readonly (readonly GroupedTranslateItem[])[],
    opts: TranslationRequestOptions
  ): Promise<Map<string, string>> {
    if (groups.length === 0) {
      return new Map();
    }
    const payloads = groups.map(
      (group, gIdx) =>
        `<div data-ptr-g="${gIdx}">${group
          .map(
            (item) => `<p data-ptr-s="${escapeAttr(item.id)}">${item.html}</p>`
          )
          .join("")}</div>`
    );
    const results = await translateBatch(payloads, opts);
    return parseGroupedResponseHtml(results);
  }

  return {
    id: "translate-pa",
    translateBatch,
    translateGrouped,
  };
}
