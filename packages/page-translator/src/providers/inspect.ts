import type { TranslationProvider } from "../core/types";

export function createInspectProvider(): TranslationProvider {
  return {
    id: "inspect",
    translateBatch: (items: string[]): Promise<string[]> =>
      Promise.resolve([...items]),
  };
}
