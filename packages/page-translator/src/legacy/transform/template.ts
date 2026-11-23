export interface SiteLocaleScope {
  dynamic?: Record<string, string>;
  static?: Record<string, string>;
}

export interface SiteLocaleTable {
  dynamic?: Record<string, string>;
  scoped?: Record<string, SiteLocaleScope>;
  static?: Record<string, string>;
}

export interface ExtractedTemplate {
  kind: "static" | "dynamic";
  template: string;
  values: string[];
}

const TOKENIZER_RE =
  /(?<atomic><x\s+id="\d+"\s*\/>)|(?<tag><[^>]+>)|(?<handle>@[A-Za-z0-9_-]+)|(?<num>(?<![A-Za-z0-9.])(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?![A-Za-z0-9.]))/gu;
const TEMPLATE_VAR_RE = /\{v(?<idx>\d+)\}/gu;

export function extractTemplate(payloadHtml: string): ExtractedTemplate {
  const values: string[] = [];
  const template = payloadHtml.replace(TOKENIZER_RE, (...args) => {
    const full = args[0] as string;
    const groups = args.at(-1) as
      | { atomic?: string; tag?: string; handle?: string; num?: string }
      | undefined;
    if (groups?.tag) {
      return groups.tag;
    }
    const val = groups?.atomic ?? groups?.handle ?? groups?.num;
    if (!val) {
      return full;
    }
    const idx = values.length;
    values.push(val);
    return `{v${idx}}`;
  });

  return { kind: values.length > 0 ? "dynamic" : "static", template, values };
}

export function interpolateTemplate(
  template: string,
  values: readonly string[]
): string {
  return template.replace(TEMPLATE_VAR_RE, (m, rawIdx: string) => {
    const idx = Number(rawIdx);
    const val = idx >= 0 && idx < values.length ? values[idx] : undefined;
    return val === undefined ? m : val;
  });
}

function matchScopeEntry(
  payloadHtml: string,
  trimmed: string,
  scope: SiteLocaleScope | null | undefined,
  getExtracted: () => ExtractedTemplate
): { kind: "static" | "dynamic"; html: string } | null {
  if (!scope) {
    return null;
  }

  const staticHit = scope.static?.[payloadHtml] ?? scope.static?.[trimmed];
  if (typeof staticHit === "string") {
    return { kind: "static", html: staticHit };
  }

  const extracted = getExtracted();
  if (extracted.values.length > 0) {
    const dynHit = scope.dynamic?.[extracted.template];
    if (typeof dynHit === "string") {
      return {
        kind: "dynamic",
        html: interpolateTemplate(dynHit, extracted.values),
      };
    }
  }

  return null;
}

function matchesScopeSelector(container: Element, selector: string): boolean {
  if (typeof container.closest !== "function") {
    return false;
  }
  try {
    return container.closest(selector) !== null;
  } catch {
    return false;
  }
}

export function matchSiteTranslation(
  payloadHtml: string,
  table: SiteLocaleTable | null | undefined,
  container?: Element | null
): { kind: "static" | "dynamic"; html: string; scope?: string } | null {
  if (!table) {
    return null;
  }

  const trimmed = payloadHtml.trim();
  let extracted: ExtractedTemplate | null = null;
  const getExtracted = (): ExtractedTemplate => {
    if (!extracted) {
      extracted = extractTemplate(trimmed);
    }
    return extracted;
  };

  if (container && table.scoped) {
    for (const [selector, scopeTable] of Object.entries(table.scoped)) {
      if (
        !(selector && scopeTable && matchesScopeSelector(container, selector))
      ) {
        continue;
      }

      const hit = matchScopeEntry(
        payloadHtml,
        trimmed,
        scopeTable,
        getExtracted
      );
      if (hit) {
        return { ...hit, scope: selector };
      }
    }
  }

  return matchScopeEntry(payloadHtml, trimmed, table, getExtracted);
}

const HASHED_TOKEN_RE = /^[A-Za-z0-9_-]*[0-9][A-Za-z0-9_-]{3,}$/u;
const VALID_IDENT_RE = /^[A-Za-z_-][A-Za-z0-9_-]*$/u;
const CLASS_SPLIT_RE = /\s+/u;

function escapeAttrValue(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

function suggestElementSelector(cur: Element): string {
  const tag = cur.tagName.toLowerCase();
  if (tag === "body" || tag === "html") {
    return "";
  }

  const id = cur.getAttribute("id")?.trim();
  if (id && VALID_IDENT_RE.test(id) && !HASHED_TOKEN_RE.test(id)) {
    return `#${id}`;
  }

  const testId = cur.getAttribute("data-testid")?.trim();
  if (testId) {
    return `[data-testid="${escapeAttrValue(testId)}"]`;
  }

  const ariaLabel = cur.getAttribute("aria-label")?.trim();
  if (ariaLabel) {
    return `${tag}[aria-label="${escapeAttrValue(ariaLabel)}"]`;
  }

  const rawClass = cur.getAttribute("class") ?? "";
  for (const token of rawClass.split(CLASS_SPLIT_RE)) {
    if (token && VALID_IDENT_RE.test(token) && !HASHED_TOKEN_RE.test(token)) {
      return `.${token}`;
    }
  }
  return "";
}

export function suggestScopeSelector(el: Element | null | undefined): string {
  let cur: Element | null = el?.parentElement ?? null;
  for (let depth = 0; cur && depth < 5; depth += 1, cur = cur.parentElement) {
    const tag = cur.tagName.toLowerCase();
    if (tag === "body" || tag === "html") {
      break;
    }
    const sel = suggestElementSelector(cur);
    if (sel) {
      return sel;
    }
  }
  return "";
}
