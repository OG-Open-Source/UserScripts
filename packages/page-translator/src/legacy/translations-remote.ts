import { gmFetch, gmGet, gmSet } from "@userscripts/shared";
import type { SiteLocaleScope, SiteLocaleTable } from "./transform/template";

export interface SiteTranslationsFile {
  host: string;
  locales: Record<string, SiteLocaleTable>;
  version: number;
}

export interface LayeredSiteEntry {
  file: SiteTranslationsFile;
  hasLocal: boolean;
  hasRemote: boolean;
}

const REMOTE_PREFIX = "ptr:site-tr-remote:";
const LOCAL_PREFIX = "ptr:site-tr-local:";
const LEGACY_PREFIX = "ptr:site-tr:";
const CACHE_INDEX_KEY = "ptr:site-tr:__index";
const TRAILING_SLASHES_RE = /\/+$/u;

function compareStrings(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().trim();
}

function safeGmGet<T>(key: string, defaultValue: T): T {
  try {
    return gmGet<T>(key, defaultValue);
  } catch {
    return defaultValue;
  }
}

function safeGmSet(key: string, value: unknown): void {
  try {
    gmSet(key, value);
  } catch {
    // Ignore if GM storage is not configured in tests
  }
}

function isSiteFileLike(entry: unknown): entry is SiteTranslationsFile {
  return Boolean(
    entry &&
      typeof entry === "object" &&
      (entry as SiteTranslationsFile).locales &&
      typeof (entry as SiteTranslationsFile).locales === "object"
  );
}

function normalizeSiteFile(
  file: SiteTranslationsFile,
  fallbackHost?: string
): SiteTranslationsFile {
  const host = normalizeHost(file.host || fallbackHost || "");
  if (!(host && file.locales) || typeof file.locales !== "object") {
    throw new Error("Invalid site translations file: missing host or locales.");
  }
  return {
    version: Number(file.version) || 1,
    host,
    locales: file.locales,
  };
}

function readStoredFile(
  prefix: string,
  host: string
): SiteTranslationsFile | null {
  const entry = safeGmGet<SiteTranslationsFile | null>(
    `${prefix}${host}`,
    null
  );
  if (!isSiteFileLike(entry)) {
    return null;
  }
  return {
    version: Number(entry.version) || 1,
    host: normalizeHost(entry.host || host),
    locales: entry.locales,
  };
}

function recordCachedHost(host: string): void {
  const clean = normalizeHost(host);
  if (!clean) {
    return;
  }
  const prev = safeGmGet<string[]>(CACHE_INDEX_KEY, []);
  const list = Array.isArray(prev) ? prev : [];
  if (!list.includes(clean)) {
    safeGmSet(CACHE_INDEX_KEY, [...list, clean].sort(compareStrings));
  }
}

function removeCachedHostFromIndex(host: string): void {
  const clean = normalizeHost(host);
  const prev = safeGmGet<string[]>(CACHE_INDEX_KEY, []);
  if (!Array.isArray(prev)) {
    return;
  }
  safeGmSet(
    CACHE_INDEX_KEY,
    prev.filter((h) => h !== clean)
  );
}

function mergeScope(
  remote?: SiteLocaleScope | null,
  local?: SiteLocaleScope | null
): SiteLocaleScope {
  const mergedStatic = {
    ...(remote?.static ?? {}),
    ...(local?.static ?? {}),
  };
  const mergedDynamic = {
    ...(remote?.dynamic ?? {}),
    ...(local?.dynamic ?? {}),
  };
  const out: SiteLocaleScope = {};
  if (Object.keys(mergedStatic).length > 0) {
    out.static = mergedStatic;
  }
  if (Object.keys(mergedDynamic).length > 0) {
    out.dynamic = mergedDynamic;
  }
  return out;
}

