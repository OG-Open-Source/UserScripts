import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  decodeTranslatedHtml,
  encodeInlineNodes,
} from "../../src/capture/inline-codec";
import { collectSegments } from "../../src/capture/segmenter";
import { parseSiteDelta } from "../../src/structure/site-rules";

function setupDoc(html: string) {
  const win = new Window();
  win.document.body.innerHTML = html;
  const body = win.document.body as unknown as Element;
  const getStyle = (el: Element) => {
    const inlineDisplay = (el as unknown as HTMLElement).style?.display;
    const inlineVis = (el as unknown as HTMLElement).style?.visibility;
    const cls = el.getAttribute("data-disp");
    const tag = el.tagName;
    const blockTags = new Set([
      "BODY",
      "DIV",
      "SECTION",
      "ARTICLE",
      "P",
      "LI",
      "H1",
    ]);
    const display =
      inlineDisplay || cls || (blockTags.has(tag) ? "block" : "inline");
    return { display, visibility: inlineVis || "visible" };
  };
  return { win, doc: win.document as unknown as Document, body, getStyle };
}

test("captures custom elements and div/span paragraphs purely via display role", () => {
  const { body, getStyle } = setupDoc(`
    <x-post data-disp="block">Hello <x-em data-disp="inline">custom</x-em> world.</x-post>
    <div class="plain">Second paragraph in a div.</div>
  `);
  const segs = collectSegments(body, parseSiteDelta(""), { getStyle });
  expect(segs.length).toBe(2);
  expect(segs[0]?.container.tagName).toBe("X-POST");
  expect(segs[0]?.nodes.map((n) => n.textContent).join("")).toBe(
    "Hello custom world."
  );
  expect(segs[1]?.container.tagName).toBe("DIV");
  expect(segs[1]?.nodes.map((n) => n.textContent).join("")).toBe(
    "Second paragraph in a div."
  );
});

test("splits mixed inline+block container into independent runs around nested block", () => {
  const { body, getStyle } = setupDoc(`
    <div class="post">Intro text <div class="quoted">Nested block</div> trailing text</div>
  `);
  const segs = collectSegments(body, parseSiteDelta(""), { getStyle });
  expect(segs.length).toBe(3);
  expect(
    segs.map((s) =>
      s.nodes
        .map((n) => n.textContent)
        .join("")
        .trim()
    )
  ).toEqual(["Intro text", "Nested block", "trailing text"]);
});

test("skips hidden, visibility:hidden, contenteditable, script, style, textarea, svg, and '-' exclusions", () => {
  const { body, getStyle } = setupDoc(`
    <div style="display:none">Hidden text</div>
    <div style="visibility:hidden">Invisible text</div>
    <div contenteditable="true">Editable text</div>
    <script>const secret = "skip";</script>
    <style>.a { color: red; }</style>
    <textarea>Form value</textarea>
    <svg><text>Icon label</text></svg>
    <div class="sidebar">Excluded sidebar</div>
    <div class="main">Visible paragraph.</div>
  `);
  const delta = parseSiteDelta("- .sidebar");
  const segs = collectSegments(body, delta, { getStyle });
  expect(segs.length).toBe(1);
  expect(segs[0]?.nodes.map((n) => n.textContent).join("")).toBe(
    "Visible paragraph."
  );
});

test("forces capture via '+' delta even for pure-number inline buttons", () => {
  const { body, getStyle } = setupDoc(`
    <div><button class="count">42</button><button class="other">99</button></div>
  `);
  const delta = parseSiteDelta("+ button.count");
  const segs = collectSegments(body, delta, { getStyle });
  expect(segs.length).toBe(1);
  expect(segs[0]?.sourceRule).toBe("+");
  expect(segs[0]?.nodes.map((n) => n.textContent).join("")).toBe("42");
});

