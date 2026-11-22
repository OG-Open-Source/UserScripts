export interface Bcp47Parts {
  lang: string;
  region?: string;
  script?: string;
}

export type PrimaryRoute = "translate" | "zh-subsystem" | "skip";

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
const BCP47_SPLIT_RE = /[-_]/u;
const SCRIPT_SUBTAG_RE = /^[A-Za-z]{4}$/u;
const REGION_SUBTAG_RE = /^[A-Za-z]{2}$/u;

const NON_LATIN_SCRIPT_TAGS: ReadonlyArray<readonly [RegExp, string]> = [
  [CYRILLIC_RE, "ru"],
  [ARABIC_RE, "ar"],
  [THAI_RE, "th"],
  [GREEK_RE, "el"],
  [HEBREW_RE, "he"],
  [DEVANAGARI_RE, "hi"],
];

const TRAD_FINGERPRINT = new Set(
  "這為說時發們國體語網設試測驗證類開點與還原譯鍵關圖書軟體學專業務實踐機區別動靜態編輯標點符號頁碼視頻檔個會對題號電資訊錄顯無應進選擇統計機構"
);
const SIMP_FINGERPRINT = new Set(
  "这为说时发们国体语网设试测验证类开点与还原译键关图书软件学专业务实践机区别动静态编辑标点符号页码视频档个会对题号电资讯录显无应进选择统计机构"
);

export function parseBcp47(tag: string): Bcp47Parts {
  const parts = tag.trim().split(BCP47_SPLIT_RE).filter(Boolean);
  const [primary] = parts;
  if (!primary) {
    return { lang: "und" };
  }

  const lang = primary.toLowerCase();
  let script: string | undefined;
  let region: string | undefined;

  for (const part of parts.slice(1)) {
    const [first] = part;
    if (part.length === 4 && first && SCRIPT_SUBTAG_RE.test(part)) {
      script = first.toUpperCase() + part.slice(1).toLowerCase();
    } else if (part.length === 2 && REGION_SUBTAG_RE.test(part)) {
      region = part.toUpperCase();
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Verbatim legacy detection keeps language classification behavior aligned.
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
    const parsedElement = elementLang ? parseBcp47(elementLang) : null;
    if (
      parsedElement &&
      (parsedElement.lang === "ja" || parsedElement.lang === "ko")
    ) {
      return parsedElement;
    }

    let traditionalCount = 0;
    let simplifiedCount = 0;
    for (const char of text) {
      if (TRAD_FINGERPRINT.has(char)) {
        traditionalCount += 1;
      } else if (SIMP_FINGERPRINT.has(char)) {
        simplifiedCount += 1;
      }
    }
    if (simplifiedCount > traditionalCount) {
      return { lang: "zh", script: "Hans" };
    }
    if (traditionalCount > simplifiedCount) {
      return { lang: "zh", script: "Hant" };
    }
    if (parsedElement?.lang === "zh") {
      return parsedElement;
    }
    return { lang: "zh" };
  }

  for (const [scriptPattern, lang] of NON_LATIN_SCRIPT_TAGS) {
    if (scriptPattern.test(text)) {
      return { lang };
    }
  }

  if (elementLang) {
    const parsed = parseBcp47(elementLang);
    if (parsed.lang === "zh" && LATIN_RE.test(text)) {
      return { lang: "en" };
    }
    if (parsed.lang !== "und") {
      return parsed;
    }
  }

  return { lang: LATIN_RE.test(text) ? "en" : "und" };
}

export function routePrimary(
  sourceText: string,
  targetLang: string
): PrimaryRoute {
  const source = detectSegmentBcp47(sourceText);
  const target = parseBcp47(targetLang);

  if (source.lang === "zh" && target.lang === "zh") {
    return "zh-subsystem";
  }
  if (source.lang !== "und" && source.lang === target.lang) {
    return "skip";
  }
  return "translate";
}
