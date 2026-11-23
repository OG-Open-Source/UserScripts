import type { StyleReader } from "../../../capture/display-role";
import { encodeInlineNodes } from "../../../capture/inline-codec";
import type { TranslationSegment } from "../../../capture/segmenter";
import { collectSegments } from "../../../capture/segmenter";
import { mergeLocaleTables } from "../../../dict/store";
import type { SiteLocaleScope, SiteLocaleTable } from "../../../dict/template";
import {
  extractTemplate,
  matchSiteTranslation,
  suggestScopeSelector,
} from "../../../dict/template";
import type { CompiledSiteDelta } from "../../../structure/site-rules";
import type { ParsedAiImport } from "../../export-ai";

export interface VolunteerConflict {
  existing: string;
  id: string;
  imported: string;
  key: string;
  kind: "static" | "dynamic";
  scope?: string;
}

export interface CapturedVolunteerEntry {
  hit: boolean;
  key: string;
  kind: "static" | "dynamic";
  matchedScope: string | null;
  seg: TranslationSegment;
  values: string[];
}

export interface VolunteerScanResult {
  dynamicCount: number;
  entries: CapturedVolunteerEntry[];
  hitCount: number;
  staticCount: number;
}

export function scanVolunteerEntries(
  doc: Document,
  delta: CompiledSiteDelta,
  siteTable: SiteLocaleTable | null,
  getStyle?: StyleReader
): VolunteerScanResult {
  const root = doc.body ?? doc.documentElement;
  const segs = root
    ? collectSegments(root, delta, getStyle ? { getStyle } : undefined)
    : [];

  const entries: CapturedVolunteerEntry[] = [];
  let staticCount = 0;
  let dynamicCount = 0;
  let hitCount = 0;

  for (const seg of segs) {
    const enc = encodeInlineNodes(seg.nodes, delta);
    const ext = extractTemplate(enc.payloadHtml);
    const hit = matchSiteTranslation(enc.payloadHtml, siteTable, seg.container);
    if (ext.kind === "dynamic") {
      dynamicCount += 1;
    } else {
      staticCount += 1;
    }
    if (hit) {
      hitCount += 1;
    }
    entries.push({
      seg,
      kind: ext.kind,
      key: ext.template,
      values: ext.values,
      hit: Boolean(hit),
      matchedScope: hit?.scope ?? null,
    });
  }

  return { entries, staticCount, dynamicCount, hitCount };
}

export function suggestEntryScope(entry: CapturedVolunteerEntry): string {
  return suggestScopeSelector(entry.seg.container);
}

export function buildDraftPatch(
  entry: CapturedVolunteerEntry,
  translation: string,
  scopeSelector: string
): SiteLocaleTable {
  const scope = scopeSelector.trim();
  const bucketKey = entry.kind === "dynamic" ? "dynamic" : "static";
  if (scope) {
    const scopedEntry: SiteLocaleScope = {
      [bucketKey]: { [entry.key]: translation },
    };
    return { scoped: { [scope]: scopedEntry } };
  }
  return { [bucketKey]: { [entry.key]: translation } };
}

function diffBucket(
  incoming: Record<string, string> | undefined,
  existingBucket: Record<string, string> | undefined,
  kind: "static" | "dynamic",
  conflicts: VolunteerConflict[],
  scope?: string
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!incoming) {
    return out;
  }
  const prefix = scope ? `scoped:${scope}:${kind}` : kind;
  for (const [k, v] of Object.entries(incoming)) {
    const existing = existingBucket?.[k];
    if (existing && existing !== v) {
      conflicts.push({
        id: `${prefix}:${k}`,
        kind,
        key: k,
        ...(scope ? { scope } : {}),
        existing,
        imported: v,
      });
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function diffImportConflicts(
  parsed: ParsedAiImport,
  localTable: SiteLocaleTable | null
): { conflicts: VolunteerConflict[]; patch: SiteLocaleTable } {
  const conflicts: VolunteerConflict[] = [];
  const patchStatic = diffBucket(
    parsed.static,
    localTable?.static,
    "static",
    conflicts
  );
  const patchDynamic = diffBucket(
    parsed.dynamic,
    localTable?.dynamic,
    "dynamic",
    conflicts
  );
  const patchScoped: Record<string, SiteLocaleScope> = {};

  for (const [sel, sc] of Object.entries(parsed.scoped)) {
    const localScope = localTable?.scoped?.[sel];
    const nextStatic = diffBucket(
      sc.static,
      localScope?.static,
      "static",
      conflicts,
      sel
    );
    const nextDynamic = diffBucket(
      sc.dynamic,
      localScope?.dynamic,
      "dynamic",
      conflicts,
      sel
    );
    const nextScope: SiteLocaleScope = {};
    if (Object.keys(nextStatic).length > 0) {
      nextScope.static = nextStatic;
    }
    if (Object.keys(nextDynamic).length > 0) {
      nextScope.dynamic = nextDynamic;
    }
    if (nextScope.static || nextScope.dynamic) {
      patchScoped[sel] = nextScope;
    }
  }

  const patch: SiteLocaleTable = {};
  if (Object.keys(patchStatic).length > 0) {
    patch.static = patchStatic;
  }
  if (Object.keys(patchDynamic).length > 0) {
    patch.dynamic = patchDynamic;
  }
  if (Object.keys(patchScoped).length > 0) {
    patch.scoped = patchScoped;
  }

  return { conflicts, patch };
}

export function buildConflictResolutionPatch(
  conflict: VolunteerConflict,
  choice: "keep" | "overwrite"
): SiteLocaleTable | null {
  if (choice === "keep") {
    return null;
  }
  const bucketKey = conflict.kind === "dynamic" ? "dynamic" : "static";
  if (conflict.scope) {
    return {
      scoped: {
        [conflict.scope]: {
          [bucketKey]: { [conflict.key]: conflict.imported },
        },
      },
    };
  }
  return { [bucketKey]: { [conflict.key]: conflict.imported } };
}

export function buildVolunteerExportJson(
  hostname: string,
  targetLang: string,
  localTable: SiteLocaleTable | null,
  draftPatch: SiteLocaleTable | null
): string {
  const merged =
    mergeLocaleTables(localTable ?? undefined, draftPatch ?? undefined) ?? {};
  return JSON.stringify(
    {
      version: 1,
      host: hostname,
      locales: {
        [targetLang]: merged,
      },
    },
    null,
    2
  );
}
