import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
	applySpacingToFragment,
	formatDebugSpacingMarks,
	normalizePunctuation,
	spaceCjkText,
} from "../src/transform/spacing";

test("spaces Han/Bopomofo against ASCII words and numbers", () => {
	expect(spaceCjkText("使用CSS設定")).toBe("使用 CSS 設定");
	expect(spaceCjkText("第1版發布於2026年")).toBe("第 1 版發布於 2026 年");
	expect(spaceCjkText("支援HTML和CSS")).toBe("支援 HTML 和 CSS");
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
	expect(spaceCjkText("（註）Note與Test（測試）")).toBe("（註）Note 與 Test（測試）");
});

test("spaces half-width parentheses against Han but leaves inside tight", () => {
	expect(spaceCjkText("使用(CSS)規則")).toBe("使用 (CSS) 規則");
});

test("preserves URLs and existing spaces without doubling", () => {
	expect(spaceCjkText("請見 https://example.com/a/b 詳細")).toBe("請見 https://example.com/a/b 詳細");
	expect(spaceCjkText("使用 CSS 設定")).toBe("使用 CSS 設定");
});

test("applySpacingToFragment spaces across inline element seams unless blocked by full-width punct", () => {
	const win = new Window();
	const host = win.document.createElement("span");
	host.innerHTML = '使用<a href="#">CSS</a>設定與「<a href="#">API</a>」';
	applySpacingToFragment(host as unknown as Node);
	expect(host.textContent).toBe("使用 CSS 設定與「API」");
});

test("applySpacingToFragment spaces half-width atomic keycaps like <kbd>/</kbd> against CJK but not full-width brackets", () => {
	const win = new Window();
	const host = win.document.createElement("span");
	host.innerHTML = '類型<kbd data-tr-no-space="1">/</kbd>搜尋與「<kbd data-tr-no-space="1">/</kbd>」';
	applySpacingToFragment(host as unknown as Node);
	expect(host.textContent).toBe("類型 / 搜尋與「/」");
});

test("normalizePunctuation handles CJK vs Latin punctuation and protects URLs, math, and versions", () => {
	expect(normalizePunctuation("很好,謝謝!", "zh-norm")).toBe("很好，謝謝！");
	expect(normalizePunctuation("不客氣.", "zh-norm")).toBe("不客氣。");
	expect(normalizePunctuation("Hello,how are you?", "zh-norm")).toBe("Hello, how are you?");
	expect(normalizePunctuation("I'm fine.Give me 5+103-1*84/4 dollars right now!", "zh-norm")).toBe(
		"I'm fine. Give me 5+103-1*84/4 dollars right now!",
	);
	expect(normalizePunctuation("不要 fuck you! 去死!", "zh-norm")).toBe("不要 fuck you! 去死！");
	expect(normalizePunctuation("請見 https://example.com/a/b 與 v1.0.2 及 3.14", "zh-norm")).toBe(
		"請見 https://example.com/a/b 與 v1.0.2 及 3.14",
	);
	expect(spaceCjkText(normalizePunctuation("ＡＰＩ測試　１２３", "zh-norm"))).toBe("API 測試 123");
	expect(spaceCjkText("被國外瘋狂吹捧的《ArcRaiders》真的那麼好玩？")).toBe(
		"被國外瘋狂吹捧的《ArcRaiders》真的那麼好玩？",
	);
	expect(normalizePunctuation("Visit github.com, index.html, a@b.com, and history.pushState.", "zh-norm")).toBe(
		"Visit github.com, index.html, a@b.com, and history.pushState.",
	);
});

test("spaces half-width hyphen between CJK and numbers", () => {
	expect(spaceCjkText("解弦視界萬理歸塵-10級")).toBe("解弦視界萬理歸塵 - 10 級");
});

test("formatDebugSpacingMarks marks JS-inserted spaces with ^ and regular spaces with _", () => {
	const before = "不要fuck you!去死！";
	const after = spaceCjkText(before);
	expect(after).toBe("不要 fuck you! 去死！");
	expect(formatDebugSpacingMarks(before, after)).toBe("不要^fuck_you!^去死！");
});
