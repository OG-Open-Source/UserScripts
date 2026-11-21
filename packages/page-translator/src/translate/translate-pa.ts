import { gmRequest } from "@userscripts/shared";
import type { TranslationProvider, TranslationRequestOptions } from "./provider";

const TRANSLATE_PA_ENDPOINT = "https://translate-pa.googleapis.com/v1/translateHtml";

export interface TranslatePaOptions {
	apiKey: string;
}

export function createTranslatePaProvider(options: TranslatePaOptions): TranslationProvider {
	return {
		id: "translate-pa",
		async translateBatch(items: string[], opts: TranslationRequestOptions): Promise<string[]> {
			if (items.length === 0) return [];
			const payload = [[items, opts.sourceLang ?? "auto", opts.targetLang], "wt_lib"];
			const res = await gmRequest({
				method: "POST",
				url: TRANSLATE_PA_ENDPOINT,
				headers: { "Content-Type": "application/json+protobuf", "X-Goog-Api-Key": options.apiKey },
				data: JSON.stringify(payload),
				timeout: 25000,
			});

			const parsed = JSON.parse(res.responseText) as unknown;
			if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) {
				throw new Error("[ptr] Unexpected translate-pa response shape");
			}
			const translations = parsed[0] as unknown[];
			if (translations.length !== items.length) {
				throw new Error(`[ptr] translate-pa count mismatch: expected ${items.length}, got ${translations.length}`);
			}
			return translations.map((v) => String(v ?? ""));
		},
	};
}