export function mergeLocaleTables(
  remote?: SiteLocaleTable | null,
  local?: SiteLocaleTable | null
): SiteLocaleTable | null {
  if (!(remote || local)) {
    return null;
  }
  const mergedStatic = {
    ...(remote?.static ?? {}),
    ...(local?.static ?? {}),
  };
  const mergedDynamic = {
    ...(remote?.dynamic ?? {}),
    ...(local?.dynamic ?? {}),
  };
  const scopeKeys = new Set([
    ...Object.keys(remote?.scoped ?? {}),
    ...Object.keys(local?.scoped ?? {}),
  ]);
  const mergedScoped: Record<string, SiteLocaleScope> = {};
  for (const sel of scopeKeys) {
    const merged = mergeScope(remote?.scoped?.[sel], local?.scoped?.[sel]);
    if (merged.static || merged.dynamic) {
      mergedScoped[sel] = merged;
    }
  }
  const out: SiteLocaleTable = {};
  if (Object.keys(mergedStatic).length > 0) {
    out.static = mergedStatic;
  }
  if (Object.keys(mergedDynamic).length > 0) {
    out.dynamic = mergedDynamic;
  }
  if (Object.keys(mergedScoped).length > 0) {
    out.scoped = mergedScoped;
  }
  return out;
}

export function mergeSiteTranslations(
  remote: SiteTranslationsFile | null,
  local: SiteTranslationsFile | null
): SiteTranslationsFile | null {
  if (!(remote || local)) {
    return null;
  }
  const host = normalizeHost(local?.host || remote?.host || "");
  const version = Math.max(
    Number(remote?.version) || 1,
    Number(local?.version) || 1
  );
  const localeKeys = new Set([
    ...Object.keys(remote?.locales ?? {}),
    ...Object.keys(local?.locales ?? {}),
  ]);
  const locales: Record<string, SiteLocaleTable> = {};
  for (const loc of localeKeys) {
    const merged = mergeLocaleTables(
      remote?.locales?.[loc],
      local?.locales?.[loc]
    );
    if (merged) {
      locales[loc] = merged;
    }
  }
  return {
    version,
    host,
    locales,
  };
}

export function loadLocalSiteTranslations(
  hostname: string
): SiteTranslationsFile | null {
  const host = normalizeHost(hostname);
  if (!host) {
    return null;
  }
  return readStoredFile(LOCAL_PREFIX, host);
}

export function saveLocalSiteTranslations(
  file: SiteTranslationsFile
): SiteTranslationsFile {
  const normalized = normalizeSiteFile(file);
  safeGmSet(`${LOCAL_PREFIX}${normalized.host}`, normalized);
  recordCachedHost(normalized.host);
  return normalized;
}

export function mergeLocalSiteLocaleTable(
  hostname: string,
  targetLang: string,
  patch: SiteLocaleTable
): SiteTranslationsFile {
  const host = normalizeHost(hostname);
  const lang = targetLang.trim();
  if (!(host && lang)) {
    throw new Error(
      "Invalid site translation patch: missing host or targetLang."
    );
  }
  const existing = loadLocalSiteTranslations(host);
  const nextTable = mergeLocaleTables(existing?.locales?.[lang], patch) ?? {};
  const nextFile: SiteTranslationsFile = {
    version: existing?.version ?? 1,
    host,
    locales: {
      ...(existing?.locales ?? {}),
      [lang]: nextTable,
    },
  };
  return saveLocalSiteTranslations(nextFile);
}

export function listLayeredSiteTranslations(): LayeredSiteEntry[] {
  const idx = safeGmGet<string[]>(CACHE_INDEX_KEY, []);
  const hosts = Array.isArray(idx) ? idx : [];
  const out: LayeredSiteEntry[] = [];
  for (const rawHost of hosts) {
    const host = normalizeHost(String(rawHost ?? ""));
    if (!host) {
      continue;
    }
    const local = readStoredFile(LOCAL_PREFIX, host);
    let remote = readStoredFile(REMOTE_PREFIX, host);
    if (!(local || remote)) {
      remote = readStoredFile(LEGACY_PREFIX, host);
    }
    const file = mergeSiteTranslations(remote, local);
    if (file) {
      out.push({
        file,
        hasLocal: local !== null,
        hasRemote: remote !== null,
      });
    }
  }
  return out;
}

