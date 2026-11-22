export interface ElementStyle {
  display: string;
  fontFamily?: string;
  visibility: string;
}

export type StyleReader = (el: Element) => ElementStyle;
export type ElementRole = "hidden" | "inline" | "block";

const NON_PROSE_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "TEXTAREA",
  "INPUT",
  "SELECT",
  "OPTION",
  "SVG",
  "MATH",
  "CANVAS",
  "AUDIO",
  "VIDEO",
  "IFRAME",
  "OBJECT",
  "EMBED",
]);

const CODE_TAGS = new Set(["CODE", "PRE", "KBD", "SAMP", "VAR", "TT"]);
const FONT_EDGE_QUOTES_RE = /^["']|["']$/gu;
const FONT_SEPARATOR_RE = /[_-]/gu;
const FONT_WHITESPACE_RE = /\s+/gu;
const MONOSPACE_FAMILIES = new Set([
  "anonymous pro",
  "cascadia code",
  "cascadia mono",
  "consolas",
  "courier",
  "courier new",
  "cousine",
  "dejavu sans mono",
  "fira code",
  "fira mono",
  "hack",
  "ibm plex mono",
  "inconsolata",
  "input mono",
  "jetbrains mono",
  "liberation mono",
  "lucida console",
  "menlo",
  "monaco",
  "noto sans mono",
  "pt mono",
  "roboto mono",
  "sf mono",
  "sfmono regular",
  "source code pro",
  "space mono",
  "ubuntu mono",
]);

export function defaultGetStyle(el: Element): ElementStyle {
  const view = el.ownerDocument?.defaultView;
  const viewGetStyle =
    view && typeof view.getComputedStyle === "function"
      ? view.getComputedStyle.bind(view)
      : null;
  const gcs =
    viewGetStyle ??
    (typeof getComputedStyle === "function" ? getComputedStyle : null);
  if (!gcs) {
    return { display: "block", visibility: "visible", fontFamily: "" };
  }
  const cs = gcs(el);
  return {
    display: cs.display,
    visibility: cs.visibility,
    fontFamily: cs.fontFamily,
  };
}

function normalizeFontFamily(value: string): string {
  return value
    .trim()
    .replace(FONT_EDGE_QUOTES_RE, "")
    .replace(FONT_SEPARATOR_RE, " ")
    .replace(FONT_WHITESPACE_RE, " ")
    .toLowerCase();
}

function hasMonospaceFont(fontFamily: string | undefined): boolean {
  if (!fontFamily) {
    return false;
  }
  return fontFamily.split(",").some((rawFamily) => {
    const family = normalizeFontFamily(rawFamily);
    return (
      family === "monospace" ||
      family === "ui monospace" ||
      MONOSPACE_FAMILIES.has(family)
    );
  });
}

export function isCodeOrMonospace(
  el: Element,
  getStyle: StyleReader = defaultGetStyle
): boolean {
  if (CODE_TAGS.has(el.tagName.toUpperCase())) {
    return true;
  }
  return hasMonospaceFont(getStyle(el).fontFamily);
}

export function isNonProsePrimitive(el: Element): boolean {
  if (NON_PROSE_TAGS.has(el.tagName.toUpperCase())) {
    return true;
  }
  if ((el as HTMLElement).isContentEditable) {
    return true;
  }
  if (el.getAttribute("contenteditable") === "true") {
    return true;
  }
  return false;
}

export function createRoleClassifier(getStyle: StyleReader = defaultGetStyle) {
  const cache = new WeakMap<Element, ElementRole>();

  function getRole(el: Element): ElementRole {
    const cached = cache.get(el);
    if (cached) {
      return cached;
    }

    const { display, visibility } = getStyle(el);
    let role: ElementRole;
    if (
      display === "none" ||
      visibility === "hidden" ||
      visibility === "collapse"
    ) {
      role = "hidden";
    } else if (
      display === "inline" ||
      display === "inline-block" ||
      display === "inline-flex" ||
      display === "inline-grid" ||
      display === "contents" ||
      display === "ruby" ||
      display === "ruby-text" ||
      display === "ruby-base"
    ) {
      role = "inline";
    } else {
      role = "block";
    }

    cache.set(el, role);
    return role;
  }

  return { getRole, isNonProsePrimitive };
}
