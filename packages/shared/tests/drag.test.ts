import { expect, test } from "bun:test";
import { Event, Window } from "happy-dom";
import { createDragController } from "../src/drag";

const defaultTarget: { current: EventTarget | null } = { current: null };

function pointerEvent(
  type: string,
  opts: {
    clientX?: number;
    clientY?: number;
    button?: number;
    pointerId?: number;
    target?: EventTarget;
  } = {}
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    button: opts.button ?? 0,
    pointerId: opts.pointerId ?? 1,
  });
  const target = (opts.target ?? defaultTarget.current) as EventTarget & {
    setPointerCapture?: () => void;
  };
  Object.defineProperty(event, "target", { value: target, configurable: true });
  target.setPointerCapture = () => {};
  return event;
}

function setup() {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML = `<div id="stage" style="position:relative;width:600px;height:400px"><div id="panel" style="position:absolute;width:100px;height:50px"><div id="handle">Header</div></div></div>`;
  const stage = doc.getElementById("stage") as HTMLElement;
  const panel = doc.getElementById("panel") as HTMLElement;
  const handle = doc.getElementById("handle") as HTMLElement;
  defaultTarget.current = handle;
  // happy-dom has no layout: pin geometry used by the controller.
  Object.defineProperty(stage, "clientWidth", { value: 600 });
  Object.defineProperty(stage, "clientHeight", { value: 400 });
  Object.defineProperty(panel, "getBoundingClientRect", {
    value: () => ({
      left: 0,
      top: 0,
      right: 100,
      bottom: 50,
      width: 100,
      height: 50,
      x: 0,
      y: 0,
    }),
  });
  Object.defineProperty(stage, "getBoundingClientRect", {
    value: () => ({
      left: 0,
      top: 0,
      right: 600,
      bottom: 400,
      width: 600,
      height: 400,
      x: 0,
      y: 0,
    }),
  });
  return {
    stage,
    panel,
    handle,
    ...createDragController({ panel, handle, stage }),
  };
}

test("plain click below threshold never moves the panel", () => {
  const { panel, handle, destroy } = setup();
  handle.dispatchEvent(
    pointerEvent("pointerdown", { clientX: 10, clientY: 10 })
  );
  handle.dispatchEvent(pointerEvent("pointerup", { clientX: 10, clientY: 10 }));
  expect(panel.style.left).toBe("");
  expect(panel.style.top).toBe("");
  destroy();
});

test("drag beyond threshold moves panel and clamps to stage", () => {
  const { panel, handle, destroy } = setup();
  handle.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0 }));
  handle.dispatchEvent(
    pointerEvent("pointermove", { clientX: 200, clientY: 500 })
  );
  // clamped: maxL = 600-100-8 = 492, maxT = 400-50-8 = 342, min 8
  expect(panel.style.left).toBe("200px");
  expect(panel.style.top).toBe("342px");
  handle.dispatchEvent(pointerEvent("pointerup"));
  destroy();
});

test("drag ignores right button and button-element targets", () => {
  const { panel, handle, destroy } = setup();
  handle.dispatchEvent(
    pointerEvent("pointerdown", { clientX: 0, clientY: 0, button: 2 })
  );
  handle.dispatchEvent(
    pointerEvent("pointermove", { clientX: 100, clientY: 100 })
  );
  expect(panel.style.left).toBe("");
  const btn = handle.ownerDocument.createElement("button");
  handle.appendChild(btn);
  handle.dispatchEvent(
    pointerEvent("pointerdown", { clientX: 0, clientY: 0, target: btn })
  );
  handle.dispatchEvent(
    pointerEvent("pointermove", { clientX: 100, clientY: 100 })
  );
  expect(panel.style.left).toBe("");
  destroy();
});
