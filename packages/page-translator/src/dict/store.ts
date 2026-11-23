import { gmGet, gmSet } from "@userscripts/shared";
import type { SiteLocaleScope, SiteLocaleTable } from "./template";

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

export interface DictStorage {
  get: <T>(key: string, defaultValue: T) => T;
  set: (key: string, value: unknown) => void;
}

const REMOTE_PREFIX = "ptr:site-tr-remote:";
const LOCAL_PREFIX = "ptr:site-tr-local:";
const LEGACY_PREFIX = "ptr:site-tr:";
const CACHE_INDEX_KEY = "ptr:site-tr:__index";

export const defaultDictStorage: DictStorage = {
  get<T>(key: string, defaultValue: T): T {
    try {
      return gmGet<T>(key, defaultValue);
    } catch {
      return defaultValue;
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

function compareStrings(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().trim();
}

function safeGet<T>(storage: DictStorage, key: string, defaultValue: T): T {
  try {
    return storage.get<T>(key, defaultValue);
  } catch {
    return defaultValue;
  }
}

function safeSet(storage: DictStorage, key: string, value: unknown): void {
  try {
    storage.set(key, value);
  } catch {
    // Dictionary data remains usable in memory when storage is unavailable.
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
  host: string,
  storage: DictStorage
): SiteTranslationsFile | null {
  const entry = safeGet<SiteTranslationsFile | null>(
    storage,
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

function recordCachedHost(host: string, storage: DictStorage): void {
  const clean = normalizeHost(host);
  if (!clean) {
    return;
  }
  const previous = safeGet<string[]>(storage, CACHE_INDEX_KEY, []);
  const list = Array.isArray(previous) ? previous : [];
  if (!list.includes(clean)) {
    safeSet(storage, CACHE_INDEX_KEY, [...list, clean].sort(compareStrings));
  }
}

function removeCachedHostFromIndex(host: string, storage: DictStorage): void {
  const clean = normalizeHost(host);
  const previous = safeGet<string[]>(storage, CACHE_INDEX_KEY, []);
  if (!Array.isArray(previous)) {
    return;
  }
  safeSet(
    storage,
    CACHE_INDEX_KEY,
    previous.filter((entry) => entry !== clean)
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
  for (const selector of scopeKeys) {
    const merged = mergeScope(
      remote?.scoped?.[selector],
      local?.scoped?.[selector]
    );
    if (merged.static || merged.dynamic) {
      mergedScoped[selector] = merged;
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
  for (const locale of localeKeys) {
    const merged = mergeLocaleTables(
      remote?.locales?.[locale],
      local?.locales?.[locale]
    );
    if (merged) {
      locales[locale] = merged;
    }
  }
  return { version, host, locales };
}

export function loadLocalSiteTranslations(
  hostname: string,
  storage: DictStorage = defaultDictStorage
): SiteTranslationsFile | null {
  const host = normalizeHost(hostname);
  if (!host) {
    return null;
  }
  return readStoredFile(LOCAL_PREFIX, host, storage);
}

export function saveLocalSiteTranslations(
  file: SiteTranslationsFile,
  storage: DictStorage = defaultDictStorage
): SiteTranslationsFile {
  const normalized = normalizeSiteFile(file);
  safeSet(storage, `${LOCAL_PREFIX}${normalized.host}`, normalized);
  recordCachedHost(normalized.host, storage);
  return normalized;
}

export function mergeLocalSiteLocaleTable(
  hostname: string,
  targetLang: string,
  patch: SiteLocaleTable,
  storage: DictStorage = defaultDictStorage
): SiteTranslationsFile {
  const host = normalizeHost(hostname);
  const lang = targetLang.trim();
  if (!(host && lang)) {
    throw new Error(
      "Invalid site translation patch: missing host or targetLang."
    );
  }
  const existing = loadLocalSiteTranslations(host, storage);
  const nextTable = mergeLocaleTables(existing?.locales?.[lang], patch) ?? {};
  const nextFile: SiteTranslationsFile = {
    version: existing?.version ?? 1,
    host,
    locales: {
      ...(existing?.locales ?? {}),
      [lang]: nextTable,
    },
  };
  return saveLocalSiteTranslations(nextFile, storage);
}

export function loadRemoteSiteTranslations(
  hostname: string,
  storage: DictStorage = defaultDictStorage
): SiteTranslationsFile | null {
  const host = normalizeHost(hostname);
  if (!host) {
    return null;
  }
  return (
    readStoredFile(REMOTE_PREFIX, host, storage) ??
    readStoredFile(LEGACY_PREFIX, host, storage)
  );
}

export function saveRemoteSiteTranslations(
  file: SiteTranslationsFile,
  storage: DictStorage = defaultDictStorage
): SiteTranslationsFile {
  const normalized = normalizeSiteFile(file);
  safeSet(storage, `${REMOTE_PREFIX}${normalized.host}`, normalized);
  recordCachedHost(normalized.host, storage);
  return normalized;
}

export function listLayeredSiteTranslations(
  storage: DictStorage = defaultDictStorage
): LayeredSiteEntry[] {
  const index = safeGet<string[]>(storage, CACHE_INDEX_KEY, []);
  const hosts = Array.isArray(index) ? index : [];
  const out: LayeredSiteEntry[] = [];
  for (const rawHost of hosts) {
    const host = normalizeHost(String(rawHost ?? ""));
    if (!host) {
      continue;
    }
    const local = readStoredFile(LOCAL_PREFIX, host, storage);
    let remote = readStoredFile(REMOTE_PREFIX, host, storage);
    if (!(local || remote)) {
      remote = readStoredFile(LEGACY_PREFIX, host, storage);
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
  hostname: string,
  storage: DictStorage = defaultDictStorage
): "cleared-local" | "cleared-all" | "noop" {
  const host = normalizeHost(hostname);
  if (!host) {
    return "noop";
  }
  const local = readStoredFile(LOCAL_PREFIX, host, storage);
  const remote = readStoredFile(REMOTE_PREFIX, host, storage);
  const legacy = readStoredFile(LEGACY_PREFIX, host, storage);

  if (local) {
    safeSet(storage, `${LOCAL_PREFIX}${host}`, null);
    if (remote || legacy) {
      return "cleared-local";
    }
    removeCachedHostFromIndex(host, storage);
    return "cleared-all";
  }

  if (remote || legacy) {
    safeSet(storage, `${REMOTE_PREFIX}${host}`, null);
    safeSet(storage, `${LEGACY_PREFIX}${host}`, null);
    removeCachedHostFromIndex(host, storage);
    return "cleared-all";
  }

  return "noop";
}

export function listCachedSiteTranslations(
  storage: DictStorage = defaultDictStorage
): SiteTranslationsFile[] {
  return listLayeredSiteTranslations(storage).map((entry) => entry.file);
}

export function saveCachedSiteTranslations(
  file: SiteTranslationsFile,
  storage: DictStorage = defaultDictStorage
): void {
  saveLocalSiteTranslations(file, storage);
}

export function deleteCachedSiteTranslations(
  hostname: string,
  storage: DictStorage = defaultDictStorage
): void {
  deleteLayeredSiteTranslations(hostname, storage);
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
