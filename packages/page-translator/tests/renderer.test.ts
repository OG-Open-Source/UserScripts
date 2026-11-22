import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { encodeInlineNodes } from "../src/legacy/capture/inline-codec";
import { collectSegments } from "../src/legacy/capture/segmenter";
import {
  renderError,
  renderInspectMarker,
  renderPending,
  renderTranslated,
  restoreAll,
} from "../src/legacy/renderer";
import { parseSiteDelta } from "../src/legacy/site-rules";
import {
  buildStylesheet,
  STYLE_ELEMENT_ID,
  syncStylesheet,
} from "../src/legacy/styles";

test("buildStylesheet defaults to replacing original and applies --ptr-font plus user CSS", () => {
  const css = buildStylesheet({
    customFont: '"Noto Sans TC", sans-serif',
    customCss: "[data-tr-orig] { display: block; opacity: 0.5; }",
    debugInspect: false,
  });
  expect(css).toContain('--ptr-font: "Noto Sans TC", sans-serif;');
  expect(css).toContain("[data-tr-orig] { display: none; }");
  expect(css).toContain(
    "[data-tr-dst] { display: contents; font-family: var(--ptr-font, inherit); }"
  );
  expect(
    css.trimEnd().endsWith("[data-tr-orig] { display: block; opacity: 0.5; }")
  ).toBe(true);

  const win = new Window();
  syncStylesheet(win.document as unknown as Document, {
    customFont: "",
    customCss: "",
    debugInspect: false,
  });
  expect(win.document.getElementById(STYLE_ELEMENT_ID)).not.toBeNull();
});

test("renderTranslated wraps original nodes preserving event listeners and renders [data-tr-dst]", () => {
  const win = new Window();
  win.document.body.innerHTML = `<div class="box">Click <button type="button" id="btn">here</button> now.</div>`;
  let clicks = 0;
  win.document.getElementById("btn")!.addEventListener("click", () => {
    clicks++;
  });

  const delta = parseSiteDelta("");
  const segs = collectSegments(win.document.body as unknown as Element, delta, {
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
      visibility: "visible",
    }),
  });
  expect(segs.length).toBe(1);
  const seg = segs[0]!;
  const { slots } = encodeInlineNodes(seg.nodes, delta);
  const host = renderPending(seg, win.document as unknown as Document);
  renderTranslated(
    seg,
    '點擊<x id="0">這裏</x>立即開始。',
    slots,
    { spacing: true, opencc: (s) => s.replace("裏", "裡") },
    win.document as unknown as Document
  );

  expect(host.getAttribute("data-tr-state")).toBe("done");
  expect(host.querySelector("[data-tr-dst]")?.textContent).toBe(
    "點擊這裏立即開始。".replace("裏", "裡")
  );
  // Original button inside [data-tr-orig] still has its event listener intact
  (host.querySelector("[data-tr-orig] #btn") as HTMLElement).click();
  expect(clicks).toBe(1);
});

test("preserves exact DOM order in mixed inline+block container and restores cleanly", () => {
  const win = new Window();
  win.document.body.innerHTML = `<div class="post">Intro <div class="nested">Middle</div> Outro</div>`;
  const delta = parseSiteDelta("");
  const segs = collectSegments(win.document.body as unknown as Element, delta, {
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
      visibility: "visible",
    }),
  });
  expect(segs.length).toBe(3);

  const slotsBySeg = segs.map((s) => encodeInlineNodes(s.nodes, delta).slots);
  for (const s of segs) {
    renderPending(s, win.document as unknown as Document);
  }
  renderTranslated(
    segs[0]!,
    "前言 ",
    slotsBySeg[0]!,
    { spacing: false },
    win.document as unknown as Document
  );
  renderTranslated(
    segs[1]!,
    "中間",
    slotsBySeg[1]!,
    { spacing: false },
    win.document as unknown as Document
  );
  renderTranslated(
    segs[2]!,
    " 結尾",
    slotsBySeg[2]!,
    { spacing: false },
    win.document as unknown as Document
  );

  const post = win.document.querySelector(".post")!;
  const dstTexts = Array.from(post.querySelectorAll("[data-tr-dst]")).map(
    (el) => el.textContent
  );
  expect(dstTexts).toEqual(["前言 ", "中間", " 結尾"]);

  restoreAll(win.document.body as unknown as ParentNode);
  expect(post.querySelector("[data-tr-block]")).toBeNull();
  expect(post.innerHTML).toBe('Intro <div class="nested">Middle</div> Outro');
});

test("renderInspectMarker marks block without altering original text nodes", () => {
  const win = new Window();
  win.document.body.innerHTML = `<div class="item">Sample paragraph</div>`;
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
  renderInspectMarker(segs[0]!, win.document as unknown as Document);
  const item = win.document.querySelector(".item")!;
  expect(item.getAttribute("data-tr-inspect")).toBe("auto");
  expect(item.textContent).toBe("Sample paragraph");
});

test("pending and error states keep [data-tr-orig] visible so text never blanks out", () => {
  const css = buildStylesheet({
    customFont: "",
    customCss: "",
    debugInspect: false,
  });
  expect(css).toContain('[data-tr-state="pending"] > [data-tr-orig]');
  expect(css).toContain('[data-tr-state="error"] > [data-tr-orig]');

  const win = new Window();
  win.document.body.innerHTML = "<div>Original text</div>";
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
  const host = renderPending(segs[0]!, win.document as unknown as Document);
  expect(host.getAttribute("data-tr-state")).toBe("pending");
  renderError(segs[0]!, win.document as unknown as Document);
  expect(host.getAttribute("data-tr-state")).toBe("error");
});

test("inline-atomic slots are shielded from OpenCC and CJK auto-spacing", () => {
  const win = new Window();
  win.document.body.innerHTML = `<div class="p">Use <code class="tok">软件CSS</code> now.</div>`;
  const delta = parseSiteDelta("* .tok : inline-atomic");
  const segs = collectSegments(win.document.body as unknown as Element, delta, {
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
      visibility: "visible",
    }),
  });
  const { slots } = encodeInlineNodes(segs[0]!.nodes, delta);
  renderPending(segs[0]!, win.document as unknown as Document);
  renderTranslated(
    segs[0]!,
    '使用<x id="0"/>測試',
    slots,
    { spacing: true, opencc: (s) => s.replace("软", "軟") },
    win.document as unknown as Document
  );
  const dst = win.document.querySelector("[data-tr-dst]")!;
  expect(dst.querySelector("code.tok")?.textContent).toBe("软件CSS");
});
