const STORAGE_KEY = "userscripts:lang";

/** @typedef {"en-US" | "zh-Hant-TW" | "zh-Hans-CN"} SettingsLang */

/**
 * Normalize a BCP-47 language tag to a supported settings UI locale.
 * @param {string | null | undefined} code
 * @returns {SettingsLang | null}
 */
function normalizeLang(code) {
  if (!code) {
    return null;
  }
  const lower = String(code).trim().toLowerCase().replace(/_/gu, "-");
  if (!lower) {
    return null;
  }
  if (lower.startsWith("zh")) {
    const traditional =
      lower.includes("hant") ||
      lower.includes("tw") ||
      lower.includes("hk") ||
      lower.includes("mo");
    return traditional ? "zh-Hant-TW" : "zh-Hans-CN";
  }
  if (lower === "en" || lower.startsWith("en-")) {
    return "en-US";
  }
  return null;
}

/**
 * Resolve the active settings UI language.
 * @returns {SettingsLang}
 */
export function getSettingsLang() {
  try {
    const saved = normalizeLang(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      return saved;
    }
  } catch {
    // Ignore storage access errors in restricted browsing contexts.
  }
  const nav =
    typeof navigator === "undefined"
      ? ""
      : (navigator.language ?? navigator.languages?.[0]);
  return normalizeLang(nav) ?? "en-US";
}

/**
 * Build a translator bound to the current settings language.
 * @param {Record<string, Record<string, string>>} dict
 */
export function createSettingsTranslator(dict) {
  const lang = getSettingsLang();

  /**
   * Translate a key with optional `{name}` placeholder interpolation.
   * @param {string} key
   * @param {Record<string, string | number>} [vars]
   * @returns {string}
   */
  function t(key, vars) {
    const template = dict?.[lang]?.[key] ?? dict?.["en-US"]?.[key] ?? key;
    if (!vars) {
      return template;
    }
    return template.replace(/\{(?<name>[a-zA-Z0-9_]+)\}/gu, (match, name) =>
      Object.hasOwn(vars, name) && vars[name] !== undefined
        ? String(vars[name])
        : match
    );
  }

  /**
   * Apply `[data-i18n]`, `[data-i18n-html]`, and `[data-i18n-placeholder]`.
   * Only pass static trusted dictionary strings to `[data-i18n-html]`.
   * @param {ParentNode} [root]
   */
  function applyDom(root = document) {
    if ("documentElement" in root && root.documentElement) {
      root.documentElement.lang = lang;
    }
    for (const el of root.querySelectorAll("[data-i18n]")) {
      const key = el.getAttribute("data-i18n");
      if (key) {
        el.textContent = t(key);
      }
    }
    for (const el of root.querySelectorAll("[data-i18n-html]")) {
      const key = el.getAttribute("data-i18n-html");
      if (key) {
        el.innerHTML = t(key);
      }
    }
    for (const el of root.querySelectorAll("[data-i18n-placeholder]")) {
      const key = el.getAttribute("data-i18n-placeholder");
      if (key) {
        el.setAttribute("placeholder", t(key));
      }
    }
  }

  return { lang, t, applyDom };
}
