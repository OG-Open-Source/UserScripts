import type { CompiledSiteDelta, SiteModifier } from "../legacy/site-rules";
import { matchesAny, matchModifiers } from "../legacy/site-rules";
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
  tpl.innerHTML = translatedHtml.replace(
    /<x(?<attributes>\b[^>]*)?\/>/giu,
    "<x$<attributes>></x>"
  );

  const slotMap = new Map<number, InlineSlot>();
  for (const s of slots) {
    slotMap.set(s.id, s);
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Verbatim legacy port covered by parity tests.
  function rebuild(sourceParent: ParentNode): DocumentFragment {
    const out = doc.createDocumentFragment();
    for (const child of Array.from(sourceParent.childNodes)) {
      if (child.nodeType === 3) {
        out.appendChild(doc.createTextNode(child.nodeValue ?? ""));
        continue;
      }
      if (child.nodeType !== 1) {
        continue;
      }

      const el = child as Element;
      if (
        el.tagName.toUpperCase() === "SPAN" &&
        el.hasAttribute("data-ptr-kw")
      ) {
        out.appendChild(rebuild(el));
        continue;
      }
      if (el.tagName.toUpperCase() === "X") {
        const rawId = el.getAttribute("id");
        const id = rawId === null ? Number.NaN : Number(rawId);
        const slot = slotMap.get(id);
        if (!slot) {
          out.appendChild(rebuild(el));
          continue;
        }
        if (slot.atomic) {
          const clone = slot.element.cloneNode(true) as Element;
          const excluded =
            isNonProsePrimitive(slot.element) ||
            !HAS_LETTER.test(slot.element.textContent ?? "");
          if (excluded || slot.modifiers.has("no-spacing")) {
            clone.setAttribute("data-tr-no-space", "1");
          }
          if (excluded || slot.modifiers.has("no-opencc")) {
            clone.setAttribute("data-tr-no-opencc", "1");
          }
          out.appendChild(clone);
        } else {
          const clone = slot.element.cloneNode(false) as Element;
          if (slot.modifiers.has("no-spacing")) {
            clone.setAttribute("data-tr-no-space", "1");
          }
          if (slot.modifiers.has("no-opencc")) {
            clone.setAttribute("data-tr-no-opencc", "1");
          }
          clone.appendChild(rebuild(el));
          out.appendChild(clone);
        }
      } else {
        out.appendChild(doc.createTextNode(el.textContent ?? ""));
      }
    }
    return out;
  }

  return rebuild(tpl.content);
}
