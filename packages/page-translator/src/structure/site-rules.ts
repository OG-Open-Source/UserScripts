export type SiteModifier =
  | "block"
  | "inline-atomic"
  | "no-spacing"
  | "no-opencc"
  | "keep-orig";

const LINE_SPLIT_RE = /\r?\n/u;
const CRLF_RE = /\r\n?/gu;
const NUMERIC_ONLY_RE = /^\d+$/u;
const HEX_HASH_RE = /^[0-9a-f]{7,}$/iu;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const REACT_USE_ID_RE = /^:[a-z0-9]+:$/iu;
const CSS_IN_JS_CLASS_RE = /^(?:css|sc|jsx)-[a-z0-9_-]{4,}$/iu;
const LEADING_HASH_CLASS_RE = /^_[a-z0-9_-]{5,}$/iu;
const MODULE_SUFFIX_CLASS_RE = /__[a-z0-9]{5,}$/iu;
const RANDOM_ALNUM_CLASS_RE = /^(?=.*\d)(?=.*[a-z])[a-z0-9]{6,}$/iu;
const ATTR_BACKSLASH_RE = /\\/gu;
const ATTR_QUOTE_RE = /"/gu;
const MAX_SUGGEST_PATH_DEPTH = 3;
const VALID_MODIFIERS = new Set<SiteModifier>([
  "block",
  "inline-atomic",
  "no-spacing",
  "no-opencc",
  "keep-orig",
]);

export interface SiteModRule {
  modifiers: SiteModifier[];
  selector: string;
}

