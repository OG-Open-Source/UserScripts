export interface StudioSessionCoordinatorOptions {
  getAutoTranslate: () => boolean;
  getTabActive: () => boolean;
  isStudioActive: () => boolean;
  isTranslated: () => boolean;
  onClearCacheAndRestart: () => void;
  onRescanStudio: () => void;
  onRestoreForStudio: () => void;
  onSpaNavigate: () => void;
  onStartTranslation: () => void;
  onStopTranslation: () => void;
}

export interface StudioSessionCoordinator {
  onBoot: () => void;
  onConfigUpdated: (shouldRetranslate: boolean) => void;
  onDeltaSaved: () => void;
  onDictUpdated: (skipStudioRescan?: boolean) => void;
  onSpaSettled: () => void;
  onStudioMount: () => void;
  onStudioUnmount: () => void;
  onToggleTranslate: () => void;
  readonly suspendedForStudio: boolean;
}

/** Coordinates page translation suspension and original-DOM presentation while Studio Mode is active. */
export function createStudioSessionCoordinator(
  options: StudioSessionCoordinatorOptions
): StudioSessionCoordinator {
  let suspendedForStudio = false;

  return {
    get suspendedForStudio() {
      return suspendedForStudio;
    },
    onBoot() {
      if (!(options.getAutoTranslate() || options.getTabActive())) {
        suspendedForStudio = false;
        return;
      }
      if (options.isStudioActive()) {
        suspendedForStudio = true;
        return;
      }
      suspendedForStudio = false;
      options.onStartTranslation();
    },
    onConfigUpdated(shouldRetranslate: boolean) {
      if (options.isStudioActive()) {
        if (shouldRetranslate) {
          options.onRescanStudio();
        }
        return;
      }
      if (shouldRetranslate && options.isTranslated()) {
        options.onClearCacheAndRestart();
      }
    },
    onDeltaSaved() {
      if (options.isStudioActive()) {
        options.onRescanStudio();
        return;
      }
      if (options.isTranslated()) {
        options.onClearCacheAndRestart();
      }
    },
    onDictUpdated(skipStudioRescan = false) {
      if (options.isStudioActive()) {
        if (!skipStudioRescan) {
          options.onRescanStudio();
        }
        return;
      }
      if (options.isTranslated()) {
        options.onClearCacheAndRestart();
      }
    },
    onSpaSettled() {
      if (options.isStudioActive()) {
        options.onRescanStudio();
        return;
      }
      if (options.isTranslated() || options.getAutoTranslate()) {
        options.onSpaNavigate();
      }
    },
    onStudioMount() {
      if (!options.isTranslated()) {
        return;
      }
      suspendedForStudio = true;
      options.onRestoreForStudio();
    },
    onStudioUnmount() {
      const shouldResume =
        !options.isTranslated() &&
        (suspendedForStudio || options.getAutoTranslate());
      suspendedForStudio = false;
      if (shouldResume) {
        options.onStartTranslation();
      }
    },
    onToggleTranslate() {
      suspendedForStudio = false;
      if (options.isTranslated()) {
        options.onStopTranslation();
      } else {
        options.onStartTranslation();
      }
    },
  };
}
