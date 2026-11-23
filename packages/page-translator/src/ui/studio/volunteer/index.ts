import { isUsUiEvent } from "@userscripts/shared";
import type { StyleReader } from "../../../capture/display-role";
import { mergeLocaleTables } from "../../../dict/store";
import type { SiteLocaleTable } from "../../../dict/template";
import type { TabStorage } from "../../../platform/activation";
import { createTabActivationManager } from "../../../platform/activation";
import type { TranslatorConfig } from "../../../platform/config";
import type { PtrMessageKey } from "../../../platform/i18n";
import { formatPtrMsg, MESSAGES_EN } from "../../../platform/i18n";
import type { CompiledSiteDelta } from "../../../structure/site-rules";
import {
  buildAiTranslationExport,
  parseAiTranslationImport,
} from "../../export-ai";
import type { VolunteerConflict, VolunteerScanResult } from "./logic";
import {
  buildConflictResolutionPatch,
  buildDraftPatch,
  buildVolunteerExportJson,
  diffImportConflicts,
  resolveInitialEntryValue,
  scanVolunteerEntries,
  suggestEntryScope,
} from "./logic";
import type { VolunteerView } from "./view";
import { mountVolunteerView } from "./view";

export interface VolunteerControllerOptions {
  doc: Document;
  getConfig: () => TranslatorConfig;
  getDelta: () => CompiledSiteDelta;
  getLocalLocaleTable?: () => SiteLocaleTable | null;
  getSiteLocaleTable: () => SiteLocaleTable | null;
  getStyle?: StyleReader;
  getTargetLang: () => string;
  hostname: string;
  isClickBlocked?: () => boolean;
  onSiteDictUpdated?: () => void;
  onSyncLocalTable?: (patch: SiteLocaleTable) => void;
  onToggle?: (active: boolean) => void;
  setClickBlocked?: (next: boolean) => void;
  storage?: TabStorage | null;
  t?: (key: PtrMessageKey) => string;
}

export interface VolunteerController {
  isActive: () => boolean;
  rescan: () => void;
  stop: () => void;
  syncFromConfig: () => void;
  toggle: () => void;
}