test("applies '*' modifiers (block boundary & inline-atomic placeholder)", () => {
  const { body, doc, getStyle } = setupDoc(`
    <div>Lead <span class="card" data-disp="inline-block">Card text</span> tail</div>
    <div class="p">Use <span class="tok">myVar</span> here.</div>
  `);
  const delta = parseSiteDelta(`
    * .card : block
    * .tok : inline-atomic
  `);
  const segs = collectSegments(body, delta, { getStyle });
  expect(segs.length).toBe(4);
  expect(segs[1]?.modifiers.has("block")).toBe(true);

  const [, , , tokSeg] = segs;
  if (!tokSeg) {
    throw new Error("expected segs[3]");
  }
  const encoded = encodeInlineNodes(tokSeg.nodes, delta);
  expect(encoded.payloadHtml).toBe('Use <x id="0"/> here.');
  const frag = decodeTranslatedHtml(
    '使用 <x id="0"/> 在此。',
    encoded.slots,
    doc
  );
  const tokEl = frag.querySelector("span.tok");
  expect(tokEl?.textContent).toBe("myVar");
  expect(frag.textContent).toBe("使用 myVar 在此。");
});

test("ignores already-wrapped [data-tr-block] / [data-tr-orig] / [data-tr-dst] subtrees", () => {
  const { body, getStyle } = setupDoc(`
    <div data-tr-block="1">
      <span data-tr-orig="">Original text</span>
      <span data-tr-dst="">Translated text</span>
    </div>
    <div>Fresh paragraph.</div>
  `);
  const segs = collectSegments(body, parseSiteDelta(""), { getStyle });
  expect(segs.length).toBe(1);
  expect(segs[0]?.nodes.map((n) => n.textContent).join("")).toBe(
    "Fresh paragraph."
  );
});

test("inline-codec preserves <a> href and class across encode -> translate -> decode", () => {
  const { body, doc, getStyle } = setupDoc(`
    <div>Hello <a href="/u" class="lnk">world</a>!</div>
  `);
  const delta = parseSiteDelta("");
  const segs = collectSegments(body, delta, { getStyle });
  expect(segs.length).toBe(1);
  const [firstSeg] = segs;
  if (!firstSeg) {
    throw new Error("expected first segment");
  }
  const encoded = encodeInlineNodes(firstSeg.nodes, delta);
  expect(encoded.payloadHtml).toBe('Hello <x id="0">world</x>!');

  const frag = decodeTranslatedHtml(
    '你好 <x id="0">世界</x>！',
    encoded.slots,
    doc
  );
  const a = frag.querySelector("a");
  expect(a?.getAttribute("href")).toBe("/u");
  expect(a?.getAttribute("class")).toBe("lnk");
  expect(a?.textContent).toBe("世界");
  expect(frag.textContent).toBe("你好 世界！");
});

test("collectSegments skips subtree when an ancestor is excluded or hidden (mutation root check)", () => {
  const { win, getStyle } = setupDoc(`
    <div class="sidebar"><div class="dynamic-child">Should stay excluded</div></div>
    <div style="display:none"><div class="hidden-child">Should stay hidden</div></div>
  `);
  const delta = parseSiteDelta("- .sidebar");
  const dyn = win.document.querySelector(
    ".dynamic-child"
  ) as unknown as Element;
  const hid = win.document.querySelector(".hidden-child") as unknown as Element;
  expect(collectSegments(dyn, delta, { getStyle }).length).toBe(0);
  expect(collectSegments(hid, delta, { getStyle }).length).toBe(0);
});

test("inline <svg> inside <a> does not fragment the surrounding sentence", () => {
  const { body, doc, getStyle } = setupDoc(`
    <div>Click <a href="/dl"><svg><path d="M0 0"/></svg> Download</a> now.</div>
  `);
  const delta = parseSiteDelta("");
  const segs = collectSegments(body, delta, { getStyle });
  expect(segs.length).toBe(1);
  const [firstSeg] = segs;
  if (!firstSeg) {
    throw new Error("expected first segment");
  }
  const encoded = encodeInlineNodes(firstSeg.nodes, delta);
  expect(encoded.payloadHtml).toBe(
    'Click <x id="0"><x id="1"/> Download</x> now.'
  );
  const frag = decodeTranslatedHtml(
    '點擊 <x id="0"><x id="1"/> 下載</x> 立即開始。',
    encoded.slots,
    doc
  );
  expect(frag.querySelector("a svg")).not.toBeNull();
  expect(frag.textContent).toBe("點擊  下載 立即開始。");
});
