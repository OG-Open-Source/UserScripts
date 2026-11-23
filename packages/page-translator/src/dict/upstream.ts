import { gmFetch } from "@userscripts/shared";
import type { DictStorage, SiteTranslationsFile } from "./store";
import {
  defaultDictStorage,
  loadLocalSiteTranslations,
  loadRemoteSiteTranslations,
  pickLocaleTable,
  saveRemoteSiteTranslations,
} from "./store";
import { matchSiteTranslation } from "./template";

const DEFAULT_BASE_URL =
  "https://raw.githubusercontent.com/OG-Open-Source/UserScripts/main/packages/page-translator/translations";
const DEFAULT_TTL_MS = 86_400_000;
const DEFAULT_NEGATIVE_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 8000;
const TRAILING_SLASHES_RE = /\/+$/u;

export interface UpstreamClientOptions {
  baseUrl?: string;
  fetchText?: (url: string, timeoutMs: number) => Promise<string>;
  negativeTtlMs?: number;
  now?: () => number;
  onUpdate?: (next: SiteTranslationsFile) => void;
  onUpdateError?: (error: unknown) => void;
  storage?: DictStorage;
  timeoutMs?: number;
  ttlMs?: number;
}

export type SegmentDictionaryResult =
  | { hit: true; html: string; source: "local" | "upstream" }
  | { hit: false };

export interface DictionaryLookupOptions {
  client?: UpstreamClient;
  container?: Element | null;
  storage?: DictStorage;
}

export interface UpstreamClient {
  clearCache: (host?: string) => void;
  ensureHost: (host: string) => Promise<SiteTranslationsFile | null>;
  resolveForSegment: (
    host: string,
    html: string,
    targetLang: string,
    container?: Element | null
  ) => Promise<SegmentDictionaryResult>;
}

interface FreshCacheEntry {
  file: SiteTranslationsFile;
  freshUntil: number;
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function reportUpdateError(
  error: unknown,
  options: UpstreamClientOptions
): void {
  if (options.onUpdateError) {
    options.onUpdateError(error);
    return;
  }
  if (typeof globalThis.reportError === "function") {
    globalThis.reportError(error);
    return;
  }
  console.error(error);
}

async function resolveWithClient(
  client: UpstreamClient,
  host: string,
  html: string,
  targetLang: string,
  storage: DictStorage,
  container?: Element | null
): Promise<SegmentDictionaryResult> {
  const local = loadLocalSiteTranslations(host, storage);
  const localHit = matchSiteTranslation(
    html,
    pickLocaleTable(local, targetLang),
    container
  );
  if (localHit) {
    return { hit: true, html: localHit.html, source: "local" };
  }

  const remote = await client.ensureHost(host);
  const remoteHit = matchSiteTranslation(
    html,
    pickLocaleTable(remote, targetLang),
    container
  );
  if (remoteHit) {
    return { hit: true, html: remoteHit.html, source: "upstream" };
  }
  return { hit: false };
}

export function createUpstreamClient(
  options: UpstreamClientOptions = {}
): UpstreamClient {
  const storage = options.storage ?? defaultDictStorage;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const negativeTtlMs = options.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(
    TRAILING_SLASHES_RE,
    ""
  );
  const fetchText =
    options.fetchText ??
    ((url: string, timeout: number) => gmFetch(url, timeout));
  const freshCache = new Map<string, FreshCacheEntry>();
  const negativeCache = new Map<string, number>();
  const inFlight = new Map<string, Promise<SiteTranslationsFile | null>>();

  async function fetchFresh(
    host: string
  ): Promise<SiteTranslationsFile | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const url = `${baseUrl}/${encodeURIComponent(host)}.json`;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Upstream dictionary timeout for ${host}`)),
          timeoutMs
        );
      });
      const body = await Promise.race([
        Promise.resolve(fetchText(url, timeoutMs)),
        timeout,
      ]);
      const parsed: unknown = JSON.parse(body);
      if (!(isObject(parsed) && isObject(parsed.locales))) {
        return null;
      }
      return saveRemoteSiteTranslations(
        {
          version: Number(parsed.version) || 1,
          host:
            typeof parsed.host === "string" && parsed.host.trim()
              ? parsed.host
              : host,
          locales: parsed.locales as SiteTranslationsFile["locales"],
        },
        storage
      );
    } catch {
      return null;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  function startRefresh(
    host: string,
    cached: SiteTranslationsFile | null
  ): Promise<SiteTranslationsFile | null> {
    const request = (async (): Promise<SiteTranslationsFile | null> => {
      const fresh = await fetchFresh(host);
      if (!fresh) {
        negativeCache.set(host, now() + negativeTtlMs);
        return null;
      }

      negativeCache.delete(host);
      freshCache.set(host, { file: fresh, freshUntil: now() + ttlMs });
      if (cached && JSON.stringify(cached) !== JSON.stringify(fresh)) {
        try {
          options.onUpdate?.(fresh);
        } catch (error) {
          reportUpdateError(error, options);
        }
      }
      return fresh;
    })();
    inFlight.set(host, request);
    const cleanup = () => {
      if (inFlight.get(host) === request) {
        inFlight.delete(host);
      }
    };
    void request.then(cleanup, cleanup);
    return request;
  }

  function ensureHost(hostname: string): Promise<SiteTranslationsFile | null> {
    const host = normalizeHost(hostname);
    if (!host) {
      return Promise.resolve(null);
    }

    const timestamp = now();
    const memory = freshCache.get(host);
    if (memory && timestamp < memory.freshUntil) {
      return Promise.resolve(memory.file);
    }

    const cached = memory?.file ?? loadRemoteSiteTranslations(host, storage);
    const retryAt = negativeCache.get(host) ?? 0;
    if (timestamp < retryAt) {
      return Promise.resolve(cached);
    }

    const pending = inFlight.get(host);
    if (pending) {
      return cached ? Promise.resolve(cached) : pending;
    }

    const request = startRefresh(host, cached);
    return cached ? Promise.resolve(cached) : request;
  }

  function clearCache(hostname?: string): void {
    if (hostname === undefined) {
      freshCache.clear();
      negativeCache.clear();
      return;
    }
    const host = normalizeHost(hostname);
    freshCache.delete(host);
    negativeCache.delete(host);
  }

  const client: UpstreamClient = {
    clearCache,
    ensureHost,
    resolveForSegment: (host, html, targetLang, container) =>
      resolveWithClient(client, host, html, targetLang, storage, container),
  };
  return client;
}

export function resolveSegmentDictionary(
  host: string,
  html: string,
  targetLang: string,
  options: DictionaryLookupOptions = {}
): Promise<SegmentDictionaryResult> {
  return resolveWithClient(
    options.client ?? upstream,
    host,
    html,
    targetLang,
    options.storage ?? defaultDictStorage,
    options.container
  );
}

export const upstream = createUpstreamClient();
