import type { OpenCCMode } from "../config";

export interface Bcp47Parts {
  lang: string;
  region?: string;
  script?: string;
}

export type SegmentRoute =
  | { action: "skip" }
  | { action: "opencc"; mode: Exclude<OpenCCMode, "off"> }
  | { action: "translate" };

const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL_RE = /\p{Script=Hangul}/u;
const HAN_RE = /\p{Script=Han}/u;
const LATIN_RE = /[A-Za-z]/u;

const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
const ARABIC_RE = /\p{Script=Arabic}/u;
const THAI_RE = /\p{Script=Thai}/u;
const GREEK_RE = /\p{Script=Greek}/u;
const HEBREW_RE = /\p{Script=Hebrew}/u;
const DEVANAGARI_RE = /\p{Script=Devanagari}/u;

// Non-Latin script blocks are classified by content alone so segment routing
// never labels them "und" and skips them.
const NON_LATIN_SCRIPT_TAGS: ReadonlyArray<readonly [RegExp, string]> = [
  [CYRILLIC_RE, "ru"],
  [ARABIC_RE, "ar"],
  [THAI_RE, "th"],
  [GREEK_RE, "el"],
  [HEBREW_RE, "he"],
  [DEVANAGARI_RE, "hi"],
];

// High-frequency mutually-exclusive Traditional vs Simplified Han characters.
const TRAD_FINGERPRINT = new Set(
  "這為說時發們國體語網設試測驗證類開點與還原譯鍵關圖書軟體學專業務實踐機區別動靜態編輯標點符號頁碼視頻檔個會對題號電資訊錄顯無應進選擇統計機構"
);
const SIMP_FINGERPRINT = new Set(
  "这为说时发们国体语网设试测验证类开点与还原译键关图书软件学专业务实践机区别动静态编辑标点符号页码视频档个会对题号电资讯录显无应进选择统计机构"
);

export function parseBcp47(tag: string): Bcp47Parts {
  const parts = tag.trim().split(/[-_]/u).filter(Boolean);
  if (parts.length === 0) {
    return { lang: "und" };
  }

  const lang = parts[0]!.toLowerCase();
  let script: string | undefined;
  let region: string | undefined;

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.length === 4 && /^[A-Za-z]{4}$/u.test(p)) {
      script = p[0]!.toUpperCase() + p.slice(1).toLowerCase();
    } else if (p.length === 2 && /^[A-Za-z]{2}$/u.test(p)) {
      region = p.toUpperCase();
    }
  }

  if (lang === "zh" && !script) {
    if (region === "TW" || region === "HK" || region === "MO") {
      script = "Hant";
    } else if (region === "CN" || region === "SG") {
      script = "Hans";
    }
  }

  return { lang, ...(script ? { script } : {}), ...(region ? { region } : {}) };
}

export function detectSegmentBcp47(
  text: string,
  elementLang?: string
): Bcp47Parts {
  if (KANA_RE.test(text)) {
    return { lang: "ja" };
  }
  if (HANGUL_RE.test(text)) {
    return { lang: "ko" };
  }

  if (HAN_RE.test(text)) {
    const parsedEl = elementLang ? parseBcp47(elementLang) : null;
    if (parsedEl && (parsedEl.lang === "ja" || parsedEl.lang === "ko")) {
      return parsedEl;
    }

    let tradCount = 0;
    let simpCount = 0;
    for (const ch of text) {
      if (TRAD_FINGERPRINT.has(ch)) {
        tradCount++;
      } else if (SIMP_FINGERPRINT.has(ch)) {
        simpCount++;
      }
    }
    if (simpCount > tradCount) {
      return { lang: "zh", script: "Hans" };
    }
    if (tradCount > simpCount) {
      return { lang: "zh", script: "Hant" };
    }

    if (parsedEl && parsedEl.lang === "zh") {
      return parsedEl;
    }
    return { lang: "zh" };
  }

  for (const [scriptRe, lang] of NON_LATIN_SCRIPT_TAGS) {
    if (scriptRe.test(text)) {
      return { lang };
    }
  }

  if (elementLang) {
    const parsed = parseBcp47(elementLang);
    // Do not let an outer <html lang="zh-TW"> mislabel an embedded English paragraph.
    if (parsed.lang === "zh" && LATIN_RE.test(text)) {
      return { lang: "en" };
    }
    if (parsed.lang !== "und") {
      return parsed;
    }
  }

  return { lang: LATIN_RE.test(text) ? "en" : "und" };
}

export function routeSegment(
  text: string,
  targetLang: string,
  elementLang?: string
): SegmentRoute {
  const target = parseBcp47(targetLang);
  const source = detectSegmentBcp47(text, elementLang);

  if (source.lang === "zh" && target.lang === "zh") {
    if (source.script && target.script && source.script !== target.script) {
      if (source.script === "Hans" && target.script === "Hant") {
        return {
          action: "opencc",
          mode: target.region === "TW" ? "s2twp" : "s2t",
        };
      }
      if (source.script === "Hant" && target.script === "Hans") {
        return {
          action: "opencc",
          mode: target.region === "CN" ? "tw2sp" : "t2s",
        };
      }
    }
    return { action: "skip" };
  }

  if (source.lang !== "und" && source.lang === target.lang) {
    return { action: "skip" };
  }

  return { action: "translate" };
}

interface ChromeLanguageDetectorGlobal {
  availability?: () => Promise<string>;
}

// Probes Chrome's built-in LanguageDetector without triggering model downloads.
export async function probeChromeLanguageDetector(): Promise<
  "available" | "unavailable"
> {
  try {
    const g = globalThis as typeof globalThis & {
      LanguageDetector?: ChromeLanguageDetectorGlobal;
    };
    if (
      !("LanguageDetector" in globalThis) ||
      typeof g.LanguageDetector?.availability !== "function"
    ) {
      return "unavailable";
    }
    const status = await g.LanguageDetector.availability();
    return status === "available" ? "available" : "unavailable";
  } catch {
    return "unavailable";
  }
}
