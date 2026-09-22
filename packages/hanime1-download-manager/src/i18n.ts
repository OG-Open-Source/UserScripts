/**
 * Translation tables and language configuration for Hanime1 Download Manager.
 *
 * zh-TW is the default; zh-CN and en are switchable via the GM "lang" value
 * (the menu is registered by @userscripts/shared's createI18n).
 */

export type Hanime1Lang = "zh-TW" | "zh-CN" | "en";
export type Hanime1MessageKey =
	| "download"
	| "fetching"
	| "done"
	| "error"
	| "loadingQualities"
	| "noQualities"
	| "selectAll"
	| "selectNone"
	| "downloadSelected"
	| "chooseBatchQuality"
	| "downgradeNotice";

export const LANGS: Hanime1Lang[] = ["zh-TW", "zh-CN", "en"];

export const DEFAULT_LANG: Hanime1Lang = "zh-TW";

export const LANG_NAMES: Record<Hanime1Lang, string> = {
	"zh-TW": "繁體中文",
	"zh-CN": "简体中文",
	en: "English",
};

export const MESSAGES: Record<
	Hanime1Lang,
	Record<Hanime1MessageKey, string>
> = {
	"zh-TW": {
		download: "下載",
		fetching: "解析中",
		done: "完成",
		error: "失敗",
		loadingQualities: "載入畫質…",
		noQualities: "無可下載畫質",
		selectAll: "全選",
		selectNone: "全不選",
		downloadSelected: "下載已選取項目",
		chooseBatchQuality: "選擇批量下載畫質（不足時自動降級）",
		downgradeNotice: "畫質降級：",
	},
	"zh-CN": {
		download: "下载",
		fetching: "解析中",
		done: "完成",
		error: "失败",
		loadingQualities: "加载画质…",
		noQualities: "无可下载画质",
		selectAll: "全选",
		selectNone: "全不选",
		downloadSelected: "下载已选取项目",
		chooseBatchQuality: "选择批量下载画质（不足时自动降级）",
		downgradeNotice: "画质降级：",
	},
	en: {
		download: "Download",
		fetching: "Resolving",
		done: "Done",
		error: "Failed",
		loadingQualities: "Loading qualities…",
		noQualities: "No downloadable quality",
		selectAll: "Select all",
		selectNone: "Select none",
		downloadSelected: "Download selected",
		chooseBatchQuality: "Choose batch quality (auto-downgrade if unavailable)",
		downgradeNotice: "Quality downgraded:",
	},
};