export function deleteLayeredSiteTranslations(
  hostname: string
): "cleared-local" | "cleared-all" | "noop" {
  const host = normalizeHost(hostname);
  if (!host) {
    return "noop";
  }
  const local = readStoredFile(LOCAL_PREFIX, host);
  const remote = readStoredFile(REMOTE_PREFIX, host);
  const legacy = readStoredFile(LEGACY_PREFIX, host);

  if (local) {
    safeGmSet(`${LOCAL_PREFIX}${host}`, null);
    if (remote || legacy) {
      return "cleared-local";
    }
    removeCachedHostFromIndex(host);
    return "cleared-all";
  }

  if (remote || legacy) {
    safeGmSet(`${REMOTE_PREFIX}${host}`, null);
    safeGmSet(`${LEGACY_PREFIX}${host}`, null);
    removeCachedHostFromIndex(host);
    return "cleared-all";
  }

  return "noop";
}

export function listCachedSiteTranslations(): SiteTranslationsFile[] {
  return listLayeredSiteTranslations().map((entry) => entry.file);
}

export function saveCachedSiteTranslations(file: SiteTranslationsFile): void {
  saveLocalSiteTranslations(file);
}

export function deleteCachedSiteTranslations(hostname: string): void {
  deleteLayeredSiteTranslations(hostname);
}

export async function loadSiteTranslations(
  baseUrl: string,
  hostname: string,
  onChange?: (next: SiteTranslationsFile) => void
): Promise<SiteTranslationsFile | null> {
  const host = normalizeHost(hostname);
  if (!host) {
    return null;
  }

  const remoteKey = `${REMOTE_PREFIX}${host}`;
  let cached = readStoredFile(REMOTE_PREFIX, host);
  if (!cached) {
    const legacy = readStoredFile(LEGACY_PREFIX, host);
    if (legacy) {
      cached = legacy;
      safeGmSet(remoteKey, legacy);
      safeGmSet(`${LEGACY_PREFIX}${host}`, null);
      recordCachedHost(host);
    }
  }

  const cleanBase = baseUrl.replace(TRAILING_SLASHES_RE, "");
  const rootUrl = `${cleanBase}/${encodeURIComponent(host)}.json`;
  const fresh = gmFetch(rootUrl, 8000).then(
    (body) => JSON.parse(body) as SiteTranslationsFile
  );

  if (cached) {
    recordCachedHost(host);
    void fresh
      .then((next) => {
        if (
          isSiteFileLike(next) &&
          JSON.stringify(cached) !== JSON.stringify(next)
        ) {
          const normalized = normalizeSiteFile(next, host);
          safeGmSet(remoteKey, normalized);
          recordCachedHost(host);
          onChange?.(normalized);
        }
      })
      .catch(() => {
        // Keep cached volunteer set offline or if absent
      });
    return cached;
  }

  try {
    const next = await fresh;
    if (!isSiteFileLike(next)) {
      return null;
    }
    const normalized = normalizeSiteFile(next, host);
    safeGmSet(remoteKey, normalized);
    recordCachedHost(host);
    return normalized;
  } catch {
    return null;
  }
}

export function pickLocaleTable(
  file: SiteTranslationsFile | null,
  targetLang: string
): SiteLocaleTable | null {
  if (!file?.locales) {
    return null;
  }
  const locales: Record<string, SiteLocaleTable | undefined> = file.locales;
  const exact = locales[targetLang];
  if (exact) {
    return exact;
  }
  const lower = targetLang.toLowerCase().replace(/_/gu, "-");
  if (lower === "zh-tw" || lower === "zh-hant") {
    return locales["zh-Hant-TW"] ?? locales["zh-Hant"] ?? null;
  }
  if (lower === "zh-cn" || lower === "zh-hans") {
    return locales["zh-Hans-CN"] ?? locales["zh-Hans"] ?? null;
  }
  const [base] = lower.split("-");
  return base ? (locales[base] ?? null) : null;
}
