import type { TranslationProvider } from "../core/types";

export function createHumanOnlyProvider(): TranslationProvider {
  return {
    id: "human-only",
    translateBatch: (items: string[]): Promise<string[]> =>
      Promise.resolve([...items]),
  };
}

export const humanOnlyProvider: TranslationProvider = createHumanOnlyProvider();
