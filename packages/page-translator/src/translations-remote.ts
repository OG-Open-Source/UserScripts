import { gmFetch, gmGet, gmSet } from "@userscripts/shared";
import type { SiteLocaleTable } from "./transform/template";

export interface SiteTranslationsFile {
  host: string;
  locales: Record<string, SiteLocaleTable>;
  version: number;
}

const CACHE_PREFIX = "ptr:site-tr:";
const CACHE_INDEX_KEY = "ptr:site-tr:__index";

function recordCachedHost(host: string): void {
  const clean = host.toLowerCase().trim();
  if (!clean) {
    return;
  }
  try {
    const prev = gmGet<string[]>(CACHE_INDEX_KEY, []);
    const list = Array.isArray(prev) ? prev : [];
    if (!list.includes(clean)) {
      gmSet(CACHE_INDEX_KEY, [...list, clean].sort());
    }
  } catch {
    // Ignore if GM storage is not configured in tests
  }
}

function removeCachedHostFromIndex(host: string): void {
  const clean = host.toLowerCase().trim();
  try {
    const prev = gmGet<string[]>(CACHE_INDEX_KEY, []);
    if (!Array.isArray(prev)) {
      return;
    }
    gmSet(
      CACHE_INDEX_KEY,
      prev.filter((h) => h !== clean)
    );
  } catch {
    // Ignore if GM storage is not configured in tests
  }
}

export function listCachedSiteTranslations(): SiteTranslationsFile[] {
  let hosts: string[] = [];
  try {
    const idx = gmGet<string[]>(CACHE_INDEX_KEY, []);
    if (Array.isArray(idx)) {
      hosts = idx;
    }
  } catch {
    return [];
  }
  const out: SiteTranslationsFile[] = [];
  for (const host of hosts) {
    try {
      const entry = gmGet<SiteTranslationsFile | null>(
        `${CACHE_PREFIX}${host}`,
        null
      );
      if (entry && typeof entry === "object" && entry.locales) {
        out.push(entry);
      }
    } catch {
      // Skip unreadable entries
    }
  }
  return out;
}

export function saveCachedSiteTranslations(file: SiteTranslationsFile): void {
  const host = file.host.toLowerCase().trim();
  if (!(host && file.locales) || typeof file.locales !== "object") {
    throw new Error("Invalid site translations file: missing host or locales.");
  }
  const normalized: SiteTranslationsFile = {
    version: Number(file.version) || 1,
    host,
    locales: file.locales,
  };
  gmSet(`${CACHE_PREFIX}${host}`, normalized);
  recordCachedHost(host);
}

export function deleteCachedSiteTranslations(hostname: string): void {
  const host = hostname.toLowerCase().trim();
  if (!host) {
    return;
  }
  gmSet(`${CACHE_PREFIX}${host}`, null);
  removeCachedHostFromIndex(host);
}

async function fetchJsonWithCache<T extends object>(
  url: string,
  cacheKey: string,
  host: string,
  onChange?: (next: T) => void
): Promise<T | null> {
  const cached = gmGet<T | null>(cacheKey, null);
  const fresh = gmFetch(url, 8000).then((body) => JSON.parse(body) as T);

  if (cached && typeof cached === "object") {
    recordCachedHost(host);
    void fresh
      .then((next) => {
        if (JSON.stringify(cached) !== JSON.stringify(next)) {
          gmSet(cacheKey, next);
          recordCachedHost(host);
          onChange?.(next);
        }
      })
      .catch(() => {
        // Keep cached volunteer set offline or if absent
      });
    return cached;
  }

  try {
    const next = await fresh;
    gmSet(cacheKey, next);
    recordCachedHost(host);
    return next;
  } catch {
    return null;
  }
}

export async function loadSiteTranslations(
  baseUrl: string,
  hostname: string,
  onChange?: (next: SiteTranslationsFile) => void
): Promise<SiteTranslationsFile | null> {
  const host = hostname.toLowerCase();
  if (!host) {
    return null;
  }

  const cleanBase = baseUrl.replace(/\/+$/u, "");
  const rootUrl = `${cleanBase}/${encodeURIComponent(host)}.json`;
  const rootFile = await fetchJsonWithCache<SiteTranslationsFile>(
    rootUrl,
    `${CACHE_PREFIX}${host}`,
    host,
    (next) => {
      onChange?.(next);
    }
  );
  if (!rootFile?.locales) {
    return null;
  }

  return rootFile;
}

export function pickLocaleTable(
  file: SiteTranslationsFile | null,
  targetLang: string
): SiteLocaleTable | null {
  if (!file?.locales) {
    return null;
  }
  const exact = file.locales[targetLang];
  if (exact) {
    return exact;
  }
  const lower = targetLang.toLowerCase().replace(/_/gu, "-");
  if (lower === "zh-tw" || lower === "zh-hant") {
    return file.locales["zh-Hant-TW"] ?? file.locales["zh-Hant"] ?? null;
  }
  if (lower === "zh-cn" || lower === "zh-hans") {
    return file.locales["zh-Hans-CN"] ?? file.locales["zh-Hans"] ?? null;
  }
  const base = lower.split("-")[0];
  return base ? (file.locales[base] ?? null) : null;
}
