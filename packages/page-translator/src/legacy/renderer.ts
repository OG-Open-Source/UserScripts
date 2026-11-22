import type { InlineSlot } from "./capture/inline-codec";
import { decodeTranslatedHtml } from "./capture/inline-codec";
import type { TranslationSegment } from "./capture/segmenter";
import type { PunctNormMode, SpacingMode } from "./config";
import {
  applyPunctNormToFragment,
  applySpacingToFragment,
} from "./transform/spacing";

const segmentHostMap = new WeakMap<TranslationSegment, HTMLElement>();

export type InspectKind = "auto-static" | "auto-dynamic" | "+" | "manual";

export interface InspectMeta {
  kind: InspectKind;
  spacingMode?: SpacingMode;
}

function applyOpenCCToFragment(
  root: Node,
  convert: (text: string) => string,
  inheritedSkip = false
): void {
  if (root.nodeType === 3) {
    if (!inheritedSkip && root.nodeValue) {
      root.nodeValue = convert(root.nodeValue);
    }
    return;
  }
  if (root.nodeType !== 1 && root.nodeType !== 11) {
    return;
  }

  let skip = inheritedSkip;
  if (
    root.nodeType === 1 &&
    (root as Element).hasAttribute("data-tr-no-opencc")
  ) {
    skip = true;
  }
  for (const child of Array.from(root.childNodes)) {
    applyOpenCCToFragment(child, convert, skip);
  }
}

export function renderPending(
  seg: TranslationSegment,
  doc: Document
): HTMLElement {
  const existing = segmentHostMap.get(seg);
  if (existing) {
    return existing;
  }

  const firstNode = seg.nodes[0];
  const parent = firstNode?.parentNode ?? seg.container;

  const blockEl = doc.createElement("span");
  blockEl.setAttribute("data-tr-block", seg.sourceRule);
  blockEl.setAttribute("data-tr-id", seg.id);
  blockEl.setAttribute("data-tr-state", "pending");
  if (seg.modifiers.size > 0) {
    blockEl.setAttribute("data-tr-mod", [...seg.modifiers].join(" "));
  }

  const origEl = doc.createElement("span");
  origEl.setAttribute("data-tr-orig", "");

  const dstEl = doc.createElement("span");
  dstEl.setAttribute("data-tr-dst", "");

  if (firstNode && firstNode.parentNode === parent) {
    parent.insertBefore(blockEl, firstNode);
  } else {
    parent.appendChild(blockEl);
  }

  for (const n of seg.nodes) {
    origEl.appendChild(n);
  }

  blockEl.appendChild(origEl);
  blockEl.appendChild(dstEl);
  segmentHostMap.set(seg, blockEl);
  return blockEl;
}

export interface RenderPostProcess {
  debugSpacingMarks?: boolean;
  opencc?: (s: string) => string;
  punctNorm?: PunctNormMode;
  spacing?: boolean;
  spacingMode?: SpacingMode;
}

export function renderTranslated(
  seg: TranslationSegment,
  translatedHtml: string,
  slots: readonly InlineSlot[],
  postProcess: RenderPostProcess,
  doc: Document
): void {
  const blockEl = renderPending(seg, doc);
  const dstEl = blockEl.querySelector("[data-tr-dst]");
  if (!dstEl) {
    return;
  }

  const frag = decodeTranslatedHtml(translatedHtml, slots, doc);
  if (postProcess.opencc && !seg.modifiers.has("no-opencc")) {
    applyOpenCCToFragment(frag, postProcess.opencc);
  }
  if (
    postProcess.punctNorm &&
    postProcess.punctNorm !== "off" &&
    !seg.modifiers.has("no-opencc")
  ) {
    applyPunctNormToFragment(frag, postProcess.punctNorm);
  }

  const spacingMode =
    postProcess.spacingMode ?? (postProcess.spacing ? "js" : "off");
  const useJsSpacing =
    (spacingMode === "js" || spacingMode === "both") &&
    !seg.modifiers.has("no-spacing");
  if (useJsSpacing) {
    applySpacingToFragment(frag, { debugMarks: postProcess.debugSpacingMarks });
  }

  dstEl.textContent = "";
  dstEl.appendChild(frag);
  blockEl.setAttribute("data-tr-state", "done");
}

export function renderError(seg: TranslationSegment, doc: Document): void {
  const blockEl = segmentHostMap.get(seg) ?? renderPending(seg, doc);
  blockEl.setAttribute("data-tr-state", "error");
}

export function renderInspectMarker(
  seg: TranslationSegment,
  _doc: Document,
  meta?: InspectMeta
): void {
  seg.container.setAttribute("data-tr-inspect", seg.sourceRule);
  const effectiveSpace = seg.modifiers.has("no-spacing")
    ? "no-spacing"
    : meta?.spacingMode;
  if (meta?.kind) {
    seg.container.setAttribute("data-tr-inspect-kind", meta.kind);
  }
  if (effectiveSpace) {
    seg.container.setAttribute("data-tr-inspect-space", effectiveSpace);
  }
  if (seg.modifiers.size > 0) {
    seg.container.setAttribute(
      "data-tr-inspect-mods",
      [...seg.modifiers].join(" ")
    );
  }
  const labelParts: string[] = [meta?.kind ?? seg.sourceRule];
  if (effectiveSpace) {
    labelParts.push(`space:${effectiveSpace}`);
  }
  if (seg.modifiers.size > 0) {
    labelParts.push(`mods:${[...seg.modifiers].join(",")}`);
  }
  seg.container.setAttribute("data-tr-inspect-label", labelParts.join(" | "));
}

export function restoreAll(root: ParentNode): void {
  for (const inspected of Array.from(
    root.querySelectorAll("[data-tr-inspect]")
  )) {
    inspected.removeAttribute("data-tr-inspect");
    inspected.removeAttribute("data-tr-inspect-kind");
    inspected.removeAttribute("data-tr-inspect-space");
    inspected.removeAttribute("data-tr-inspect-mods");
    inspected.removeAttribute("data-tr-inspect-label");
  }

  for (const block of Array.from(root.querySelectorAll("[data-tr-block]"))) {
    const parent = block.parentNode;
    const orig = block.querySelector("[data-tr-orig]");
    if (parent && orig) {
      while (orig.firstChild) {
        parent.insertBefore(orig.firstChild, block);
      }
    }
    block.remove();
  }
}
