import { isUsUiEvent } from "@userscripts/shared";
import type { LiveCaptureCandidate } from "../../../capture/export";
import { collectLiveCaptureCandidates } from "../../../capture/export";
import { mergeLocaleTables } from "../../../dict/store";
import type { SiteLocaleTable } from "../../../dict/template";
import type { TranslatorConfig } from "../../../platform/config";
import type { PtrMessageKey } from "../../../platform/i18n";
import { formatPtrMsg, MESSAGES_EN } from "../../../platform/i18n";
import type { PtrMetrics } from "../../../platform/metrics";
import type { SiteStructureAdapter } from "../../../structure/adapter";
import type {
  CompiledSiteDelta,
  SiteModifier,
} from "../../../structure/site-rules";
import {
  appendSiteDeltaRule,
  suggestSelectorForElement,
} from "../../../structure/site-rules";
import {
  buildAiTranslationExport,
  parseAiTranslationImport,
} from "../../export-ai";
import type { InspectScanResult } from "../inspect/logic";
import { buildInspectDiagnostics, scanInspectSegments } from "../inspect/logic";
import type {
  VolunteerConflict,
  VolunteerScanResult,
} from "../volunteer/logic";
import {
  buildConflictResolutionPatch,
  buildDraftPatch,
  buildVolunteerExportJson,
  diffImportConflicts,
  resolveInitialEntryValue,
  scanVolunteerEntries,
  suggestEntryScope,
} from "../volunteer/logic";
import type {
  createStudioBreakpointGate,
  StudioNodeFilterTab,
  StudioRecordState,
} from "./logic";
import {
  appendStudioActivity,
  buildRawNodesExportJson,
  clearStudioActivity,
  createStudioRecordState,
  filterStudioCandidates,
  findCandidateIndexForElement,
} from "./logic";
import type { StudioBoxMode } from "./overlay";
import { projectCandidateBoxes } from "./overlay";
import type { StudioStageHandle, StudioZoomPreset } from "./stage";
import { mountStudioStage } from "./stage";
import type {
  StudioBottomTab,
  StudioRightTab,
  StudioWorkspaceView,
} from "./view";
import { mountStudioWorkspaceView } from "./view";

export interface StudioWorkspaceControllerOptions {
  breakpointGate?: ReturnType<typeof createStudioBreakpointGate>;
  doc: Document;
  getAdapter: () => SiteStructureAdapter;
  getConfig: () => TranslatorConfig;
  getDelta: () => CompiledSiteDelta;
  getHostRawDelta: () => string;
  getLocalLocaleTable: () => SiteLocaleTable | null;
  getMetrics: () => PtrMetrics;
  getSiteLocaleTable: () => SiteLocaleTable | null;
  getTargetLang: () => string;
  hostname: string;
  isTranslated: () => boolean;
  onExitStudio: () => void;
  onOpenSettings: () => void;
  onSaveHostDelta: (rawDelta: string) => void;
  onSiteDictUpdated?: () => void;
  onSyncLocalTable: (patch: SiteLocaleTable) => void;
  onToggleTranslate: () => void;
  t?: (key: string) => string;
}

export interface StudioWorkspaceController {
  getDiagnostics: () => string;
  getRawNodesJson: () => string;
  isActive: () => boolean;
  rescan: () => void;
  stop: () => void;
  syncFromConfig: () => void;
}

function downloadJsonFile(
  doc: Document,
  filename: string,
  content: string
): void {
  const link = doc.createElement("a");
  let objectUrl: string | null = null;
  if (
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function" &&
    typeof Blob !== "undefined"
  ) {
    objectUrl = URL.createObjectURL(
      new Blob([content], { type: "application/json" })
    );
    link.href = objectUrl;
  } else {
    link.href = `data:application/json;charset=utf-8,${encodeURIComponent(content)}`;
  }
  link.download = filename;
  (doc.body ?? doc.documentElement).append(link);
  link.click();
  link.remove();
  if (objectUrl && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(objectUrl);
  }
}

function isMutationInsideUi(mutation: MutationRecord): boolean {
  const { target } = mutation;
  const el = target.nodeType === 1 ? (target as Element) : target.parentElement;
  return Boolean(el?.closest("#ptr-studio-shell, [data-us-ui]"));
}