export function createVolunteerController(
  options: VolunteerControllerOptions
): VolunteerController {
  const activation = createTabActivationManager({
    getConfig: options.getConfig,
    storage: options.storage,
  });
  const t = options.t ?? ((key: PtrMessageKey) => MESSAGES_EN[key]);
  let view: VolunteerView | null = null;
  let lastScan: VolunteerScanResult | null = null;
  let currentIndex = 0;
  let draftPatch: SiteLocaleTable | null = null;
  let conflicts: VolunteerConflict[] = [];
  let clickLockHandler: ((e: Event) => void) | null = null;

  const isVolunteerEnabled = (): boolean => {
    const cfg = options.getConfig();
    return cfg.uiTier === "studio" && activation.isActive("volunteer");
  };

  const renderCurrentEntry = (): void => {
    const entries = lastScan?.entries ?? [];
    if (currentIndex >= entries.length) {
      currentIndex = Math.max(0, entries.length - 1);
    }
    const entry = entries[currentIndex] ?? null;
    const effectiveLocal =
      mergeLocaleTables(
        options.getLocalLocaleTable?.() ?? undefined,
        draftPatch ?? undefined
      ) ?? null;
    const initialValue = entry
      ? resolveInitialEntryValue(
          entry,
          entry.matchedScope ?? "",
          effectiveLocal,
          options.getSiteLocaleTable()
        )
      : "";
    view?.renderEntry(
      entry,
      currentIndex,
      entries.length,
      options.getTargetLang(),
      initialValue
    );
  };

  const rescan = (): void => {
    const cfg = options.getConfig();
    lastScan = scanVolunteerEntries(
      options.doc,
      options.getDelta(),
      options.getSiteLocaleTable(),
      options.getStyle
    );
    view?.renderScan(lastScan, cfg.themeMode);
    renderCurrentEntry();
  };

  const syncClickLock = (): void => {
    const locked = Boolean(
      isVolunteerEnabled() &&
        (options.isClickBlocked?.() ?? options.getConfig().volunteerBlockClicks)
    );
    view?.renderLock(locked);
    if (locked && !clickLockHandler) {
      clickLockHandler = (e: Event): void => {
        if (isUsUiEvent(e, view?.host ?? null)) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
      };
      options.doc.addEventListener("click", clickLockHandler, true);
    } else if (!locked && clickLockHandler) {
      options.doc.removeEventListener("click", clickLockHandler, true);
      clickLockHandler = null;
    }
  };

  const unmount = (): void => {
    if (clickLockHandler) {
      options.doc.removeEventListener("click", clickLockHandler, true);
      clickLockHandler = null;
    }
    view?.destroy();
    view = null;
  };

  const mount = (): void => {
    if (!view) {
      view = mountVolunteerView(
        options.doc,
        options.hostname,
        {
          onToggleLock: () => {
            const current =
              options.isClickBlocked?.() ??
              options.getConfig().volunteerBlockClicks;
            options.setClickBlocked?.(!current);
            syncClickLock();
            view?.setMessage(t(current ? "volLockOffMsg" : "volLockOnMsg"));
          },
          onRescan: rescan,
          onPrev: () => {
            const total = lastScan?.entries.length ?? 0;
            if (total > 0) {
              currentIndex = (currentIndex - 1 + total) % total;
              renderCurrentEntry();
            }
          },
          onNext: () => {
            const total = lastScan?.entries.length ?? 0;
            if (total > 0) {
              currentIndex = (currentIndex + 1) % total;
              renderCurrentEntry();
            }
          },
          onSuggestScope: () => {
            const entry = lastScan?.entries[currentIndex];
            return entry ? suggestEntryScope(entry) : "";
          },
          onSaveDraft: (translation, scope) => {
            const entry = lastScan?.entries[currentIndex];
            if (!(entry && translation.trim())) {
              return;
            }
            const patch = buildDraftPatch(entry, translation.trim(), scope);
            draftPatch =
              mergeLocaleTables(draftPatch ?? undefined, patch) ?? null;
            options.onSyncLocalTable?.(patch);
            options.onSiteDictUpdated?.();
            view?.setMessage(
              formatPtrMsg(t("volSaved"), { preview: translation.trim() })
            );
          },
          onExportAi: () => {
            const bundle = buildAiTranslationExport(
              options.doc,
              options.getDelta(),
              {
                getStyle: options.getStyle,
                hostname: options.hostname,
                siteTable: options.getSiteLocaleTable(),
                targetLang: options.getTargetLang(),
              }
            );
            void navigator.clipboard?.writeText(bundle.prompt);
          },
          onApplyImport: (rawJson) => {
            try {
              const parsed = parseAiTranslationImport(
                rawJson,
                options.getTargetLang()
              );
              const result = diffImportConflicts(
                parsed,
                options.getLocalLocaleTable?.() ?? options.getSiteLocaleTable()
              );
              if (Object.keys(result.patch).length > 0) {
                options.onSyncLocalTable?.(result.patch);
                options.onSiteDictUpdated?.();
              }
              ({ conflicts } = result);
              view?.renderConflicts(conflicts);
              view?.setMessage(t("volDraftReady"));
            } catch {
              view?.setMessage(t("volImportError"));
            }
          },
          onResolveConflict: (id, choice) => {
            const target = conflicts.find((c) => c.id === id);
            if (!target) {
              return;
            }
            const patch = buildConflictResolutionPatch(target, choice);
            if (patch) {
              options.onSyncLocalTable?.(patch);
              options.onSiteDictUpdated?.();
            }
            conflicts = conflicts.filter((c) => c.id !== id);
            view?.renderConflicts(conflicts);
            view?.setMessage(t("volConflictResolved"));
          },
          onResolveAllConflicts: (choice) => {
            if (conflicts.length === 0) {
              return;
            }
            let mergedPatch: SiteLocaleTable | undefined;
            for (const conflict of conflicts) {
              const patch = buildConflictResolutionPatch(conflict, choice);
              if (patch) {
                mergedPatch =
                  mergeLocaleTables(mergedPatch, patch) ?? undefined;
              }
            }
            if (mergedPatch) {
              options.onSyncLocalTable?.(mergedPatch);
              options.onSiteDictUpdated?.();
            }
            conflicts = [];
            view?.renderConflicts(conflicts);
            view?.setMessage(t("volConflictResolved"));
          },
          onCopyJson: () => {
            const json = buildVolunteerExportJson(
              options.hostname,
              options.getTargetLang(),
              options.getLocalLocaleTable?.() ?? options.getSiteLocaleTable(),
              draftPatch
            );
            void navigator.clipboard?.writeText(json);
            view?.setMessage(t("volCopied"));
          },
        },
        t
      );
    }
    rescan();
    syncClickLock();
  };

  const syncFromConfig = (): void => {
    if (isVolunteerEnabled()) {
      mount();
    } else {
      unmount();
    }
  };

  return {
    syncFromConfig,
    rescan,
    isActive: () => isVolunteerEnabled(),
    toggle(): void {
      const next = !activation.isActive("volunteer");
      activation.setActive("volunteer", next);
      if (!next) {
        options.setClickBlocked?.(false);
      }
      syncFromConfig();
      options.onToggle?.(isVolunteerEnabled());
    },
    stop(): void {
      unmount();
    },
  };
}
