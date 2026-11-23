import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  decodeTranslatedHtml,
  encodeInlineNodes,
} from "../../src/capture/inline-codec";
import { collectSegments } from "../../src/capture/segmenter";
import { parseSiteDelta } from "../../src/structure/site-rules";

const FIXTURE =
  '<div>Plain <span>nested <strong>inline</strong></span> <x data-atomic="">*</x> tail</div>';
const SEGMENT_ID_PATTERN = /^seg-\d+$/u;
const TRANSLATED_HTML =
  '译文 <x id="0">嵌套 <x id="1">行内</x></x> <x id="2"/> 末尾';

function setupFixture() {
  const win = new Window();
  win.document.body.innerHTML = FIXTURE;
  const doc = win.document as unknown as Document;
  const { body } = doc;
  const getStyle = (el: Element) => ({
    display:
      (el as HTMLElement).style.display ||
      (el.tagName === "BODY" || el.tagName === "DIV" ? "block" : "inline"),
    visibility: (el as HTMLElement).style.visibility || "visible",
  });
  return { body, doc, getStyle };
}

function fragmentHtml(fragment: DocumentFragment, doc: Document): string {
  const container = doc.createElement("div");
  container.appendChild(fragment);
  return container.innerHTML;
}

test("v4 collectSegments captures plain, nested inline, and atomic nodes in one segment", () => {
  const { body, getStyle } = setupFixture();
  const delta = parseSiteDelta("");
  const segments = collectSegments(body, delta, { getStyle });

  expect(segments).toHaveLength(1);
  const [segment] = segments;
  if (!segment) {
    throw new Error("Expected one segment");
  }
  expect(segment.id).toMatch(SEGMENT_ID_PATTERN);
  expect(segment.container.tagName).toBe("DIV");
  expect(segment.sourceRule).toBe("auto");
  expect(segment.displayContents).toBe(false);
  expect(segment.nodes).toHaveLength(5);
});

test("v4 inline codec round-trips plain, nested inline, and atomic slots", () => {
  const { body, doc, getStyle } = setupFixture();
  const delta = parseSiteDelta("");
  const segments = collectSegments(body, delta, { getStyle });
  expect(segments).toHaveLength(1);
  const [segment] = segments;
  if (!segment) {
    throw new Error("Expected one segment");
  }

  const encoded = encodeInlineNodes(segment.nodes, delta);
  expect(encoded.payloadHtml).toBe(
    'Plain <x id="0">nested <x id="1">inline</x></x> <x id="2"/> tail'
  );
  expect(encoded.slots.map((s) => ({ id: s.id, atomic: s.atomic }))).toEqual([
    { id: 0, atomic: false },
    { id: 1, atomic: false },
    { id: 2, atomic: true },
  ]);

  const decoded = decodeTranslatedHtml(TRANSLATED_HTML, encoded.slots, doc);
  expect(fragmentHtml(decoded, doc)).toBe(
    '译文 <span>嵌套 <strong>行内</strong></span> <x data-atomic="" data-tr-no-space="1" data-tr-no-opencc="1">*</x> 末尾'
  );
});
