import "../../lit-dom";

import { US_PALETTE_OKLCH } from "@userscripts/shared";
import { html, nothing } from "lit";
import type { LiveCaptureCandidate } from "../../../capture/export";
import { renderLit } from "../../lit-render";
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

const LABEL_BASE_STYLE = [
  "position:absolute",
  "top:-16px",
  "left:0",
  "padding:1px 5px",
  "font-size:10px",
  "line-height:14px",
  "font-family:ui-monospace,SFMono-Regular,monospace",
  `background:${US_PALETTE_OKLCH.accent}`,
  `color:${US_PALETTE_OKLCH.inkDark}`,
  "border-radius:3px",
  "white-space:nowrap",
].join(";");

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

function resolveBoxVisuals(box: ProjectedBox): {
  active: boolean;
  background: string;
  border: string;
} {
  const active = box.selected || box.hovered;
  if (active) {
    return {
      active,
      border: `2px solid ${US_PALETTE_OKLCH.accent}`,
      background: "oklch(0.68 0.19 46 / 0.14)",
    };
  }
  if (box.included) {
    return {
      active,
      border: `1px solid ${US_PALETTE_OKLCH.accentSoft}`,
      background: "oklch(0.75 0.15 55 / 0.06)",
    };
  }
  return {
    active,
    border: `1px dashed ${US_PALETTE_OKLCH.mutedDark}`,
    background: "transparent",
  };
}

function renderBox(box: ProjectedBox) {
  const { active, background, border } = resolveBoxVisuals(box);
  const boxStyle = [
    "position:fixed",
    "pointer-events:none",
    "box-sizing:border-box",
    `left:${box.left}px`,
    `top:${box.top}px`,
    `width:${box.width}px`,
    `height:${box.height}px`,
    `border:${border}`,
    `background:${background}`,
    `z-index:${active ? "2" : "1"}`,
  ].join(";");

  return html`
    <div
      data-box-index=${String(box.index)}
      data-included=${box.included ? "1" : "0"}
      data-selected=${box.selected ? "1" : nothing}
      data-hovered=${box.hovered ? "1" : nothing}
      style=${boxStyle}
    >
      ${active ? html`<span style=${LABEL_BASE_STYLE}>${box.label}</span>` : nothing}
    </div>
  `;
}

/** Renders projected bounding boxes into the Studio overlay layer with Lit. */
export function renderOverlayBoxes(
  layer: HTMLElement,
  doc: Document,
  boxes: readonly ProjectedBox[]
): void {
  renderLit(html`${boxes.map(renderBox)}`, layer, doc);
}
