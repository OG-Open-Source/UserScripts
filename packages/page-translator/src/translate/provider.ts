export interface TranslationRequestOptions {
	sourceLang?: string;
	targetLang: string;
	signal?: AbortSignal;
}

export interface TranslationProvider {
	readonly id: string;
	translateBatch(items: string[], opts: TranslationRequestOptions): Promise<string[]>;
}

export function createInspectProvider(): TranslationProvider {
	return {
		id: "inspect",
		async translateBatch(items: string[]): Promise<string[]> {
			return [...items];
		},
	};
}
