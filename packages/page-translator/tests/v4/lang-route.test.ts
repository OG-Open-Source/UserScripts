import { expect, test } from "bun:test";
import {
  detectSegmentBcp47,
  parseBcp47,
  routePrimary,
} from "../../src/core/router";

test("parseBcp47 normalizes Chinese script/region tags, underscores, and empty/und", () => {
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
  expect(parseBcp47("zh_Hant_HK")).toEqual({
    lang: "zh",
    script: "Hant",
    region: "HK",
  });
  expect(parseBcp47("zh-CN")).toEqual({
    lang: "zh",
    script: "Hans",
    region: "CN",
  });
  expect(parseBcp47("zh-Hans")).toEqual({
    lang: "zh",
    script: "Hans",
  });
  expect(parseBcp47("en-US")).toEqual({
    lang: "en",
    region: "US",
  });
  expect(parseBcp47("")).toEqual({ lang: "und" });
});

test("routePrimary routes zh->zh to zh-subsystem, same primary to skip, and cross-language to translate", () => {
  expect(
    routePrimary("這是繁體中文的網頁測試段落，用來驗證語言路由。", "zh-TW")
  ).toBe("zh-subsystem");
  expect(
    routePrimary("这是简体中文的网页测试段落，用来验证语言路由。", "zh-TW")
  ).toBe("zh-subsystem");
  expect(routePrimary("Hello world, welcome to GitHub.", "zh-TW")).toBe(
    "translate"
  );
  expect(routePrimary("This is an English paragraph.", "en-US")).toBe("skip");
  expect(routePrimary("這是中文段落。", "en-US")).toBe("translate");
});

test("detectSegmentBcp47 classifies non-Latin scripts without elementLang so they are never skipped as en/und", () => {
  expect(detectSegmentBcp47("Привет мир").lang).toBe("ru");
  expect(detectSegmentBcp47("مرحبا بالعالم").lang).toBe("ar");
  expect(detectSegmentBcp47("สวัสดีชาวโลก").lang).toBe("th");
  expect(detectSegmentBcp47("Γειά σου κόσμε").lang).toBe("el");
  expect(detectSegmentBcp47("שלום עולם").lang).toBe("he");
  expect(detectSegmentBcp47("नमस्ते दुनिया").lang).toBe("hi");
  expect(detectSegmentBcp47("こんにちは世界").lang).toBe("ja");
  expect(detectSegmentBcp47("안녕하세요 세계").lang).toBe("ko");

  expect(routePrimary("Привет мир", "en-US")).toBe("translate");
  expect(routePrimary("مرحبا بالعالم", "en-US")).toBe("translate");
  expect(routePrimary("สวัสดีชาวโลก", "zh-TW")).toBe("translate");
  expect(routePrimary("こんにちは世界", "zh-TW")).toBe("translate");
});
