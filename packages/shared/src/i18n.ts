/**
 * Multi-language support for userscripts.
 *
 * The script body ships English only. Every other language lives in one fixed
 * file, `locales.json`, next to the released script — adding a language adds
 * an entry, never a file. The script fetches that file on startup, caches it
 * in GM storage, and uses it from then on. Later runs serve the cache and
 * refresh in the background, reloading only when the file changed.
 *
 * The file is the standard. Scripts read it; they do not each keep their own
 * copy of the language list.
 */
import { gmFetch, gmGet, gmMenuCommand, gmSet } from "./gm";

/** One language inside locales.json. */
export interface LocaleEntry {
  /** BCP-47-ish code, e.g. "en", "zh-TW". */
  code: string;
  /** Name shown in the language menu, in that language. */
  name: string;
  /**
   * Message table. Absent for the default language, whose strings ship
   * inside the script.
   */
  messages?: Record<string, string>;
}

/** locales.json — every language a script offers, in one file. */
export interface LocaleFile {
  /** Script id this file belongs to. */
  id: string;
  /** Language used when nothing else matches. Its strings are bundled. */
  default: string;
  languages: LocaleEntry[];
}

/** Where the script reads its locale file from. */
export interface LocaleSource {
  /** Script id; selects the cache slot. */
  scriptId: string;
  /** URL of the single locales.json. */
  url: string;
}

const CACHE_KEY = (scriptId: string): string => `i18n:${scriptId}`;

/**
 * Read the script's locale file.
 *
 * Returns the cached copy immediately when one exists and refreshes it in the
 * background. `onChange` fires only when the refresh differs, so the caller
 * can reload instead of rendering with stale text.
 */
export async function loadLocales(
  source: LocaleSource,
  onChange?: () => void,
): Promise<LocaleFile> {
  const key = CACHE_KEY(source.scriptId);
  const cached = gmGet<LocaleFile | null>(key, null);

  const fresh = gmFetch(source.url).then((body) => JSON.parse(body) as LocaleFile);

  if (cached) {
    void fresh.then((next) => {
      if (JSON.stringify(cached) !== JSON.stringify(next)) {
        gmSet(key, next);
        onChange?.();
      }
    });
    return cached;
  }

  const next = await fresh;
  gmSet(key, next);
  return next;
}

export interface I18nOptions<TKey extends string> {
  source: LocaleSource;
  /** Messages for the default language, bundled in the script. */
  fallback: Record<TKey, string>;
  /** GM storage key holding the chosen language code. */
  storageKey?: string;
}

export interface I18nInstance<TKey extends string> {
  /** Active language code. */
  lang: string;
  /** Languages the file offers, in menu order. */
  languages: LocaleEntry[];
  /** Translate a message key, falling back to English, then the key. */
  t: (key: TKey) => string;
}

/**
 * Build an i18n instance and register one menu command per available language.
 *
 * The language list comes from the script's `locales.json`, fetched on first
 * run and cached after. Switching language stores the code and reloads.
 */
export async function createI18n<TKey extends string>(
  options: I18nOptions<TKey>,
): Promise<I18nInstance<TKey>> {
  const { source, fallback, storageKey = "lang" } = options;

  const preferred = gmGet<string | null>(storageKey, null) ?? detectLang();

  let file: LocaleFile = {
    id: source.scriptId,
    default: "en",
    languages: [{ code: "en", name: "English" }],
  };

  try {
    file = await loadLocales(source, () => location.reload());
  } catch {
    // File unreachable: keep English. The next run tries again.
  }

  const known = file.languages.map((item) => item.code);
  const lang = known.includes(preferred) ? preferred : file.default;
  const entry = file.languages.find((item) => item.code === lang);

  const t = (key: TKey): string => {
    if (lang === file.default) return fallback[key] ?? key;
    return entry?.messages?.[key] ?? fallback[key] ?? key;
  };

  for (const item of file.languages) {
    gmMenuCommand(item.name + (item.code === lang ? " ✓" : ""), () => {
      if (item.code === lang) return;
      gmSet(storageKey, item.code);
      location.reload();
    });
  }

  return { lang, languages: file.languages, t };
}

/** Best language for the browser, before the locale file is known. */
export function detectLang(): string {
  const nav = (navigator.language || "en").toLowerCase();
  if (nav.startsWith("zh")) {
    return nav.includes("tw") || nav.includes("hk") || nav.includes("hant") ? "zh-TW" : "zh-CN";
  }
  return nav.split("-")[0] || "en";
}
