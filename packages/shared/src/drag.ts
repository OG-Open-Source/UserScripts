/**
 * Click-safe draggable panel controller.
 *
 * Guarantees (from the approved design):
 * - A plain click never moves the panel: dragging arms only after the pointer
 *   travels past `thresholdPx` (default 3).
 * - Origin is computed relative to the stage's padding box so border/scroll
 *   offsets (and mixed-DPI rounding via getBoundingClientRect) cannot drift
 *   the panel toward the bottom-right on repeated clicks.
 * - Position clamps inside the stage (or the viewport when no stage given).
 */

export interface DragControllerOptions {
  handle: HTMLElement;
  /** Minimum distance kept from the stage edges. */
  padding?: number;
  panel: HTMLElement;
  /** Container to clamp within; falls back to the viewport when null. */
  stage: HTMLElement | null;
  thresholdPx?: number;
}

interface DragState {
  armed: boolean;
  maxL: number;
  maxT: number;
  origL: number;
  origT: number;
  startX: number;
  startY: number;
}

export function createDragController(options: DragControllerOptions): {
  destroy: () => void;
} {
  const { panel, handle, stage } = options;
  const threshold = options.thresholdPx ?? 3;
  const padding = options.padding ?? 8;
  let drag: DragState | null = null;

  function originOf(target: HTMLElement): { left: number; top: number } {
    const tRect = target.getBoundingClientRect();
    if (!stage) {
      return { left: tRect.left, top: tRect.top };
    }
    const sRect = stage.getBoundingClientRect();
    return {
      left: tRect.left - (sRect.left + stage.clientLeft),
      top: tRect.top - (sRect.top + stage.clientTop),
    };
  }

  function clampBounds(panelRect: DOMRect): { maxL: number; maxT: number } {
    if (!stage) {
      const view = panel.ownerDocument.defaultView;
      return {
        maxL: (view?.innerWidth ?? panelRect.right) - panelRect.width - padding,
        maxT:
          (view?.innerHeight ?? panelRect.bottom) - panelRect.height - padding,
      };
    }
    return {
      maxL: stage.clientWidth - panelRect.width - padding,
      maxT: stage.clientHeight - panelRect.height - padding,
    };
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) {
      return;
    }
    const target = e.target as Element | null;
    if (target?.closest?.("button, input, textarea, select, a")) {
      return;
    }
    const panelRect = panel.getBoundingClientRect();
    const origin = originOf(panel);
    handle.setPointerCapture?.(e.pointerId);
    drag = {
      armed: false,
      startX: e.clientX,
      startY: e.clientY,
      origL: origin.left,
      origT: origin.top,
      ...clampBounds(panelRect),
    };
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drag) {
      return;
    }
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.armed) {
      if (Math.hypot(dx, dy) < threshold) {
        return;
      }
      drag.armed = true;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      handle.classList.add("dragging");
    }
    panel.style.left = `${Math.max(padding, Math.min(drag.maxL, drag.origL + dx))}px`;
    panel.style.top = `${Math.max(padding, Math.min(drag.maxT, drag.origT + dy))}px`;
  }

  function endDrag(): void {
    drag = null;
    handle.classList.remove("dragging");
  }

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);

  return {
    destroy() {
      handle.removeEventListener("pointerdown", onPointerDown);
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", endDrag);
      handle.removeEventListener("pointercancel", endDrag);
    },
  };
}
