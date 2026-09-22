/**
 * Multi-language support for userscripts.
 *
 * Detects language from a stored GM value or `navigator.language`, exposes a
 * `t()` translator, and registers one popup menu command per language (the
 * active one marked with ✓) so the user can switch languages directly from
 * the Violentmonkey/Tampermonkey menu.
 */
import { gmGet, gmMenuCommand, gmSet } from "./gm";

export interface I18nOptions<TLang extends string, TKey extends string> {
	/** Supported language codes, in menu order. */
	langs: TLang[];
	/** Fallback language when detection fails. */
	defaultLang: TLang;
	/** Display names for the popup menu, keyed by language code. */
	langNames: Record<TLang, string>;
	/** Translation tables, keyed by language code then message key. */
	messages: Record<TLang, Record<TKey, string>>;
	/** GM storage key holding the chosen language code. */
	storageKey?: string;
}

export interface I18nInstance<TLang extends string, TKey extends string> {
	/** Active language code. */
	lang: TLang;
	/** Translate a message key, falling back to defaultLang then the key. */
	t: (key: TKey) => string;
}

/**
 * Detect the active language: stored preference first, then navigator,
 * then the default.
 */
export function detectLang<TLang extends string>(
	langs: TLang[],
	defaultLang: TLang,
	storageKey = "lang",
): TLang {
	const saved = gmGet<string | null>(storageKey, null);
	if (saved && (langs as string[]).includes(saved)) return saved as TLang;
	const nav = (navigator.language || defaultLang).toLowerCase();
	if (nav.startsWith("zh")) {
		return (nav.includes("tw") || nav.includes("hk") || nav.includes("hant")
			? "zh-TW"
			: "zh-CN") as unknown as TLang;
	}
	if ((langs as string[]).includes("en")) return "en" as unknown as TLang;
	return defaultLang;
}

/**
 * Build an i18n instance and register the language-switch menu commands.
 *
 * Switching language stores the new code and reloads the page, matching the
 * behavior of the original standalone script.
 */
export function createI18n<TLang extends string, TKey extends string>(
	options: I18nOptions<TLang, TKey>,
): I18nInstance<TLang, TKey> {
	const {
		langs,
		defaultLang,
		langNames,
		messages,
		storageKey = "lang",
	} = options;

	const lang = detectLang(langs, defaultLang, storageKey);

	const t = (key: TKey): string => {
		return (
			messages[lang]?.[key] ??
			messages[defaultLang]?.[key] ??
			(key as unknown as string)
		);
	};

	for (const code of langs) {
		gmMenuCommand(langNames[code] + (code === lang ? " ✓" : ""), () => {
			if (code === lang) return;
			gmSet(storageKey, code);
			location.reload();
		});
	}

	return { lang, t };
}
