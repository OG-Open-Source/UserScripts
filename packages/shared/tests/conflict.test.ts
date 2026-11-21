import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  isForeignUi,
  isUsUiEvent,
  markUiRoot,
  US_UI_ATTR,
} from "../src/conflict";

test("markUiRoot tags data-us-ui and translate=no", () => {
  const win = new Window();
  const el = win.document.createElement("div");
  markUiRoot(el as unknown as Element, "h1dl");
  expect(el.getAttribute(US_UI_ATTR)).toBe("h1dl");
  expect(el.getAttribute("translate")).toBe("no");
});

test("isForeignUi detects our own UI, notranslate, and icon-font elements, while prose is false", () => {
  const win = new Window();
  const stage = win.document.createElement("div");
  stage.innerHTML = `
    <div data-us-ui="h1dl"><span class="h1dl-label">64%</span></div>
    <i class="material-icons">download</i>
    <span class="material-symbols-outlined">settings</span>
    <span translate="no">Untranslated</span>
    <p id="prose">Hello world</p>
  `;
  expect(
    isForeignUi(stage.querySelector(".h1dl-label") as unknown as Element)
  ).toBe(true);
  expect(
    isForeignUi(stage.querySelector(".material-icons") as unknown as Element)
  ).toBe(true);
  expect(
    isForeignUi(
      stage.querySelector(".material-symbols-outlined") as unknown as Element
    )
  ).toBe(true);
  expect(
    isForeignUi(stage.querySelector("[translate='no']") as unknown as Element)
  ).toBe(true);
  expect(isForeignUi(stage.querySelector("#prose") as unknown as Element)).toBe(
    false
  );
});

test("isUsUiEvent recognizes events originating from any [data-us-ui] host", () => {
  const win = new Window();
  const host = win.document.createElement("div");
  markUiRoot(host as unknown as Element, "h1dl");
  const child = win.document.createElement("button");
  host.appendChild(child);
  win.document.body.appendChild(host);

  let seenOnHost = false;
  child.addEventListener("click", (ev) => {
    seenOnHost = isUsUiEvent(ev as unknown as Event);
  });
  child.click();
  expect(seenOnHost).toBe(true);
});
