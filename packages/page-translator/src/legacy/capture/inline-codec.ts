import type { CompiledSiteDelta, SiteModifier } from "../site-rules";
import { matchesAny, matchModifiers } from "../site-rules";
import { isNonProsePrimitive } from "./display-role";

export interface InlineSlot {
  atomic: boolean;
  element: Element;
  id: number;
  modifiers: Set<SiteModifier>;
}

export interface EncodedInlineSegment {
  payloadHtml: string;
  slots: InlineSlot[];
}

const HAS_LETTER = /\p{L}/u;
const SELF_CLOSING_X_RE = /(?<open><x(?:\b[^>]*)?)\/>/giu;

function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

export function encodeInlineNodes(
  nodes: readonly Node[],
  delta: CompiledSiteDelta
): EncodedInlineSegment {
  const slots: InlineSlot[] = [];

  function serializeNode(node: Node): string {
    if (node.nodeType === 3) {
      return escapeHtml(node.nodeValue ?? "");
    }
    if (node.nodeType !== 1) {
      return "";
    }

    const el = node as Element;
    if (matchesAny(el, delta.removeSelectors)) {
      return "";
    }

    const modifiers = matchModifiers(el, delta);
    const atomic =
      modifiers.has("inline-atomic") ||
      isNonProsePrimitive(el) ||
      !HAS_LETTER.test(el.textContent ?? "");

    const id = slots.length;
    const slot: InlineSlot = { id, element: el, atomic, modifiers };
    slots.push(slot);

    if (atomic) {
      return `<x id="${id}"/>`;
    }

    let inner = "";
    for (const child of Array.from(el.childNodes)) {
      inner += serializeNode(child);
    }
    return `<x id="${id}">${inner}</x>`;
  }

  let payloadHtml = "";
  for (const n of nodes) {
    payloadHtml += serializeNode(n);
  }
  return { payloadHtml, slots };
}

export function decodeTranslatedHtml(
  translatedHtml: string,
  slots: readonly InlineSlot[],
  doc: Document
): DocumentFragment {
  const tpl = doc.createElement("template");
  // HTML5 parser ignores `/>` self-closing on non-void tags; expand `<x .../>`
  // before parsing so trailing text is never swallowed as a child of `<x>`.
  tpl.innerHTML = translatedHtml.replace(SELF_CLOSING_X_RE, "$<open>></x>");

  const slotMap = new Map<number, InlineSlot>();
  for (const s of slots) {
    slotMap.set(s.id, s);
  }

  function rebuildSlot(el: Element, slot: InlineSlot): Element {
    if (slot.atomic) {
      const clone = slot.element.cloneNode(true) as Element;
      clone.setAttribute("data-tr-no-space", "1");
      clone.setAttribute("data-tr-no-opencc", "1");
      return clone;
    }
    const clone = slot.element.cloneNode(false) as Element;
    if (slot.modifiers.has("no-spacing")) {
      clone.setAttribute("data-tr-no-space", "1");
    }
    if (slot.modifiers.has("no-opencc")) {
      clone.setAttribute("data-tr-no-opencc", "1");
    }
    clone.appendChild(rebuild(el));
    return clone;
  }

  function rebuildElement(el: Element): Node {
    const tag = el.tagName.toUpperCase();
    if (tag === "SPAN" && el.hasAttribute("data-ptr-kw")) {
      return rebuild(el);
    }
    if (tag !== "X") {
      return doc.createTextNode(el.textContent ?? "");
    }
    const rawId = el.getAttribute("id");
    const id = rawId === null ? Number.NaN : Number(rawId);
    const slot = slotMap.get(id);
    return slot ? rebuildSlot(el, slot) : rebuild(el);
  }

  function rebuild(sourceParent: ParentNode): DocumentFragment {
    const out = doc.createDocumentFragment();
    for (const child of Array.from(sourceParent.childNodes)) {
      if (child.nodeType === 3) {
        out.appendChild(doc.createTextNode(child.nodeValue ?? ""));
      } else if (child.nodeType === 1) {
        out.appendChild(rebuildElement(child as Element));
      }
    }
    return out;
  }

  return rebuild(tpl.content);
}
