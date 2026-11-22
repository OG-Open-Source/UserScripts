import { expect, test } from "bun:test";
import {
  detectSegmentBcp47,
  parseBcp47,
  routeSegment,
} from "../src/legacy/transform/lang-route";

test("parseBcp47 normalizes Chinese script/region tags accurately", () => {
  expect(parseBcp47("zh-TW")).toEqual({
    lang: "zh",
    script: "Hant",
    region: "TW",
  });
  expect(parseBcp47("zh-Hant-TW")).toEqual({
    lang: "zh",
    script: "Hant",
    region: "TW",
  });
  expect(parseBcp47("zh-CN")).toEqual({
    lang: "zh",
    script: "Hans",
    region: "CN",
  });
  expect(parseBcp47("zh-Hans")).toEqual({
    lang: "zh",
    script: "Hans",
    region: undefined,
  });
  expect(parseBcp47("en-US")).toEqual({
    lang: "en",
    script: undefined,
    region: "US",
  });
});

test("routes same-language vs script/region hard conversion vs cloud translation", () => {
  // Target: zh-TW
  expect(
    routeSegment(
      "這是繁體中文的網頁測試段落，用來驗證語言與文字系統偵測。",
      "zh-TW",
      "zh-Hant-TW"
    )
  ).toEqual({
    action: "skip",
  });

  expect(
    routeSegment(
      "這是繁體中文的網頁測試段落，用來驗證繁簡體字元判斷。",
      "zh-TW"
    )
  ).toEqual({ action: "skip" });

  expect(
    routeSegment(
      "这是简体中文的网页测试段落，用来验证语言与文字系统侦测。",
      "zh-TW",
      "zh-CN"
    )
  ).toEqual({
    action: "opencc",
    mode: "s2twp",
  });

  expect(
    routeSegment(
      "这是简体中文的网页测试段落，用来验证繁简体字符判断。",
      "zh-TW"
    )
  ).toEqual({
    action: "opencc",
    mode: "s2twp",
  });

  expect(
    routeSegment("Hello world, welcome to GitHub.", "zh-TW", "en")
  ).toEqual({ action: "translate" });

  expect(
    routeSegment("こんにちは、これは日本語のテストです。", "zh-TW")
  ).toEqual({ action: "translate" });

  // Target: zh-CN
  expect(
    routeSegment("这是简体中文的网页测试段落。", "zh-CN", "zh-Hans-CN")
  ).toEqual({ action: "skip" });
  expect(
    routeSegment("這是繁體中文的網頁測試段落。", "zh-CN", "zh-TW")
  ).toEqual({ action: "opencc", mode: "tw2sp" });

  // Target: en-US
  expect(routeSegment("This is an English paragraph.", "en-US", "en")).toEqual({
    action: "skip",
  });
  expect(routeSegment("這是中文段落。", "en-US", "zh-TW")).toEqual({
    action: "translate",
  });

  // Kanji-only Japanese on lang="ja" must be translated, NOT skipped or OpenCC-converted
  expect(routeSegment("新規作成", "zh-TW", "ja")).toEqual({
    action: "translate",
  });
  expect(routeSegment("開発", "zh-TW", "ja")).toEqual({ action: "translate" });

  // Short Simplified Chinese UI terms without prior fingerprint chars
  expect(routeSegment("视频", "zh-TW")).toEqual({
    action: "opencc",
    mode: "s2twp",
  });
  expect(routeSegment("代码", "zh-TW")).toEqual({
    action: "opencc",
    mode: "s2twp",
  });
});

test("detectSegmentBcp47 classifies non-Latin scripts without elementLang so they are never skipped as en/und", () => {
  expect(detectSegmentBcp47("Привет мир").lang).not.toBe("und");
  expect(routeSegment("Привет мир", "en-US")).toEqual({ action: "translate" });
  expect(routeSegment("مرحبا بالعالم", "en-US")).toEqual({
    action: "translate",
  });
  expect(routeSegment("สวัสดีชาวโลก", "zh-TW")).toEqual({ action: "translate" });
  expect(routeSegment("こんにちは世界", "zh-TW")).toEqual({
    action: "translate",
  });
});

test("detectSegmentBcp47 maps non-Latin script blocks to explicit non-und primary tags", () => {
  expect(detectSegmentBcp47("Привет мир").lang).toBe("ru");
  expect(detectSegmentBcp47("مرحبا بالعالم").lang).toBe("ar");
  expect(detectSegmentBcp47("สวัสดีชาวโลก").lang).toBe("th");
  expect(detectSegmentBcp47("Γειά σου κόσμε").lang).toBe("el");
  expect(detectSegmentBcp47("שלום עולם").lang).toBe("he");
  expect(detectSegmentBcp47("नमस्ते दुनिया").lang).toBe("hi");
});
