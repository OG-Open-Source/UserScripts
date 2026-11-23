import type { GMRequestOptions, GMXHRResponse } from "@userscripts/shared";
import { gmRequest } from "@userscripts/shared";
import type {
  GroupedTranslateItem,
  TranslationProvider,
  TranslationRequestOptions,
} from "../core/types";
import { DEFAULT_TRANSLATE_PA_API_KEY } from "../platform/config";

const TRANSLATE_PA_ENDPOINT =
  "https://translate-pa.googleapis.com/v1/translateHtml";

export type TranslatePaRequest = (
  options: GMRequestOptions
) => Promise<Pick<GMXHRResponse, "responseText">>;

export interface TranslatePaOptions {
  apiKey: string;
  request?: TranslatePaRequest;
}

function escapeAttr(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;");
}

function createAbortError(): DOMException {
  return new DOMException("The translation request was aborted.", "AbortError");
}

async function requestWithAbort(
  request: TranslatePaRequest,
  options: GMRequestOptions,
  signal: AbortSignal | undefined
): Promise<Pick<GMXHRResponse, "responseText">> {
  if (signal?.aborted) {
    throw createAbortError();
  }
  if (!signal) {
    return request(options);
  }

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(createAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const pending = Promise.resolve().then(() => {
    if (signal.aborted) {
      throw createAbortError();
    }
    return request(options);
  });
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
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
      const { id, inner } = match.groups ?? {};
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
  const request = options.request ?? gmRequest;
  const apiKey = options.apiKey.trim() || DEFAULT_TRANSLATE_PA_API_KEY;

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
    const response = await requestWithAbort(
      request,
      {
        method: "POST",
        url: TRANSLATE_PA_ENDPOINT,
        headers: {
          "Content-Type": "application/json+protobuf",
          "X-Goog-Api-Key": apiKey,
        },
        data: JSON.stringify(payload),
        timeout: 25_000,
      },
      opts.signal
    );

    const parsed = JSON.parse(response.responseText) as unknown;
    if (!(Array.isArray(parsed) && Array.isArray(parsed[0]))) {
      throw new Error("[ptr] Unexpected translate-pa response shape");
    }
    const translations = parsed[0] as unknown[];
    if (translations.length !== items.length) {
      throw new Error(
        `[ptr] translate-pa count mismatch: expected ${items.length}, got ${translations.length}`
      );
    }
    return translations.map((value) => String(value ?? ""));
  }

  async function translateGrouped(
    groups: readonly (readonly GroupedTranslateItem[])[],
    opts: TranslationRequestOptions
  ): Promise<Map<string, string>> {
    if (groups.length === 0) {
      return new Map();
    }
    const payloads = groups.map(
      (group, groupIndex) =>
        `<div data-ptr-g="${groupIndex}">${group
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
