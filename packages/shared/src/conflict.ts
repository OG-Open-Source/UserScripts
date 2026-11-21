/**
 * Cross-script UI boundary contract.
 *
 * Every monorepo-owned injected element carries `data-us-ui="<script-id>"`
 * and `translate="no"` so page-wide scripts (like Page Translator) never wrap,
 * translate, or block clicks on another userscript's controls, and native icon
 * font glyphs (Material Icons / Material Symbols) stay untouched.
 */

export const US_UI_ATTR = "data-us-ui";

const ICON_FONT_CLASS_RE =
  /\bmaterial-(?:icons(?:-[a-z-]+)?|symbols(?:-[a-z-]+)?)\b/iu;

/** Tag a root element as userscript-managed UI so sibling scripts ignore it. */
export function markUiRoot(el: Element, scriptId: string): void {
  el.setAttribute(US_UI_ATTR, scriptId);
  el.setAttribute("translate", "no");
}

/**
 * Returns true when `node` belongs to any userscript-managed UI, an explicit
 * `translate="no"` / `.notranslate` region, or a Material icon glyph element.
 */
export function isForeignUi(node: Node | null | undefined): boolean {
  if (!node) {
    return false;
  }
  const el =
    node.nodeType === 1
      ? (node as Element)
      : ((node as { parentElement?: Element | null }).parentElement ?? null);
  if (!el) {
    return false;
  }
  if (
    el.hasAttribute(US_UI_ATTR) ||
    el.hasAttribute("data-ptr-ui") ||
    el.getAttribute("translate") === "no" ||
    el.classList?.contains("notranslate")
  ) {
    return true;
  }
  if (
    typeof el.closest === "function" &&
    el.closest(
      `[${US_UI_ATTR}],[data-ptr-ui],[translate="no"],.notranslate`
    ) !== null
  ) {
    return true;
  }
  const cls = el.getAttribute("class") ?? "";
  if (cls && ICON_FONT_CLASS_RE.test(cls)) {
    return true;
  }
  return false;
}

/**
 * Event-level guard (for Volunteer Click Lock, keyboard handlers, etc.):
 * checks `composedPath()` so Shadow DOM events from any `[data-us-ui]` host
 * pass through without being intercepted.
 */
export function isUsUiEvent(e: Event, ownHost?: Element | null): boolean {
  if (typeof e.composedPath === "function") {
    for (const node of e.composedPath()) {
      if (ownHost && node === ownHost) {
        return true;
      }
      if (
        node &&
        typeof (node as Element).hasAttribute === "function" &&
        ((node as Element).hasAttribute(US_UI_ATTR) ||
          (node as Element).hasAttribute("data-ptr-ui"))
      ) {
        return true;
      }
    }
  }
  const target = e.target as (Node & Partial<Element>) | null;
  if (!target) {
    return false;
  }
  if (ownHost?.shadowRoot && target.getRootNode?.() === ownHost.shadowRoot) {
    return true;
  }
  return isForeignUi(target);
}
