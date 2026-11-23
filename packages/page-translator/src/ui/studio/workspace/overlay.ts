import { US_PALETTE_OKLCH } from "@userscripts/shared";
import type { LiveCaptureCandidate } from "../../../capture/export";
import type { StudioStageGeometry } from "./stage";

export type StudioBoxMode = "all" | "included" | "excluded" | "off";

export interface ProjectedBox {
  classification: string;
  excludeReason: string | null;
  height: number;
  hovered: boolean;
  included: boolean;
  index: number;
  label: string;
  left: number;
  region: string;
  selected: boolean;
  top: number;
  width: number;
}

const DEFAULT_MAX_BOXES = 300;

function formatRegion(region: string | string[] | null): string {
  if (Array.isArray(region)) {
    return region.join(",");
  }
  return region ?? "";
}

function matchesBoxMode(included: boolean, boxMode: StudioBoxMode): boolean {
  if (boxMode === "included") {
    return included;
  }
  if (boxMode === "excluded") {
    return !included;
  }
  return boxMode === "all";
}

function capProjectedBoxes(
  boxes: readonly ProjectedBox[],
  maxBoxes: number
): ProjectedBox[] {
  if (boxes.length <= maxBoxes) {
    return [...boxes];
  }
  if (maxBoxes <= 0) {
    return [];
  }

  const priorityIndices = new Set<number>();
  for (let idx = 0; idx < boxes.length; idx += 1) {
    const box = boxes[idx];
    if (box && (box.selected || box.hovered)) {
      priorityIndices.add(idx);
    }
  }

  const keptIndices = new Set<number>();
  for (const idx of priorityIndices) {
    if (keptIndices.size < maxBoxes) {
      keptIndices.add(idx);
    }
  }
  for (
    let idx = 0;
    idx < boxes.length && keptIndices.size < maxBoxes;
    idx += 1
  ) {
    keptIndices.add(idx);
  }

  return boxes.filter((_, idx) => keptIndices.has(idx));
}

/** Projects visible LiveCaptureCandidate rects clamped to the Studio stage bounds. */
export function projectCandidateBoxes(
  entries: readonly LiveCaptureCandidate[],
  stage: StudioStageGeometry,
  options: {
    boxMode: StudioBoxMode;
    hoveredIndex: number | null;
    maxBoxes?: number;
    selectedIndex: number | null;
  }
): ProjectedBox[] {
  if (options.boxMode === "off") {
    return [];
  }

  const stageRight = stage.stageLeft + stage.stageWidth;
  const stageBottom = stage.stageTop + stage.stageHeight;
  const projected: ProjectedBox[] = [];

  for (const entry of entries) {
    const { candidate, element, index } = entry;
    if (!matchesBoxMode(candidate.included, options.boxMode)) {
      continue;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }

    const left = Math.max(stage.stageLeft, rect.left);
    const top = Math.max(stage.stageTop, rect.top);
    const right = Math.min(stageRight, rect.right);
    const bottom = Math.min(stageBottom, rect.bottom);
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) {
      continue;
    }

    projected.push({
      classification: candidate.classification,
      excludeReason: candidate.excludeReason,
      height,
      hovered: index === options.hoveredIndex,
      included: candidate.included,
      index,
      label: element.tagName.toLowerCase(),
      left,
      region: formatRegion(candidate.region),
      selected: index === options.selectedIndex,
      top,
      width,
    });
  }

  const maxBoxes = options.maxBoxes ?? DEFAULT_MAX_BOXES;
  return capProjectedBoxes(projected, maxBoxes);
}

/** Renders projected bounding boxes into the Studio overlay layer without innerHTML. */
export function renderOverlayBoxes(
  layer: HTMLElement,
  doc: Document,
  boxes: readonly ProjectedBox[]
): void {
  layer.replaceChildren();

  for (const box of boxes) {
    const node = doc.createElement("div");
    node.setAttribute("data-box-index", String(box.index));
    node.setAttribute("data-included", box.included ? "1" : "0");
    if (box.selected) {
      node.setAttribute("data-selected", "1");
    }
    if (box.hovered) {
      node.setAttribute("data-hovered", "1");
    }

    const active = box.selected || box.hovered;
    let border = `1px dashed ${US_PALETTE_OKLCH.mutedDark}`;
    let background = "transparent";
    if (active) {
      border = `2px solid ${US_PALETTE_OKLCH.accent}`;
      background = "oklch(0.68 0.19 46 / 0.14)";
    } else if (box.included) {
      border = `1px solid ${US_PALETTE_OKLCH.accentSoft}`;
      background = "oklch(0.75 0.15 55 / 0.06)";
    }

    node.style.position = "fixed";
    node.style.pointerEvents = "none";
    node.style.boxSizing = "border-box";
    node.style.left = `${box.left}px`;
    node.style.top = `${box.top}px`;
    node.style.width = `${box.width}px`;
    node.style.height = `${box.height}px`;
    node.style.border = border;
    node.style.background = background;
    node.style.zIndex = active ? "2" : "1";

    if (active) {
      const tag = doc.createElement("span");
      tag.textContent = box.label;
      tag.style.position = "absolute";
      tag.style.top = "-16px";
      tag.style.left = "0";
      tag.style.padding = "1px 5px";
      tag.style.fontSize = "10px";
      tag.style.lineHeight = "14px";
      tag.style.fontFamily = "ui-monospace, SFMono-Regular, monospace";
      tag.style.background = US_PALETTE_OKLCH.accent;
      tag.style.color = US_PALETTE_OKLCH.inkDark;
      tag.style.borderRadius = "3px";
      tag.style.whiteSpace = "nowrap";
      node.appendChild(tag);
    }

    layer.appendChild(node);
  }
}
