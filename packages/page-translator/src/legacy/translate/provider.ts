export interface TranslationRequestOptions {
  signal?: AbortSignal;
  sourceLang?: string;
  targetLang: string;
}

export interface GroupedTranslateItem {
  html: string;
  id: string;
}

export interface TranslationProvider {
  readonly id: string;
  translateBatch: (
    items: string[],
    opts: TranslationRequestOptions
  ) => Promise<string[]>;
  translateGrouped?: (
    groups: readonly (readonly GroupedTranslateItem[])[],
    opts: TranslationRequestOptions
  ) => Promise<Map<string, string>>;
}

export function createInspectProvider(): TranslationProvider {
  return {
    id: "inspect",
    translateBatch: (items: string[]): Promise<string[]> =>
      Promise.resolve([...items]),
  };
}
