import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  decodeTranslatedHtml,
  encodeInlineNodes,
} from "../../src/capture/inline-codec";
import { parseSiteDelta } from "../../src/legacy/site-rules";
import {
  applyNormalizationToFragment,
  normalizeChineseText,
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
