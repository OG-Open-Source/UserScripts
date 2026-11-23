import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { encodeInlineNodes } from "../../src/capture/inline-codec";
import { collectSegments } from "../../src/capture/segmenter";
import {
  renderError,
  renderInspectMarker,
  renderPending,
  renderTranslated,
  restoreAll,
} from "../../src/render/renderer";
import {
  buildStylesheet,
  STYLE_ELEMENT_ID,
  syncStylesheet,
} from "../../src/render/styles";
import { parseSiteDelta } from "../../src/structure/site-rules";

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
  expect(win.document.querySelector(`#${STYLE_ELEMENT_ID}`)).not.toBeNull();
});

test("renderTranslated wraps original nodes preserving event listeners and renders [data-tr-dst]", () => {
  const win = new Window();
  win.document.body.innerHTML = `<div class="box">Click <button type="button" id="btn">here</button> now.</div>`;
  let clicks = 0;
  const btn = win.document.querySelector("#btn");
  if (!btn) {
    throw new Error("expected #btn");
  }
  btn.addEventListener("click", () => {
    clicks += 1;
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
  const [seg] = segs;
  if (!seg) {
    throw new Error("expected seg");
  }
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
  (host.querySelector("[data-tr-orig] #btn") as HTMLElement).click();
  expect(clicks).toBe(1);
});

test("renderTranslated runs normalization (punctNorm -> spacing) BEFORE OpenCC", () => {
  const win = new Window();
  win.document.body.innerHTML = `<div class="box">Hello world.</div>`;
  const delta = parseSiteDelta("");
  const [seg] = collectSegments(
    win.document.body as unknown as Element,
    delta,
    {
      getStyle: (el) => ({
        display:
          el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
        visibility: "visible",
      }),
    }
  );
  if (!seg) {
    throw new Error("expected seg");
  }
  const { slots } = encodeInlineNodes(seg.nodes, delta);
  const seenOpenccInputs: string[] = [];
  renderTranslated(
    seg,
    "软件[CSS]测试,你好!",
    slots,
    {
      punctNorm: "zh-norm",
      spacingMode: "js",
      opencc: (s) => {
        seenOpenccInputs.push(s);
        return s.replace("软件", "軟體").replace("测试", "測試");
      },
    },
    win.document as unknown as Document
  );
  // OpenCC must receive text AFTER punctNorm ([CSS]->【CSS】, ,->，, !->！) and spacing
  expect(seenOpenccInputs).toEqual(["软件【CSS】测试，你好！"]);
  expect(win.document.querySelector("[data-tr-dst]")?.textContent).toBe(
    "軟體【CSS】測試，你好！"
  );
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
  const [s0, s1, s2] = segs;
  const [sl0, sl1, sl2] = slotsBySeg;
  if (!(s0 && s1 && s2 && sl0 && sl1 && sl2)) {
    throw new Error("expected 3 segments");
  }
  renderTranslated(
    s0,
    "前言 ",
    sl0,
    { spacing: false },
    win.document as unknown as Document
  );
  renderTranslated(
    s1,
    "中間",
    sl1,
    { spacing: false },
    win.document as unknown as Document
  );
  renderTranslated(
    s2,
    " 結尾",
    sl2,
    { spacing: false },
    win.document as unknown as Document
  );

  const post = win.document.querySelector(".post");
  if (!post) {
    throw new Error("expected .post");
  }
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
  const [seg] = segs;
  if (!seg) {
    throw new Error("expected seg");
  }
  renderInspectMarker(seg, win.document as unknown as Document);
  const item = win.document.querySelector(".item");
  if (!item) {
    throw new Error("expected .item");
  }
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
  const [seg] = segs;
  if (!seg) {
    throw new Error("expected seg");
  }
  const host = renderPending(seg, win.document as unknown as Document);
  expect(host.getAttribute("data-tr-state")).toBe("pending");
  renderError(seg, win.document as unknown as Document);
  expect(host.getAttribute("data-tr-state")).toBe("error");
});

test("inline-atomic slots with no-opencc/no-space modifiers shield subtree from OpenCC and CJK auto-spacing", () => {
  const win = new Window();
  win.document.body.innerHTML = `<div class="p">Use <span class="tok">软件CSS</span> now.</div>`;
  const delta = parseSiteDelta("* .tok : inline-atomic, no-spacing, no-opencc");
  const segs = collectSegments(win.document.body as unknown as Element, delta, {
    getStyle: (el) => ({
      display:
        el.tagName === "DIV" || el.tagName === "BODY" ? "block" : "inline",
      visibility: "visible",
    }),
  });
  const [seg] = segs;
  if (!seg) {
    throw new Error("expected seg");
  }
  const { slots } = encodeInlineNodes(seg.nodes, delta);
  renderPending(seg, win.document as unknown as Document);
  renderTranslated(
    seg,
    '使用<x id="0"/>測試',
    slots,
    { spacing: true, opencc: (s) => s.replace("软件", "軟體") },
    win.document as unknown as Document
  );
  expect(win.document.querySelector("[data-tr-dst]")?.textContent).toBe(
    "使用软件CSS 測試"
  );
});
