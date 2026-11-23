import type { StyleReader } from "../../../capture/display-role";
import type { SiteLocaleTable } from "../../../dict/template";
import type { TabStorage } from "../../../platform/activation";
import { createTabActivationManager } from "../../../platform/activation";
import type { TranslatorConfig } from "../../../platform/config";
import type { PtrMessageKey } from "../../../platform/i18n";
import type { PtrMetrics } from "../../../platform/metrics";
import { createPtrMetrics } from "../../../platform/metrics";
import type { SiteStructureAdapter } from "../../../structure/adapter";
import type { CompiledSiteDelta } from "../../../structure/site-rules";
import { buildAiTranslationExport } from "../../export-ai";
import type { InspectScanResult } from "./logic";
import { buildInspectDiagnostics, scanInspectSegments } from "./logic";
import type { InspectView } from "./view";
import { mountInspectView } from "./view";

export interface InspectControllerOptions {
  doc: Document;
  getAdapter?: () => SiteStructureAdapter;
  getConfig: () => TranslatorConfig;
  getDelta: () => CompiledSiteDelta;
  getMetrics?: () => PtrMetrics;
  getSiteLocaleTable?: () => SiteLocaleTable | null;
  getStyle?: StyleReader;
  onToggle?: (active: boolean) => void;
  storage?: TabStorage | null;
  t?: (key: PtrMessageKey) => string;
}

export interface InspectController {
  getDiagnostics: () => string;
  isActive: () => boolean;
  rescan: () => void;
  stop: () => void;
  syncFromConfig: () => void;
  toggle: () => void;
}

export function createInspectController(
  options: InspectControllerOptions
): InspectController {
  const activation = createTabActivationManager({
    getConfig: options.getConfig,
    storage: options.storage,
  });
  const metrics = options.getMetrics?.() ?? createPtrMetrics();
  let view: InspectView | null = null;
  let lastScan: InspectScanResult | null = null;
  let hoverListener: ((e: Event) => void) | null = null;

  const isInspectEnabled = (): boolean => {
    const cfg = options.getConfig();
    return cfg.uiTier === "studio" && activation.isActive("inspect");
  };

  const rescan = (): void => {
    const cfg = options.getConfig();
    lastScan = scanInspectSegments(
      options.doc,
      options.getDelta(),
      cfg,
      metrics,
      {
        getAdapter: options.getAdapter,
        getStyle: options.getStyle,
        siteTable: options.getSiteLocaleTable?.(),
      }
    );
    view?.renderScan(lastScan, cfg.themeMode);
  };

  const unmount = (): void => {
    if (hoverListener) {
      options.doc.removeEventListener("pointermove", hoverListener, true);
      hoverListener = null;
    }
    view?.destroy();
    view = null;
  };

  const mount = (): void => {
    if (!view) {
      view = mountInspectView(
        options.doc,
        {
          onCopyDiag: () => {
            const diag = getDiagnostics();
            void navigator.clipboard?.writeText(diag);
          },
          onExportAi: () => {
            const cfg = options.getConfig();
            const bundle = buildAiTranslationExport(
              options.doc,
              options.getDelta(),
              {
                getAdapter: options.getAdapter,
                getStyle: options.getStyle,
                hostname: options.doc.location?.hostname ?? "",
                siteTable: options.getSiteLocaleTable?.(),
                targetLang: cfg.targetLang,
              }
            );
            void navigator.clipboard?.writeText(bundle.prompt);
          },
        },
        options.t
      );
      hoverListener = (e: Event): void => {
        if (!lastScan) {
          return;
        }
        let el = e.target as Element | null;
        while (el) {
          const meta = lastScan.hoverMap.get(el);
          if (meta) {
            view?.renderHover(meta);
            return;
          }
          el = el.parentElement;
        }
      };
      options.doc.addEventListener("pointermove", hoverListener, true);
    }
    rescan();
  };

  const syncFromConfig = (): void => {
    if (isInspectEnabled()) {
      mount();
    } else {
      unmount();
    }
  };

  const getDiagnostics = (): string => {
    const scan =
      lastScan ??
      scanInspectSegments(
        options.doc,
        options.getDelta(),
        options.getConfig(),
        metrics,
        {
          getStyle: options.getStyle,
          siteTable: options.getSiteLocaleTable?.(),
        }
      );
    return buildInspectDiagnostics(
      scan.adapterId,
      scan,
      options.doc.location?.href ?? ""
    );
  };

  return {
    syncFromConfig,
    rescan,
    getDiagnostics,
    isActive: () => isInspectEnabled(),
    toggle(): void {
      const next = !activation.isActive("inspect");
      activation.setActive("inspect", next);
      syncFromConfig();
      options.onToggle?.(isInspectEnabled());
    },
    stop(): void {
      unmount();
    },
  };
}
