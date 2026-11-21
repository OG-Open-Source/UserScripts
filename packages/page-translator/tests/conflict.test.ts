import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { collectSegments } from "../src/capture/segmenter";
import { parseSiteDelta } from "../src/site-rules";

test("collectSegments skips foreign [data-us-ui] roots and icon fonts while capturing real prose", () => {
  const win = new Window();
  win.document.body.innerHTML = `
    <div data-us-ui="h1dl" translate="no">
      <span class="h1dl-label">64%</span>
      <button type="button">Download selected</button>
    </div>
    <i class="material-icons">download</i>
    <span class="material-symbols-outlined">settings</span>
    <div id="prose">Real content to translate</div>
  `;

  const segs = collectSegments(
    win.document.body as unknown as Element,
    parseSiteDelta(""),
    {
      getStyle: (el) => ({
        display:
          el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
        visibility: "visible",
      }),
    }
  );

  expect(segs.length).toBe(1);
  expect(segs[0]?.container.id).toBe("prose");
});
