import type { SiteStructureAdapter, StructureAdapterContext } from "./adapter";
import { discourseAdapter } from "./discourse";
import { fallbackAdapter } from "./fallback";

/** Concrete framework adapters run before the generic fallback. */
export const defaultAdapters: SiteStructureAdapter[] = [discourseAdapter];

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
