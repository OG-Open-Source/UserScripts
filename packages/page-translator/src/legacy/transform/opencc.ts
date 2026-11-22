import { gmFetch, gmGet, gmSet } from "@userscripts/shared";
import type { DictGroup } from "opencc-js/core";
import { ConverterFactory } from "opencc-js/core";
import type { OpenCCMode } from "../config";

export interface OpenCCConverter {
  convert(text: string): string;
}

const OPENCC_CDN_BASE =
  "https://cdn.jsdelivr.net/npm/opencc-js@1.4.2/dist/esm-lib/dict";
const DICT_CACHE_PREFIX = "ptr:opencc-dict:";

const MODE_CHAINS: Record<Exclude<OpenCCMode, "off">, string[][]> = {
  s2t: [
    ["STPhrases", "STPhrases_GeneratedFromRegionalPhrases", "STCharacters"],
  ],
  s2twp: [
    ["STPhrases", "STPhrases_GeneratedFromRegionalPhrases", "STCharacters"],
    ["TWPhrases", "TWVariantsPhrases", "TWVariants"],
  ],
  t2s: [["TSPhrases", "TSCharacters"]],
  tw2sp: [
    ["TWPhrasesRev", "TWVariantsRevPhrases", "TWVariantsRev"],
    ["TSPhrases", "TSCharacters"],
  ],
};

// Minimal offline char fallback when dictionary fetch fails and cache is cold.
const OFFLINE_S2T: Record<string, string> = {
  软: "軟",
  体: "體",
  开: "開",
  发: "發",
  译: "譯",
  简: "簡",
  繁: "繁",
  网: "網",
  页: "頁",
  设: "設",
  置: "置",
  语: "語",
  言: "言",
};
const OFFLINE_T2S: Record<string, string> = Object.fromEntries(
  Object.entries(OFFLINE_S2T).map(([s, t]) => [t, s])
);

function parseExportedDictModule(source: string): string {
  const trimmed = source.trim();
  if (!trimmed.startsWith("export default")) {
    return trimmed;
  }
  const firstQuote = trimmed.indexOf('"');
  const lastQuote = trimmed.lastIndexOf('"');
  if (firstQuote === -1 || lastQuote <= firstQuote) {
    throw new Error("Invalid OpenCC dictionary module format");
  }
  return JSON.parse(trimmed.slice(firstQuote, lastQuote + 1)) as string;
}

function defaultFetcher(dictName: string): Promise<string> {
  return gmFetch(`${OPENCC_CDN_BASE}/${dictName}.js`, 15_000);
}

async function loadDictString(
  dictName: string,
  fetcher: (dictName: string) => Promise<string>
): Promise<string> {
  const cacheKey = `${DICT_CACHE_PREFIX}${dictName}`;
  try {
    const cached = gmGet<string | null>(cacheKey, null);
    if (typeof cached === "string" && cached.length > 0) {
      return cached;
    }
  } catch {
    // Ignore GM storage errors if unconfigured
  }

  const moduleText = await fetcher(dictName);
  const dict = parseExportedDictModule(moduleText);
  try {
    gmSet(cacheKey, dict);
  } catch {
    // Ignore GM storage errors if unconfigured
  }
  return dict;
}

function createOfflineFallback(
  mode: Exclude<OpenCCMode, "off">
): OpenCCConverter {
  const map = mode === "s2t" || mode === "s2twp" ? OFFLINE_S2T : OFFLINE_T2S;
  return {
    convert(text: string): string {
      let out = "";
      for (const ch of text) {
        out += map[ch] ?? ch;
      }
      return out;
    },
  };
}

const converterCache = new WeakMap<
  (dictName: string) => Promise<string>,
  Map<Exclude<OpenCCMode, "off">, Promise<OpenCCConverter>>
>();

export function createOpenCC(
  mode: Exclude<OpenCCMode, "off">,
  fetcher: (dictName: string) => Promise<string> = defaultFetcher
): Promise<OpenCCConverter> {
  let byMode = converterCache.get(fetcher);
  if (!byMode) {
    byMode = new Map();
    converterCache.set(fetcher, byMode);
  }
  const hit = byMode.get(mode);
  if (hit) {
    return hit;
  }

  const promise = (async (): Promise<OpenCCConverter> => {
    const chainNames = MODE_CHAINS[mode];
    try {
      const groups: DictGroup[] = await Promise.all(
        chainNames.map(async (group) =>
          Promise.all(group.map((name) => loadDictString(name, fetcher)))
        )
      );
      const fn = ConverterFactory(...groups);
      return { convert: fn };
    } catch {
      return createOfflineFallback(mode);
    }
  })();

  byMode.set(mode, promise);
  return promise;
}
