import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  decodeTranslatedHtml,
  encodeInlineNodes,
} from "../../src/capture/inline-codec";
import { parseSiteDelta } from "../../src/structure/site-rules";
import {
  applyNormalizationToFragment,
  applySpacingToFragment,
  formatDebugSpacingMarks,
  normalizeChineseText,
  normalizePunctuation,
  spaceCjkText,
} from "../../src/text/normalize";

const NORMALIZE_OPTIONS = {
  punctNorm: "zh-norm",
  spacingMode: "both",
} as const;

test("normalizes CJK-adjacent halfwidth brackets idempotently without adding spaces", () => {
  expect(normalizeChineseText("文字[English]", NORMALIZE_OPTIONS)).toBe(
    "文字【English】"
  );
  expect(normalizeChineseText("文字【English】", NORMALIZE_OPTIONS)).toBe(
    "文字【English】"
  );
  expect(normalizeChineseText("文字 [ English ] 测试", NORMALIZE_OPTIONS)).toBe(
    "文字【English】测试"
  );
  expect(normalizeChineseText("[中文]", NORMALIZE_OPTIONS)).toBe("【中文】");
});

test("preserves pure-ASCII halfwidth brackets", () => {
  expect(normalizeChineseText("Use [JSON] in doc", NORMALIZE_OPTIONS)).toBe(
    "Use [JSON] in doc"
  );
  expect(normalizeChineseText("arr[0]", NORMALIZE_OPTIONS)).toBe("arr[0]");
});

test("normalizes CJK-adjacent brackets across inline tags only", () => {
  expect(
    normalizeChineseText('文字<x id="0">[English]</x>', NORMALIZE_OPTIONS)
  ).toBe('文字<x id="0">【English】</x>');
  expect(
    normalizeChineseText('<x id="0">文字</x>[English]', NORMALIZE_OPTIONS)
  ).toBe('<x id="0">文字</x>【English】');
  expect(
    normalizeChineseText('文字[<x id="0">English</x>]', NORMALIZE_OPTIONS)
  ).toBe('文字【<x id="0">English</x>】');
  expect(
    normalizeChineseText('Use <x id="0">[JSON]</x> in doc', NORMALIZE_OPTIONS)
  ).toBe('Use <x id="0">[JSON]</x> in doc');
});

test("applies punctuation normalization before CJK spacing", () => {
  expect(normalizeChineseText("GLM 5.3的确…", NORMALIZE_OPTIONS)).toBe(
    "GLM 5.3 的确…"
  );
});

test("preserves nested x tags while normalizing their text and inline seams", () => {
  const source =
    '<x id="0"><x id="1">Only Apple can do（徽章）. iOS/iPadOS…</x></x>';
  expect(normalizeChineseText(source, NORMALIZE_OPTIONS)).toBe(
    '<x id="0"><x id="1">Only Apple can do（徽章）。iOS/iPadOS…</x></x>'
  );
  expect(
    normalizeChineseText('使用<x id="0">CSS</x>設定', NORMALIZE_OPTIONS)
  ).toBe('使用 <x id="0">CSS</x> 設定');
});

test("protects URLs during unified normalization", () => {
  expect(
    normalizeChineseText(
      '<x id="0">请见 https://example.com/a,b</x>文字[English]',
      NORMALIZE_OPTIONS
    )
  ).toBe('<x id="0">请见 https://example.com/a,b</x>文字【English】');
});

test("decoded inline-atomic prose remains normalizable unless explicitly excluded", () => {
  const win = new Window();
  const doc = win.document as unknown as Document;
  win.document.body.innerHTML =
    '<span class="atomic">Only Apple can do（徽章）.</span>';
  const delta = parseSiteDelta("* .atomic : inline-atomic");
  const encoded = encodeInlineNodes(
    Array.from(win.document.body.childNodes) as Node[],
    delta
  );

  expect(encoded.payloadHtml).toBe('<x id="0"/>');
  const fragment = decodeTranslatedHtml(
    encoded.payloadHtml,
    encoded.slots,
    doc
  );
  const decoded = fragment.firstChild as Element;
  expect(decoded.hasAttribute("data-tr-no-space")).toBe(false);
  expect(decoded.hasAttribute("data-tr-no-opencc")).toBe(false);

  applyNormalizationToFragment(fragment, NORMALIZE_OPTIONS);
  expect(fragment.textContent).toBe("Only Apple can do（徽章）。");
});

test("spaces Han/Bopomofo against ASCII words and numbers", () => {
  expect(spaceCjkText("使用CSS設定")).toBe("使用 CSS 設定");
  expect(spaceCjkText("第1版發布於2026年")).toBe("第 1 版發布於 2026 年");
  expect(spaceCjkText("支援HTML和CSS")).toBe("支援 HTML 和 CSS");
  expect(spaceCjkText("ㄅㄆㄇABC")).toBe("ㄅㄆㄇ ABC");
});

