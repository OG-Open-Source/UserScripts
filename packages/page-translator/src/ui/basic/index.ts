import type { TranslatorConfig, UiTier } from "../../platform/config";
import type { PtrMessageKey } from "../../platform/i18n";
import { computeBasicUiState, diffStudioTier, toggleUiTier } from "./logic";
import type { BasicView } from "./view";
import { mountBasicView } from "./view";

export interface BasicControllerOptions {
  doc: Document;
  getConfig: () => TranslatorConfig;
  isTranslated?: () => boolean;
  onOpenSettings?: () => void;
  onStudioMount?: () => void;
  onStudioUnmount?: () => void;
  onToggleTranslate?: () => void;
  setUiTier: (tier: UiTier) => void;
  t?: (key: PtrMessageKey) => string;
}

export interface BasicController {
  setTranslated: (translated: boolean) => void;
  stop: () => void;
  syncFromConfig: () => void;
}

export function createBasicController(
  options: BasicControllerOptions
): BasicController {
  let view: BasicView | null = null;
  let lastTier: UiTier | null = null;
  let translated = options.isTranslated?.() ?? false;

  const ensureView = (): BasicView => {
    if (view) {
      return view;
    }
    view = mountBasicView(
      options.doc,
      {
        onToggleTranslate: () => {
          options.onToggleTranslate?.();
        },
        onOpenSettings: () => {
          options.onOpenSettings?.();
        },
        onToggleStudio: () => {
          const next = toggleUiTier(options.getConfig().uiTier);
          options.setUiTier(next);
          syncFromConfig();
        },
      },
      options.t
    );
    return view;
  };

  const syncFromConfig = (): void => {
    const cfg = options.getConfig();
    translated = options.isTranslated?.() ?? translated;
    const mounted = ensureView();
    mounted.render(computeBasicUiState(cfg, translated));

    const transition = diffStudioTier(lastTier, cfg.uiTier);
    lastTier = cfg.uiTier;
    if (transition === "mount") {
      options.onStudioMount?.();
    } else if (transition === "unmount") {
      options.onStudioUnmount?.();
    }
  };

  return {
    syncFromConfig,
    setTranslated(next: boolean): void {
      translated = next;
      syncFromConfig();
    },
    stop(): void {
      if (lastTier === "studio") {
        options.onStudioUnmount?.();
      }
      lastTier = null;
      view?.destroy();
      view = null;
    },
  };
}
