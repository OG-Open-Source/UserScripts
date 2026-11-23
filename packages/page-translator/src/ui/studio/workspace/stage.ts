import { US_PALETTE_OKLCH } from "@userscripts/shared";

export type StudioZoomPreset = "fit" | "50" | "75" | "100";

export interface StudioStageGeometry {
  bottomHeight: number;
  leftWidth: number;
  rightWidth: number;
  scale: number;
  stageHeight: number;
  stageLeft: number;
  stageTop: number;
  stageWidth: number;
  topHeight: number;
}

export interface StudioStageOptions {
  bottomCollapsed?: boolean;
  zoom?: StudioZoomPreset;
}

export interface StudioStageHandle {
  getGeometry: () => StudioStageGeometry;
  unmount: () => void;
  update: (options?: StudioStageOptions) => StudioStageGeometry;
}

const STAGE_STYLE_ID = "ptr-studio-stage-css";
const STAGE_ATTR = "data-ptr-studio-active";
const TOP_HEIGHT = 40;
const LEFT_WIDTH = 300;
const RIGHT_WIDTH = 340;
const BOTTOM_EXPANDED_HEIGHT = 190;
const BOTTOM_COLLAPSED_HEIGHT = 36;
const MIN_FIT_SCALE = 0.35;
const MAX_FIT_SCALE = 0.92;

function resolveZoomScale(
  zoom: StudioZoomPreset,
  viewportWidth: number,
  viewportHeight: number,
  stageWidth: number,
  stageHeight: number
): number {
  if (zoom === "50") {
    return 0.5;
  }
  if (zoom === "75") {
    return 0.75;
  }
  if (zoom === "100") {
    return 1;
  }
  const widthRatio = stageWidth / Math.max(1, viewportWidth);
  const heightRatio = stageHeight / Math.max(1, viewportHeight);
  const rawFit = Math.min(widthRatio, heightRatio);
  return Math.min(MAX_FIT_SCALE, Math.max(MIN_FIT_SCALE, rawFit));
}

/** Computes the framed top-center stage dimensions and scale for Industrial Studio. */
export function computeStudioStageGeometry(
  viewportWidth: number,
  viewportHeight: number,
  options?: StudioStageOptions
): StudioStageGeometry {
  const bottomHeight = options?.bottomCollapsed
    ? BOTTOM_COLLAPSED_HEIGHT
    : BOTTOM_EXPANDED_HEIGHT;
  const stageLeft = LEFT_WIDTH;
  const stageTop = TOP_HEIGHT;
  const stageWidth = Math.max(0, viewportWidth - LEFT_WIDTH - RIGHT_WIDTH);
  const stageHeight = Math.max(0, viewportHeight - TOP_HEIGHT - bottomHeight);
  const zoom = options?.zoom ?? "fit";
  const scale = resolveZoomScale(
    zoom,
    viewportWidth,
    viewportHeight,
    stageWidth,
    stageHeight
  );

  return {
    bottomHeight,
    leftWidth: LEFT_WIDTH,
    rightWidth: RIGHT_WIDTH,
    scale,
    stageHeight,
    stageLeft,
    stageTop,
    stageWidth,
    topHeight: TOP_HEIGHT,
  };
}

/** Builds the stylesheet that scales the host document body inside the Studio stage. */
export function buildStudioStageCss(geom: StudioStageGeometry): string {
  const unscaledWidth = Math.max(1, Math.round(geom.stageWidth / geom.scale));
  const unscaledHeight = Math.max(1, Math.round(geom.stageHeight / geom.scale));

  return [
    `html[${STAGE_ATTR}="1"] {`,
    `  background: ${US_PALETTE_OKLCH.inkDark} !important;`,
    "  overflow: hidden !important;",
    "  margin: 0 !important;",
    "  padding: 0 !important;",
    "}",
    `html[${STAGE_ATTR}="1"] > body {`,
    "  position: fixed !important;",
    `  top: ${geom.stageTop}px !important;`,
    `  left: ${geom.stageLeft}px !important;`,
    `  width: ${unscaledWidth}px !important;`,
    `  height: ${unscaledHeight}px !important;`,
    `  transform: scale(${geom.scale}) !important;`,
    "  transform-origin: top left !important;",
    "  overflow: auto !important;",
    "  margin: 0 !important;",
    "  box-sizing: border-box !important;",
    "}",
  ].join("\n");
}

function readViewportDimensions(doc: Document): {
  height: number;
  width: number;
} {
  const win = doc.defaultView;
  return {
    height: win?.innerHeight || doc.documentElement.clientHeight || 900,
    width: win?.innerWidth || doc.documentElement.clientWidth || 1440,
  };
}

/** Mounts the Studio stage CSS and active attribute on the host document. */
export function mountStudioStage(
  doc: Document,
  options?: StudioStageOptions
): StudioStageHandle {
  let currentOptions: StudioStageOptions = { ...options };

  const computeCurrent = (): StudioStageGeometry => {
    const viewport = readViewportDimensions(doc);
    return computeStudioStageGeometry(
      viewport.width,
      viewport.height,
      currentOptions
    );
  };

  let currentGeom = computeCurrent();
  doc.documentElement.setAttribute(STAGE_ATTR, "1");

  let styleEl = doc.querySelector(
    `#${STAGE_STYLE_ID}`
  ) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = doc.createElement("style");
    styleEl.id = STAGE_STYLE_ID;
    (doc.head ?? doc.documentElement).appendChild(styleEl);
  }
  styleEl.textContent = buildStudioStageCss(currentGeom);

  return {
    getGeometry: () => currentGeom,
    unmount: () => {
      doc.querySelector(`#${STAGE_STYLE_ID}`)?.remove();
      doc.documentElement.removeAttribute(STAGE_ATTR);
    },
    update: (nextOptions?: StudioStageOptions) => {
      currentOptions = { ...currentOptions, ...nextOptions };
      currentGeom = computeCurrent();
      const targetStyle = doc.querySelector(`#${STAGE_STYLE_ID}`);
      if (targetStyle) {
        targetStyle.textContent = buildStudioStageCss(currentGeom);
      }
      return currentGeom;
    },
  };
}
