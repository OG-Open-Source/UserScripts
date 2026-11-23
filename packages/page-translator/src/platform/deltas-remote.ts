import { gmFetch, gmGet, gmSet } from "@userscripts/shared";

export interface RemoteDeltasFile {
  glossary: string[];
  sites: Record<string, string>;
  version: number;
}

export const EMPTY_REMOTE_DELTAS: RemoteDeltasFile = {
  version: 0,
  glossary: [],
  sites: {},
};

const CACHE_KEY = "ptr:remote-deltas";

export async function loadRemoteDeltas(
  url: string,
  onChange?: (next: RemoteDeltasFile) => void
): Promise<RemoteDeltasFile> {
  const cached = gmGet<RemoteDeltasFile | null>(CACHE_KEY, null);
  const fresh = gmFetch(url, 10_000).then(
    (body) => JSON.parse(body) as RemoteDeltasFile
  );

  if (cached && typeof cached === "object" && cached.sites) {
    void fresh
      .then((next) => {
        if (JSON.stringify(cached) !== JSON.stringify(next)) {
          gmSet(CACHE_KEY, next);
          onChange?.(next);
        }
      })
      .catch(() => {
        // Keep cached copy if background refresh fails offline
      });
    return cached;
  }

  try {
    const next = await fresh;
    gmSet(CACHE_KEY, next);
    return next;
  } catch {
    return EMPTY_REMOTE_DELTAS;
  }
}
