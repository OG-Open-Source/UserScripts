import { gmFetch, gmGet, gmSet } from "@userscripts/shared";
import discourseJson from "../../fingerprints/discourse.json" with {
  type: "json",
};
import githubJson from "../../fingerprints/github.json" with { type: "json" };
import type { ElementTreatment } from "./adapter";

export interface FingerprintData {
  captureSelectors: string[];
  detectSelectors: string[];
  excludeSelectors: string[];
  id: string;
  policies: Record<string, ElementTreatment>;
  regions: Record<string, string[]>;
  spaRescanSelectors: string[];
  version: number;
}

export interface FingerprintStorage {
  get: <T>(key: string) => T | null | undefined;
  set: (key: string, value: unknown) => void;
}

export interface FingerprintLoadOptions {
  fetchText?: (url: string) => Promise<string>;
  onUpdate?: (next: FingerprintData) => void;
  remoteBaseUrl?: string;
  remoteUrl?: string;
  storage?: FingerprintStorage;
  timeoutMs?: number;
}

const DEFAULT_REMOTE_BASE =
  "https://raw.githubusercontent.com/OG-Open-Source/UserScripts/main/packages/page-translator/fingerprints";
const CACHE_PREFIX = "ptr:fingerprint:";
const TRAILING_SLASHES_RE = /\/+$/u;
const TREATMENTS = new Set<ElementTreatment>([
  "menu",
  "button",
  "title",
  "badge",
  "prose",
  "atomic",
  "skip",
]);
const BUNDLED: Readonly<Record<string, FingerprintData>> = {
  discourse: discourseJson as FingerprintData,
  github: githubJson as FingerprintData,
};

const gmStorage: FingerprintStorage = {
  get<T>(key: string): T | null {
    try {
      return gmGet<T | null>(key, null);
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown): void {
    try {
      gmSet(key, value);
    } catch {
      // GM storage is optional in tests and non-userscript environments.
    }
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function isRegions(value: unknown): value is Record<string, string[]> {
  return isObject(value) && Object.values(value).every(isStringArray);
}

function isPolicies(value: unknown): value is Record<string, ElementTreatment> {
  return (
    isObject(value) &&
    Object.values(value).every(
      (treatment) =>
        typeof treatment === "string" &&
        TREATMENTS.has(treatment as ElementTreatment)
    )
  );
}

function isFingerprintData(value: unknown): value is FingerprintData {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.version === "number" &&
    isStringArray(value.detectSelectors) &&
    isRegions(value.regions) &&
    isStringArray(value.captureSelectors) &&
    isStringArray(value.excludeSelectors) &&
    isStringArray(value.spaRescanSelectors) &&
    isPolicies(value.policies)
  );
}

function readCached(
  id: string,
  storage: FingerprintStorage
): FingerprintData | null {
  try {
    const cached = storage.get<unknown>(`${CACHE_PREFIX}${id}`);
    return isFingerprintData(cached) && cached.id === id ? cached : null;
  } catch {
    return null;
  }
}

function writeCached(
  id: string,
  storage: FingerprintStorage,
  fingerprint: FingerprintData
): void {
  try {
    storage.set(`${CACHE_PREFIX}${id}`, fingerprint);
  } catch {
    // A remote fingerprint remains usable when storage is unavailable.
  }
}

async function fetchFresh(
  id: string,
  url: string,
  fetchText: (url: string) => Promise<string>
): Promise<FingerprintData | null> {
  try {
    const parsed: unknown = JSON.parse(await fetchText(url));
    return isFingerprintData(parsed) && parsed.id === id ? parsed : null;
  } catch {
    return null;
  }
}

export async function load(
  id: string,
  options: FingerprintLoadOptions = {}
): Promise<FingerprintData> {
  const storage = options.storage ?? gmStorage;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fetchText =
    options.fetchText ??
    ((requestUrl: string) => gmFetch(requestUrl, timeoutMs));
  const remoteBase = (options.remoteBaseUrl ?? DEFAULT_REMOTE_BASE).replace(
    TRAILING_SLASHES_RE,
    ""
  );
  const url = options.remoteUrl ?? `${remoteBase}/${id}.json`;
  const cached = readCached(id, storage);

  if (cached) {
    void fetchFresh(id, url, fetchText)
      .then((refreshed) => {
        if (refreshed && JSON.stringify(refreshed) !== JSON.stringify(cached)) {
          writeCached(id, storage, refreshed);
          options.onUpdate?.(refreshed);
        }
      })
      .catch(() => {
        // Stale data remains valid when a background refresh fails.
      });
    return cached;
  }

  const fresh = await fetchFresh(id, url, fetchText);
  if (fresh) {
    writeCached(id, storage, fresh);
    return fresh;
  }

  const bundled = BUNDLED[id];
  if (bundled) {
    return bundled;
  }
  throw new Error(
    `Fingerprint "${id}" is unavailable remotely and has no bundle.`
  );
}

export const loadFingerprint = load;
export const fingerprints = { load };
