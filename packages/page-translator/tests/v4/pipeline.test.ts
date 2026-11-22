import { expect, test } from "bun:test";
import { runSegmentPipeline } from "../../src/core/pipeline";
import { routePrimary } from "../../src/core/router";
import { scheduleOpenCC } from "../../src/text/opencc";

const ZH_CONFIG = {
  debugSpacingMarks: false,
  openccMode: "off",
  punctNorm: "zh-norm",
  spacingMode: "both",
  targetLang: "zh-TW",
} as const;

test("primary-language router compares only primary subtags", () => {
  expect(routePrimary("Hello world", "zh-TW")).toBe("translate");
  expect(routePrimary("这是简体中文的网页测试段落", "zh-TW")).toBe(
    "zh-subsystem"
  );
  expect(routePrimary("Hello world", "en-US")).toBe("skip");
  expect(routePrimary("这是中文段落", "en-US")).toBe("translate");
});

test("OpenCC scheduling is disabled only by off mode", () => {
  expect(scheduleOpenCC({ openccMode: "off" })).toEqual({ enabled: false });
  expect(scheduleOpenCC({ openccMode: "s2twp" })).toEqual({
    enabled: true,
    mode: "s2twp",
  });
});

test("zh-subsystem normalizes and renders without conversion when OpenCC is off", async () => {
  let conversions = 0;
  let rendered = "";
  const result = await runSegmentPipeline("GLM 5.3的确…", ZH_CONFIG, {
    createOpenCC: () => {
      conversions += 1;
      return { convert: (text: string) => text };
    },
    render: (html) => {
      rendered = html;
    },
  });

  expect(result).toEqual({
    html: "GLM 5.3 的确…",
    route: "zh-subsystem",
  });
  expect(rendered).toBe("GLM 5.3 的确…");
  expect(conversions).toBe(0);
});

test("translate route applies dictionary and provider hooks then zh output stages", async () => {
  const calls: string[] = [];
  const result = await runSegmentPipeline(
    "Hello world",
    { ...ZH_CONFIG, openccMode: "s2t" },
    {
      createOpenCC: (mode) => {
        calls.push(`opencc:${mode}`);
        return {
          convert: (text: string) => text.replace("软件", "軟體"),
        };
      },
      dict: (html) => {
        calls.push("dict");
        return html;
      },
      provider: () => {
        calls.push("provider");
        return "GLM 5.3的确…软件";
      },
      render: (html) => {
        calls.push(`render:${html}`);
      },
    }
  );

  expect(result.html).toBe("GLM 5.3 的确…軟體");
  expect(calls).toEqual([
    "dict",
    "provider",
    "opencc:s2t",
    "render:GLM 5.3 的确…軟體",
  ]);
});

test("pipeline routes visible non-enumerated scripts instead of markup", async () => {
  const source = '<x id="0">বাংলা</x>';
  let providerInput = "";
  const result = await runSegmentPipeline(
    source,
    { ...ZH_CONFIG, targetLang: "en-US" },
    {
      provider: (html) => {
        providerInput = html;
        return "Bengali";
      },
    }
  );

  expect(result).toEqual({ html: "Bengali", route: "translate" });
  expect(providerInput).toBe(source);
});

test("enabled OpenCC requires a converter factory", async () => {
  await expect(
    runSegmentPipeline("软件", { ...ZH_CONFIG, openccMode: "s2t" })
  ).rejects.toThrow('OpenCC mode "s2t" requires hooks.createOpenCC');
});

test("non-zh translate output skips normalization and OpenCC", async () => {
  let conversions = 0;
  const result = await runSegmentPipeline(
    "这是中文段落",
    { ...ZH_CONFIG, openccMode: "s2t", targetLang: "en-US" },
    {
      createOpenCC: () => {
        conversions += 1;
        return { convert: (text: string) => text };
      },
      provider: () => "GLM 5.3的确[English]",
    }
  );

  expect(result).toEqual({
    html: "GLM 5.3的确[English]",
    route: "translate",
  });
  expect(conversions).toBe(0);
});