export interface CompiledSiteDelta {
  addSelectors: string[];
  modRules: SiteModRule[];
  removeSelectors: string[];
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Verbatim legacy parser port keeps established branch behavior.
export function parseSiteDelta(source: string): CompiledSiteDelta {
  const addSelectors: string[] = [];
  const removeSelectors: string[] = [];
  const modRules: SiteModRule[] = [];

  for (const rawLine of source.split(LINE_SPLIT_RE)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const [op] = line;
    const rest = line.slice(1).trim();
    if (!rest) {
      continue;
    }

    if (op === "+") {
      addSelectors.push(rest);
    } else if (op === "-") {
      removeSelectors.push(rest);
    } else if (op === "*") {
      const sepIdx = rest.lastIndexOf(":");
      if (sepIdx === -1) {
        continue;
      }
      const selector = rest.slice(0, sepIdx).trim();
      const rawMods = rest.slice(sepIdx + 1);
      if (!selector) {
        continue;
      }
      const modifiers = rawMods
        .split(",")
        .map((m) => m.trim() as SiteModifier)
        .filter((m) => VALID_MODIFIERS.has(m));
      if (modifiers.length > 0) {
        modRules.push({ selector, modifiers });
      }
    }
  }

  return { addSelectors, removeSelectors, modRules };
}

function hostMatchesPattern(hostname: string, pattern: string): boolean {
  const host = hostname.toLowerCase();
  const pat = pattern.trim().toLowerCase();
  if (!pat) {
    return false;
  }
  if (pat === "*") {
    return true;
  }
  if (pat.startsWith("*.")) {
    const base = pat.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return host === pat;
}

function patternSpecificity(pattern: string): number {
  const pat = pattern.trim();
  if (pat === "*") {
    return 0;
  }
  if (pat.startsWith("*.")) {
    return 1;
  }
  return 2;
}

export const BUILTIN_SITE_DEFAULTS: Record<string, string> = {};

export function resolveSiteDeltaForHost(
  hostname: string,
  siteDeltas: Record<string, string>,
  builtInDefaults: Record<string, string> = BUILTIN_SITE_DEFAULTS
): CompiledSiteDelta {
  const entries: [string, string][] = [
    ...Object.entries(builtInDefaults),
    ...Object.entries(siteDeltas),
  ];

  const matched = entries
    .filter(([pattern]) => hostMatchesPattern(hostname, pattern))
    .sort(([a], [b]) => patternSpecificity(a) - patternSpecificity(b));

  const addSelectors: string[] = [];
  const removeSelectors: string[] = [];
  const modRules: SiteModRule[] = [];

  for (const [, source] of matched) {
    const parsed = parseSiteDelta(source);
    addSelectors.push(...parsed.addSelectors);
    removeSelectors.push(...parsed.removeSelectors);
    modRules.push(...parsed.modRules);
  }

  return { addSelectors, removeSelectors, modRules };
}

export function safeMatches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

export function matchesAny(el: Element, selectors: readonly string[]): boolean {
  for (const sel of selectors) {
    if (safeMatches(el, sel)) {
      return true;
    }
  }
  return false;
}

export function matchModifiers(
  el: Element,
  delta: CompiledSiteDelta
): Set<SiteModifier> {
  const out = new Set<SiteModifier>();
  for (const rule of delta.modRules) {
    if (safeMatches(el, rule.selector)) {
      for (const mod of rule.modifiers) {
        out.add(mod);
      }
    }
  }
  return out;
}

export function serializeSiteDelta(delta: CompiledSiteDelta): string {
  const lines: string[] = [];
  for (const selector of delta.addSelectors) {
    lines.push(`+ ${selector}`);
  }
  for (const selector of delta.removeSelectors) {
    lines.push(`- ${selector}`);
  }
  for (const rule of delta.modRules) {
    if (rule.modifiers.length > 0) {
      lines.push(`* ${rule.selector} : ${rule.modifiers.join(", ")}`);
    }
  }
  return lines.join("\n");
}

function normalizeLines(source: string): string[] {
  const lines = source.replace(CRLF_RE, "\n").split("\n");
  while (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

export function appendSiteDeltaRule(source: string, ruleLine: string): string {
  const lines = normalizeLines(source);
  const trimmedRule = ruleLine.trim();
  if (!trimmedRule) {
    return lines.join("\n");
  }
  if (lines.some((line) => line.trim() === trimmedRule)) {
    return lines.join("\n");
  }
  lines.push(trimmedRule);
  return lines.join("\n");
}

export function removeSiteDeltaRule(source: string, ruleLine: string): string {
  const normalized = source.replace(CRLF_RE, "\n");
  const trimmedRule = ruleLine.trim();
  if (!trimmedRule) {
    return normalized;
  }
  return normalized
    .split("\n")
    .filter((line) => line.trim() !== trimmedRule)
    .join("\n");
}

function fallbackCssEscape(value: string): string {
  let escaped = "";
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    const character = value.charAt(index);

    if (codeUnit === 0) {
      escaped += "\uFFFD";
      continue;
    }
    if (
      (codeUnit >= 1 && codeUnit <= 31) ||
      codeUnit === 127 ||
      (index === 0 && codeUnit >= 48 && codeUnit <= 57) ||
      (index === 1 &&
        codeUnit >= 48 &&
        codeUnit <= 57 &&
        value.charCodeAt(0) === 45)
    ) {
      escaped += `\\${codeUnit.toString(16)} `;
      continue;
    }
    if (index === 0 && codeUnit === 45 && value.length === 1) {
      escaped += `\\${character}`;
      continue;
    }
    if (
      codeUnit >= 128 ||
      codeUnit === 45 ||
      codeUnit === 95 ||
      (codeUnit >= 48 && codeUnit <= 57) ||
      (codeUnit >= 65 && codeUnit <= 90) ||
      (codeUnit >= 97 && codeUnit <= 122)
    ) {
      escaped += character;
      continue;
    }
    escaped += `\\${character}`;
  }
  return escaped;
}

function escapeCssIdentifier(el: Element, value: string): string {
  const css = el.ownerDocument?.defaultView?.CSS ?? globalThis.CSS;
  if (typeof css?.escape === "function") {
    return css.escape(value);
  }
  return fallbackCssEscape(value);
}

function isStableId(id: string): boolean {
  if (!id) {
    return false;
  }
  return !(
    NUMERIC_ONLY_RE.test(id) ||
    HEX_HASH_RE.test(id) ||
    UUID_RE.test(id) ||
    REACT_USE_ID_RE.test(id)
  );
}

function isStableClass(cls: string): boolean {
  if (!cls || cls.startsWith("data-tr-")) {
    return false;
  }
  return !(
    CSS_IN_JS_CLASS_RE.test(cls) ||
    LEADING_HASH_CLASS_RE.test(cls) ||
    MODULE_SUFFIX_CLASS_RE.test(cls) ||
    HEX_HASH_RE.test(cls) ||
    RANDOM_ALNUM_CLASS_RE.test(cls)
  );
}

function buildNthOfTypePath(el: Element): string {
  const segments: string[] = [];
  let current: Element | null = el;

  while (current && segments.length < MAX_SUGGEST_PATH_DEPTH) {
    const currentId = current.id?.trim() ?? "";
    if (segments.length > 0 && isStableId(currentId)) {
      const idSelector = `#${escapeCssIdentifier(current, currentId)}`;
      if (safeMatches(current, idSelector)) {
        segments.unshift(idSelector);
        break;
      }
    }

    const currentTag = current.tagName;
    const tag = currentTag.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (sibling) => sibling.tagName === currentTag
      );
      if (sameTag.length > 1) {
        segments.unshift(`${tag}:nth-of-type(${sameTag.indexOf(current) + 1})`);
      } else {
        segments.unshift(tag);
      }
    } else {
      segments.unshift(tag);
    }

    current = parent;
  }

  return segments.join(" > ");
}

export function suggestSelectorForElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id?.trim() ?? "";
  if (isStableId(id)) {
    const idSelector = `#${escapeCssIdentifier(el, id)}`;
    if (safeMatches(el, idSelector)) {
      return idSelector;
    }
  }

  const ariaLabel = el.getAttribute("aria-label")?.trim() ?? "";
  if (ariaLabel) {
    const escapedBackslash = ariaLabel.replace(ATTR_BACKSLASH_RE, "\\\\");
    const ariaSelector =
      escapedBackslash.includes('"') && !escapedBackslash.includes("'")
        ? `${tag}[aria-label='${escapedBackslash}']`
        : `${tag}[aria-label="${escapedBackslash.replace(ATTR_QUOTE_RE, '\\"')}"]`;
    if (safeMatches(el, ariaSelector)) {
      return ariaSelector;
    }
  }

  for (const cls of Array.from(el.classList)) {
    if (!isStableClass(cls)) {
      continue;
    }
    const classSelector = `${tag}.${escapeCssIdentifier(el, cls)}`;
    if (safeMatches(el, classSelector)) {
      return classSelector;
    }
  }

  const pathSelector = buildNthOfTypePath(el);
  if (safeMatches(el, pathSelector)) {
    return pathSelector;
  }
  return tag;
}
