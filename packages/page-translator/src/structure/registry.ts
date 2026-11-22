import type { SiteStructureAdapter, StructureAdapterContext } from "./adapter";
import { fallbackAdapter } from "./fallback";

/** Tasks for concrete frameworks register their adapters in this ordered list. */
export const defaultAdapters: SiteStructureAdapter[] = [];

export function resolveAdapter(
  ctx: StructureAdapterContext,
  adapters: readonly SiteStructureAdapter[] = defaultAdapters
): SiteStructureAdapter {
  for (const adapter of adapters) {
    if (adapter.detect(ctx)) {
      return adapter;
    }
  }
  return fallbackAdapter;
}
