import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  decodeTranslatedHtml,
  encodeInlineNodes,
} from "../../src/capture/inline-codec";
import { collectSegments } from "../../src/capture/segmenter";
import {
  decodeTranslatedHtml as decodeLegacyTranslatedHtml,
  encodeInlineNodes as encodeLegacyInlineNodes,
} from "../../src/legacy/capture/inline-codec";
import { collectSegments as collectLegacySegments } from "../../src/legacy/capture/segmenter";
import { parseSiteDelta } from "../../src/legacy/site-rules";

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

function segmentSnapshot(segments: ReturnType<typeof collectSegments>) {
  return segments.map((segment) => ({
    container: segment.container.outerHTML,
    displayContents: segment.displayContents,
    modifiers: [...segment.modifiers].sort((a, b) => a.localeCompare(b)),
    nodes: segment.nodes.map((node) =>
      node.nodeType === 1 ? (node as Element).outerHTML : node.nodeValue
    ),
    sourceRule: segment.sourceRule,
  }));
}

function fragmentHtml(fragment: DocumentFragment, doc: Document): string {
  const container = doc.createElement("div");
  container.appendChild(fragment);
  return container.innerHTML;
}

test("ported collectSegments matches legacy structure for the fixed fixture", () => {
  const legacy = setupFixture();
  const ported = setupFixture();
  const delta = parseSiteDelta("");
  const legacySegments = collectLegacySegments(legacy.body, delta, {
    getStyle: legacy.getStyle,
  });
  const portedSegments = collectSegments(ported.body, delta, {
    getStyle: ported.getStyle,
  });

  for (const segment of [...legacySegments, ...portedSegments]) {
    expect(segment.id).toMatch(SEGMENT_ID_PATTERN);
  }
  expect(segmentSnapshot(portedSegments)).toEqual(
    segmentSnapshot(legacySegments)
  );
});

test("ported inline codec matches legacy encoding and decoding", () => {
  const legacy = setupFixture();
  const ported = setupFixture();
  const delta = parseSiteDelta("");
  const legacySegments = collectLegacySegments(legacy.body, delta, {
    getStyle: legacy.getStyle,
  });
  const portedSegments = collectSegments(ported.body, delta, {
    getStyle: ported.getStyle,
  });
  expect(legacySegments).toHaveLength(1);
  expect(portedSegments).toHaveLength(1);
  const [legacySegment] = legacySegments;
  const [portedSegment] = portedSegments;
  if (!(legacySegment && portedSegment)) {
    throw new Error("Expected one segment from each implementation");
  }
  const legacyEncoded = encodeLegacyInlineNodes(legacySegment.nodes, delta);
  const portedEncoded = encodeInlineNodes(portedSegment.nodes, delta);

  expect(portedEncoded.payloadHtml).toBe(legacyEncoded.payloadHtml);
  expect(
    portedEncoded.slots.map((slot) => ({
      atomic: slot.atomic,
      element: slot.element.outerHTML,
      id: slot.id,
      modifiers: [...slot.modifiers].sort((a, b) => a.localeCompare(b)),
    }))
  ).toEqual(
    legacyEncoded.slots.map((slot) => ({
      atomic: slot.atomic,
      element: slot.element.outerHTML,
      id: slot.id,
      modifiers: [...slot.modifiers].sort((a, b) => a.localeCompare(b)),
    }))
  );

  const legacyDecoded = decodeLegacyTranslatedHtml(
    TRANSLATED_HTML,
    legacyEncoded.slots,
    legacy.doc
  );
  const portedDecoded = decodeTranslatedHtml(
    TRANSLATED_HTML,
    portedEncoded.slots,
    ported.doc
  );
  expect(fragmentHtml(portedDecoded, ported.doc)).toBe(
    fragmentHtml(legacyDecoded, legacy.doc)
  );
});