/** Creates the Industrial Studio Workspace controller managing stage, overlay, docks, and lifecycle. */
export function createStudioWorkspaceController(
  options: StudioWorkspaceControllerOptions
): StudioWorkspaceController {
  const t = (key: PtrMessageKey): string =>
    options.t?.(key) ?? MESSAGES_EN[key];

  let view: StudioWorkspaceView | null = null;
  let stage: StudioStageHandle | null = null;
  let liveCandidates: LiveCaptureCandidate[] = [];
  let manualElements = new Set<Element>();
  let lastInspectScan: InspectScanResult | null = null;
  let lastVolunteerScan: VolunteerScanResult | null = null;
  let filterTab: StudioNodeFilterTab = "all";
  let searchQuery = "";
  let selectedIndex: number | null = null;
  let hoveredIndex: number | null = null;
  let rightTab: StudioRightTab = "node";
  let bottomTab: StudioBottomTab = "diag";
  let bottomCollapsed = false;
  let zoom: StudioZoomPreset = "fit";
  let boxMode: StudioBoxMode = "all";
  let selectMode = true;
  let dictIndex = 0;
  let draftPatch: SiteLocaleTable | null = null;
  let conflicts: VolunteerConflict[] = [];
  let recordState: StudioRecordState = createStudioRecordState(false);

  let clickListener: ((e: Event) => void) | null = null;
  let moveListener: ((e: Event) => void) | null = null;
  let resizeListener: (() => void) | null = null;
  let scrollListener: (() => void) | null = null;
  let mutationObserver: MutationObserver | null = null;
  let unsubBreakpoint: (() => void) | null = null;

  const isStudioEnabled = (): boolean =>
    options.getConfig().uiTier === "studio";

  const getFilteredCandidates = (): LiveCaptureCandidate[] =>
    filterStudioCandidates(liveCandidates, {
      manualElements,
      query: searchQuery,
      tab: filterTab,
    });

  const renderOverlayNow = (): void => {
    if (!(view && stage)) {
      return;
    }
    const boxes = projectCandidateBoxes(liveCandidates, stage.getGeometry(), {
      boxMode,
      hoveredIndex,
      selectedIndex,
    });
    view.renderOverlay(boxes);
  };

  const renderNodesAndSelection = (): void => {
    if (!view) {
      return;
    }
    const filtered = getFilteredCandidates();
    const capturedCount = liveCandidates.filter(
      (entry) => entry.candidate.included
    ).length;

    view.renderNodes({
      capturedCount,
      filtered,
      filterTab,
      manualElements,
      selectedIndex,
      totalCount: liveCandidates.length,
    });

    const selectedEntry =
      selectedIndex === null ? null : (liveCandidates[selectedIndex] ?? null);
    const suggested = selectedEntry
      ? suggestSelectorForElement(selectedEntry.element)
      : "";
    view.renderSelectedNode(selectedEntry, suggested);
  };

  const renderDictNow = (): void => {
    if (!view) {
      return;
    }
    const entries = lastVolunteerScan?.entries ?? [];
    if (dictIndex >= entries.length) {
      dictIndex = Math.max(0, entries.length - 1);
    }
    const entry = entries[dictIndex] ?? null;
    const effectiveLocal =
      mergeLocaleTables(
        options.getLocalLocaleTable() ?? undefined,
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
    view.renderDictEntry({
      entry,
      index: dictIndex,
      initialValue,
      scan: lastVolunteerScan,
      targetLang: options.getTargetLang(),
    });
  };

  const renderBreakpointNow = (): void => {
    if (!view) {
      return;
    }
    const gate = options.breakpointGate;
    view.renderBreakpoint(
      gate?.isPaused() ?? false,
      gate?.isWaiting() ?? false
    );
  };

  const logActivity = (
    kind: "scan" | "mutation" | "rule" | "dict" | "breakpoint",
    summary: string
  ): void => {
    if (!recordState.recording) {
      return;
    }
    recordState = appendStudioActivity(recordState, kind, summary);
    view?.renderActivity(recordState.entries, recordState.recording);
  };

  const rescan = (): void => {
    const cfg = options.getConfig();
    const adapter = options.getAdapter();
    const delta = options.getDelta();
    const metrics = options.getMetrics();
    const siteTable = options.getSiteLocaleTable();

    liveCandidates = collectLiveCaptureCandidates(options.doc, {
      adapter,
      delta,
      host: options.hostname,
    });
    lastInspectScan = scanInspectSegments(options.doc, delta, cfg, metrics, {
      adapter,
      siteTable,
    });
    lastVolunteerScan = scanVolunteerEntries(options.doc, delta, siteTable, {
      adapter,
    });
    manualElements = new Set(
      lastVolunteerScan.entries
        .filter((entry) => entry.hit)
        .map((entry) => entry.seg.container)
    );

    if (selectedIndex !== null && selectedIndex >= liveCandidates.length) {
      selectedIndex = null;
    }

    if (view) {
      view.renderToolbar({
        adapterId: adapter.id,
        boxMode,
        selectMode,
        themeMode: cfg.themeMode,
        translated: options.isTranslated(),
        zoom,
      });
      view.setDeltaText(options.getHostRawDelta());
      view.renderDiagnostics(lastInspectScan);
      renderNodesAndSelection();
      renderDictNow();
      renderOverlayNow();
      renderBreakpointNow();
    }

    logActivity(
      "scan",
      `${liveCandidates.length} nodes, ${lastInspectScan.counts.total} segments`
    );
  };

  const selectCandidateByIndex = (index: number): void => {
    selectedIndex = index;
    const entry = liveCandidates[index];
    if (entry && typeof entry.element.scrollIntoView === "function") {
      entry.element.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    rightTab = "node";
    view?.renderRightTab(rightTab);
    renderNodesAndSelection();
    renderOverlayNow();
  };

  const unmount = (): void => {
    if (clickListener) {
      options.doc.removeEventListener("click", clickListener, true);
      clickListener = null;
    }
    if (moveListener) {
      options.doc.removeEventListener("pointermove", moveListener, true);
      moveListener = null;
    }
    if (scrollListener) {
      options.doc.removeEventListener("scroll", scrollListener, true);
      scrollListener = null;
    }
    if (resizeListener) {
      options.doc.defaultView?.removeEventListener("resize", resizeListener);
      resizeListener = null;
    }
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
    if (unsubBreakpoint) {
      unsubBreakpoint();
      unsubBreakpoint = null;
    }
    options.breakpointGate?.releaseAll();
    stage?.unmount();
    stage = null;
    view?.destroy();
    view = null;
  };

  const mount = (): void => {
    if (!stage) {
      stage = mountStudioStage(options.doc, { bottomCollapsed, zoom });
    }
    if (!view) {
      view = mountStudioWorkspaceView(
        options.doc,
        options.hostname,
        {
          onToggleTranslate: () => {
            options.onToggleTranslate();
            const cfg = options.getConfig();
            view?.renderToolbar({
              adapterId: options.getAdapter().id,
              boxMode,
              selectMode,
              themeMode: cfg.themeMode,
              translated: options.isTranslated(),
              zoom,
            });
          },
          onRescan: rescan,
          onToggleSelectMode: () => {
            selectMode = !selectMode;
            const cfg = options.getConfig();
            view?.renderToolbar({
              adapterId: options.getAdapter().id,
              boxMode,
              selectMode,
              themeMode: cfg.themeMode,
              translated: options.isTranslated(),
              zoom,
            });
          },
          onBoxModeChange: (nextMode) => {
            boxMode = nextMode;
            renderOverlayNow();
          },
          onZoomChange: (nextZoom) => {
            zoom = nextZoom;
            stage?.update({ bottomCollapsed, zoom });
            renderOverlayNow();
          },
          onExportNodes: () => {
            downloadJsonFile(
              options.doc,
              `${options.hostname}-nodes.json`,
              getRawNodesJson()
            );
            view?.setStatusMessage(
              formatPtrMsg(t("studioDownloadedNodes"), {
                host: options.hostname,
              })
            );
          },
          onCopyNodes: () => {
            void navigator.clipboard?.writeText(getRawNodesJson());
            view?.setStatusMessage(t("studioCopiedNodes"));
          },
          onCopyDiag: () => {
            void navigator.clipboard?.writeText(getDiagnostics());
            view?.setStatusMessage(t("volCopied"));
          },
          onOpenSettings: options.onOpenSettings,
          onExit: options.onExitStudio,
          onSearchChange: (query) => {
            searchQuery = query;
            renderNodesAndSelection();
          },
          onFilterTabChange: (tab) => {
            filterTab = tab;
            renderNodesAndSelection();
          },
          onSelectNode: selectCandidateByIndex,
          onSelectRightTab: (tab) => {
            rightTab = tab;
            view?.renderRightTab(tab);
          },
          onSelectBottomTab: (tab) => {
            bottomTab = tab;
            if (bottomCollapsed) {
              bottomCollapsed = false;
              stage?.update({ bottomCollapsed, zoom });
              renderOverlayNow();
            }
            view?.renderBottomState(bottomCollapsed, bottomTab);
          },
          onToggleBottomCollapse: () => {
            bottomCollapsed = !bottomCollapsed;
            stage?.update({ bottomCollapsed, zoom });
            view?.renderBottomState(bottomCollapsed, bottomTab);
            renderOverlayNow();
          },
          onRuleAction: (kind, selector, modifier: SiteModifier) => {
            const trimmed = selector.trim();
            if (!(view && trimmed)) {
              return;
            }
            let ruleLine = `+ ${trimmed}`;
            if (kind === "remove") {
              ruleLine = `- ${trimmed}`;
            } else if (kind === "mod") {
              ruleLine = `* ${trimmed} : ${modifier}`;
            }
            const nextDelta = appendSiteDeltaRule(
              view.getDeltaText(),
              ruleLine
            );
            view.setDeltaText(nextDelta);
            logActivity("rule", ruleLine);
          },
          onApplyDelta: (rawDelta) => {
            options.onSaveHostDelta(rawDelta);
            rescan();
            view?.setStatusMessage(t("studioRuleApplied"));
            logActivity("rule", t("studioRuleApplied"));
          },
          onPrevSegment: () => {
            const total = lastVolunteerScan?.entries.length ?? 0;
            if (total > 0) {
              dictIndex = (dictIndex - 1 + total) % total;
              renderDictNow();
            }
          },
          onNextSegment: () => {
            const total = lastVolunteerScan?.entries.length ?? 0;
            if (total > 0) {
              dictIndex = (dictIndex + 1) % total;
              renderDictNow();
            }
          },
          onSuggestScope: () => {
            const entry = lastVolunteerScan?.entries[dictIndex];
            return entry ? suggestEntryScope(entry) : "";
          },
          onSaveDraft: (translation, scope) => {
            const entry = lastVolunteerScan?.entries[dictIndex];
            const trimmed = translation.trim();
            if (!(entry && trimmed)) {
              return;
            }
            const patch = buildDraftPatch(entry, trimmed, scope);
            draftPatch =
              mergeLocaleTables(draftPatch ?? undefined, patch) ?? null;
            options.onSyncLocalTable(patch);
            options.onSiteDictUpdated?.();
            const trimmedScope = scope.trim();
            view?.setStatusMessage(
              trimmedScope
                ? formatPtrMsg(t("volSavedScoped"), {
                    scope: trimmedScope,
                    preview: trimmed,
                  })
                : formatPtrMsg(t("volSaved"), { preview: trimmed })
            );
            logActivity("dict", trimmed);
            rescan();
          },
          onCopyDictJson: () => {
            const json = buildVolunteerExportJson(
              options.hostname,
              options.getTargetLang(),
              options.getLocalLocaleTable() ?? options.getSiteLocaleTable(),
              draftPatch
            );
            void navigator.clipboard?.writeText(json);
            view?.setStatusMessage(t("volCopied"));
          },
          onDownloadDictJson: () => {
            const json = buildVolunteerExportJson(
              options.hostname,
              options.getTargetLang(),
              options.getLocalLocaleTable() ?? options.getSiteLocaleTable(),
              draftPatch
            );
            downloadJsonFile(options.doc, `${options.hostname}.json`, json);
          },
          onExportAi: () => {
            const bundle = buildAiTranslationExport(
              options.doc,
              options.getDelta(),
              {
                getAdapter: options.getAdapter,
                hostname: options.hostname,
                siteTable: options.getSiteLocaleTable(),
                targetLang: options.getTargetLang(),
              }
            );
            void navigator.clipboard?.writeText(bundle.prompt);
            view?.setStatusMessage(
              formatPtrMsg(t("hudExportedAi"), { count: bundle.count })
            );
          },
          onApplyImport: (rawJson) => {
            try {
              const parsed = parseAiTranslationImport(
                rawJson,
                options.getTargetLang()
              );
              const result = diffImportConflicts(
                parsed,
                options.getLocalLocaleTable() ?? options.getSiteLocaleTable()
              );
              if (Object.keys(result.patch).length > 0) {
                options.onSyncLocalTable(result.patch);
                options.onSiteDictUpdated?.();
              }
              ({ conflicts } = result);
              view?.renderConflicts(conflicts);
              view?.setStatusMessage(t("volDraftReady"));
              rescan();
            } catch {
              view?.setStatusMessage(t("volImportError"));
            }
          },
          onResolveConflict: (id, choice) => {
            const target = conflicts.find((c) => c.id === id);
            if (!target) {
              return;
            }
            const patch = buildConflictResolutionPatch(target, choice);
            if (patch) {
              options.onSyncLocalTable(patch);
              options.onSiteDictUpdated?.();
            }
            conflicts = conflicts.filter((c) => c.id !== id);
            view?.renderConflicts(conflicts);
            view?.setStatusMessage(t("volConflictResolved"));
            rescan();
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
              options.onSyncLocalTable(mergedPatch);
              options.onSiteDictUpdated?.();
            }
            conflicts = [];
            view?.renderConflicts(conflicts);
            view?.setStatusMessage(t("volConflictResolved"));
            rescan();
          },
          onToggleRecord: () => {
            recordState = {
              ...recordState,
              recording: !recordState.recording,
            };
            view?.renderActivity(recordState.entries, recordState.recording);
          },
          onClearActivity: () => {
            recordState = clearStudioActivity(recordState);
            view?.renderActivity(recordState.entries, recordState.recording);
          },
          onTogglePauseApi: () => {
            const gate = options.breakpointGate;
            if (!gate) {
              return;
            }
            gate.setPaused(!gate.isPaused());
            logActivity("breakpoint", gate.isPaused() ? "paused" : "resumed");
          },
          onResumeApi: () => {
            const gate = options.breakpointGate;
            if (!gate) {
              return;
            }
            gate.setPaused(false);
            logActivity("breakpoint", "resumed");
          },
        },
        t
      );

      view.renderRightTab(rightTab);
      view.renderBottomState(bottomCollapsed, bottomTab);
      view.renderActivity(recordState.entries, recordState.recording);

      clickListener = (e: Event): void => {
        if (!selectMode || isUsUiEvent(e, view?.host ?? null)) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const found = findCandidateIndexForElement(
          liveCandidates,
          e.target as Element | null
        );
        if (found !== null) {
          selectCandidateByIndex(found);
        }
      };
      options.doc.addEventListener("click", clickListener, true);

      moveListener = (e: Event): void => {
        if (isUsUiEvent(e, view?.host ?? null)) {
          if (hoveredIndex !== null) {
            hoveredIndex = null;
            renderOverlayNow();
          }
          return;
        }
        const found = findCandidateIndexForElement(
          liveCandidates,
          e.target as Element | null
        );
        if (found !== hoveredIndex) {
          hoveredIndex = found;
          renderOverlayNow();
        }
      };
      options.doc.addEventListener("pointermove", moveListener, true);

      scrollListener = (): void => {
        renderOverlayNow();
      };
      options.doc.addEventListener("scroll", scrollListener, true);

      resizeListener = (): void => {
        stage?.update({ bottomCollapsed, zoom });
        renderOverlayNow();
      };
      options.doc.defaultView?.addEventListener("resize", resizeListener);

      const observeTarget = options.doc.body ?? options.doc.documentElement;
      if (typeof MutationObserver !== "undefined" && observeTarget) {
        mutationObserver = new MutationObserver((mutations) => {
          if (mutations.every(isMutationInsideUi)) {
            return;
          }
          logActivity("mutation", `${mutations.length} mutation(s)`);
        });
        mutationObserver.observe(observeTarget, {
          characterData: true,
          childList: true,
          subtree: true,
        });
      }

      if (options.breakpointGate) {
        unsubBreakpoint =
          options.breakpointGate.onStateChange(renderBreakpointNow);
      }
    }

    rescan();
  };

  const syncFromConfig = (): void => {
    if (isStudioEnabled()) {
      mount();
    } else {
      unmount();
    }
  };

  const getDiagnostics = (): string => {
    const adapter = options.getAdapter();
    const scan =
      lastInspectScan ??
      scanInspectSegments(
        options.doc,
        options.getDelta(),
        options.getConfig(),
        options.getMetrics(),
        {
          adapter,
          siteTable: options.getSiteLocaleTable(),
        }
      );
    return buildInspectDiagnostics(
      adapter.id,
      scan,
      options.doc.location?.href ?? ""
    );
  };

  const getRawNodesJson = (): string => {
    const adapter = options.getAdapter();
    const entries =
      liveCandidates.length > 0
        ? liveCandidates
        : collectLiveCaptureCandidates(options.doc, {
            adapter,
            delta: options.getDelta(),
            host: options.hostname,
          });
    return buildRawNodesExportJson({
      adapterId: adapter.id,
      candidates: entries.map((entry) => entry.candidate),
      host: options.hostname,
      url: options.doc.location?.href ?? "",
    });
  };

  return {
    getDiagnostics,
    getRawNodesJson,
    isActive: () => view !== null,
    rescan,
    stop: unmount,
    syncFromConfig,
  };
}