test("NEVER spaces around full-width brackets and punctuation", () => {
  const cases = [
    "用【API】測試",
    "這〖CSS〗規格",
    "點擊「Settings」按鈕",
    "閱讀『TypeScript』指南",
    "例如（HTML）或［JSON］或｛YAML｝",
    "設定：CSS！真的嗎？是的。第一，CSS；第二、HTML",
    "使用＂CSS＂與＇JS＇",
    "（註）Note",
    "Test（測試）",
  ];
  for (const s of cases) {
    expect(spaceCjkText(s)).toBe(s);
  }
  expect(spaceCjkText("（註）Note與Test（測試）")).toBe(
    "（註）Note 與 Test（測試）"
  );
});

test("spaces half-width parentheses against Han and preserves URLs without doubling spaces", () => {
  expect(spaceCjkText("使用(CSS)規則")).toBe("使用 (CSS) 規則");
  expect(spaceCjkText("請見 https://example.com/a/b 詳細")).toBe(
    "請見 https://example.com/a/b 詳細"
  );
  expect(spaceCjkText("使用 CSS 設定")).toBe("使用 CSS 設定");
});

test("applySpacingToFragment spaces across inline seams and non-code atomic keycaps unless blocked by fullwidth punct", () => {
  const win = new Window();
  const host = win.document.createElement("span");
  host.innerHTML = '使用<a href="#">CSS</a>設定與「<a href="#">API</a>」';
  applySpacingToFragment(host as unknown as Node);
  expect(host.textContent).toBe("使用 CSS 設定與「API」");

  // Note: v4 hard-skips <kbd> during capture, so fragment-level atomic keycap spacing uses non-code <span data-tr-no-space="1">
  const keyHost = win.document.createElement("span");
  keyHost.innerHTML =
    '類型<span data-tr-no-space="1">/</span>搜尋與「<span data-tr-no-space="1">/</span>」';
  applySpacingToFragment(keyHost as unknown as Node);
  expect(keyHost.textContent).toBe("類型 / 搜尋與「/」");
});

test("normalizePunctuation handles CJK vs Latin punctuation and protects URLs, math, and versions", () => {
  expect(normalizePunctuation("很好,謝謝!", "zh-norm")).toBe("很好，謝謝！");
  expect(normalizePunctuation("不客氣.", "zh-norm")).toBe("不客氣。");
  expect(normalizePunctuation("Hello,how are you?", "zh-norm")).toBe(
    "Hello, how are you?"
  );
  expect(
    normalizePunctuation(
      "I'm fine.Give me 5+103-1*84/4 dollars right now!",
      "zh-norm"
    )
  ).toBe("I'm fine. Give me 5+103-1*84/4 dollars right now!");
  expect(normalizePunctuation("不要 fuck you! 去死!", "zh-norm")).toBe(
    "不要 fuck you! 去死！"
  );
  expect(
    normalizePunctuation(
      "請見 https://example.com/a/b 與 v1.0.2 及 3.14",
      "zh-norm"
    )
  ).toBe("請見 https://example.com/a/b 與 v1.0.2 及 3.14");
  expect(
    spaceCjkText(normalizePunctuation("ＡＰＩ測試　１２３", "zh-norm"))
  ).toBe("API 測試 123");
  expect(spaceCjkText("被國外瘋狂吹捧的《ArcRaiders》真的那麼好玩？")).toBe(
    "被國外瘋狂吹捧的《ArcRaiders》真的那麼好玩？"
  );
  expect(
    normalizePunctuation(
      "Visit github.com, index.html, a@b.com, and history.pushState.",
      "zh-norm"
    )
  ).toBe("Visit github.com, index.html, a@b.com, and history.pushState.");
});

test("spaces half-width hyphen between CJK and numbers and converts CJK-containing parens to fullwidth", () => {
  expect(spaceCjkText("解弦視界萬理歸塵-10級")).toBe(
    "解弦視界萬理歸塵 - 10 級"
  );
  expect(
    spaceCjkText(
      normalizePunctuation(
        "解弦視界萬理歸塵-10級：使用(CSS)規則，效率提升50% (實測)!",
        "zh-norm"
      )
    )
  ).toBe("解弦視界萬理歸塵 - 10 級：使用 (CSS) 規則，效率提升 50%（實測）！");
  expect(normalizePunctuation("不要 fuck you! 去死! 使用 CSS", "zh-norm")).toBe(
    "不要 fuck you! 去死！使用 CSS"
  );
});

test("formatDebugSpacingMarks marks JS-inserted spaces with ^ and regular spaces with _", () => {
  const before = "不要fuck you!去死！";
  const after = spaceCjkText(before);
  expect(after).toBe("不要 fuck you! 去死！");
  expect(formatDebugSpacingMarks(before, after)).toBe("不要^fuck_you!^去死！");
});
