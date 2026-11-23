export interface SpaLifecycleOptions {
  onBeforeLeave: () => void;
  onSettled: () => void;
  settleMs?: number;
  win: Window;
}

export interface SpaLifecycleHandle {
  stop: () => void;
}

export function watchSpaNavigation(
  options: SpaLifecycleOptions
): SpaLifecycleHandle {
  const { win, onBeforeLeave, onSettled, settleMs = 150 } = options;
  let lastUrl = win.location?.href ?? "";
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let leavingDispatched = false;
  let stopped = false;

  function triggerLeaveOnce(): void {
    if (stopped || leavingDispatched) {
      return;
    }
    leavingDispatched = true;
    onBeforeLeave();
  }

  function scheduleSettled(): void {
    if (stopped) {
      return;
    }
    leavingDispatched = false;
    if (settleTimer !== null) {
      clearTimeout(settleTimer);
    }
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (!stopped) {
        onSettled();
      }
    }, settleMs);
  }

  function commitUrl(nextUrl: string): void {
    if (stopped || !nextUrl || nextUrl === lastUrl) {
      return;
    }
    triggerLeaveOnce();
    lastUrl = nextUrl;
    scheduleSettled();
  }

  const origPushState = win.history.pushState.bind(win.history);
  const origReplaceState = win.history.replaceState.bind(win.history);

  function resolveUrlArg(urlArg?: string | URL | null): string {
    if (!urlArg) {
      return win.location?.href ?? lastUrl;
    }
    try {
      return new URL(String(urlArg), win.location?.href ?? "https://localhost/")
        .href;
    } catch {
      return String(urlArg);
    }
  }

  function trackPush(
    data: unknown,
    unused: string,
    url?: string | URL | null
  ): void {
    const targetUrl = resolveUrlArg(url);
    if (targetUrl !== lastUrl) {
      triggerLeaveOnce();
    }
    origPushState(data, unused, url);
    commitUrl(win.location?.href ?? targetUrl);
  }

  function trackReplace(
    data: unknown,
    unused: string,
    url?: string | URL | null
  ): void {
    const targetUrl = resolveUrlArg(url);
    if (targetUrl !== lastUrl) {
      triggerLeaveOnce();
    }
    origReplaceState(data, unused, url);
    commitUrl(win.location?.href ?? targetUrl);
  }

  // Some environments (privacy modes, embedded WebViews) ship history methods
  // that cannot be overwritten; navigation tracking is simply skipped there.
  try {
    win.history.pushState = (
      data: unknown,
      unused: string,
      url?: string | URL | null
    ): void => {
      trackPush(data, unused, url);
    };
  } catch {
    // non-writable history.pushState
  }

  try {
    win.history.replaceState = (
      data: unknown,
      unused: string,
      url?: string | URL | null
    ): void => {
      trackReplace(data, unused, url);
    };
  } catch {
    // non-writable history.replaceState
  }

  const onPopOrHash = () => {
    commitUrl(win.location?.href ?? "");
  };

  const onTurboBefore = () => {
    triggerLeaveOnce();
  };

  const onTurboSettled = () => {
    const cur = win.location?.href ?? "";
    if (cur) {
      lastUrl = cur;
    }
    scheduleSettled();
  };

  win.addEventListener("popstate", onPopOrHash);
  win.addEventListener("hashchange", onPopOrHash);
  win.addEventListener("turbo:before-cache", onTurboBefore);
  win.addEventListener("turbo:before-render", onTurboBefore);
  win.addEventListener("turbo:load", onTurboSettled);
  win.addEventListener("turbo:render", onTurboSettled);
  win.addEventListener("turbo:frame-load", onTurboSettled);

  const doc = win.document as Document | undefined;
  doc?.addEventListener("turbo:before-cache", onTurboBefore);
  doc?.addEventListener("turbo:before-render", onTurboBefore);
  doc?.addEventListener("turbo:load", onTurboSettled);
  doc?.addEventListener("turbo:render", onTurboSettled);
  doc?.addEventListener("turbo:frame-load", onTurboSettled);

  let lastBody = doc?.body ?? null;
  const docElObserver =
    typeof MutationObserver !== "undefined" && doc?.documentElement
      ? new MutationObserver(() => {
          if (stopped) {
            return;
          }
          const curBody = doc.body ?? null;
          if (curBody && curBody !== lastBody) {
            lastBody = curBody;
            const cur = win.location?.href ?? "";
            if (cur) {
              lastUrl = cur;
            }
            triggerLeaveOnce();
            scheduleSettled();
          }
        })
      : null;
  if (docElObserver && doc?.documentElement) {
    docElObserver.observe(doc.documentElement, { childList: true });
  }

  const nav = (
    win as unknown as {
      navigation?: {
        addEventListener: (
          type: string,
          cb: (e: {
            destination?: { url?: string };
            navigationType?: string;
          }) => void
        ) => void;
        removeEventListener: (
          type: string,
          cb: (e: {
            destination?: { url?: string };
            navigationType?: string;
          }) => void
        ) => void;
      };
    }
  ).navigation;

  const onNavigate = (e: {
    destination?: { url?: string };
    navigationType?: string;
  }) => {
    if (e.navigationType === "reload") {
      return;
    }
    const dest = e.destination?.url;
    if (dest && dest !== lastUrl) {
      triggerLeaveOnce();
    }
  };
  const onNavigateSuccess = () => {
    commitUrl(win.location?.href ?? "");
  };

  nav?.addEventListener("navigate", onNavigate);
  nav?.addEventListener("navigatesuccess", onNavigateSuccess);

  return {
    stop() {
      stopped = true;
      if (settleTimer !== null) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      docElObserver?.disconnect();
      try {
        win.history.pushState = origPushState;
      } catch {
        // non-writable history.pushState
      }
      try {
        win.history.replaceState = origReplaceState;
      } catch {
        // non-writable history.replaceState
      }
      win.removeEventListener("popstate", onPopOrHash);
      win.removeEventListener("hashchange", onPopOrHash);
      win.removeEventListener("turbo:before-cache", onTurboBefore);
      win.removeEventListener("turbo:before-render", onTurboBefore);
      win.removeEventListener("turbo:load", onTurboSettled);
      win.removeEventListener("turbo:render", onTurboSettled);
      win.removeEventListener("turbo:frame-load", onTurboSettled);
      doc?.removeEventListener("turbo:before-cache", onTurboBefore);
      doc?.removeEventListener("turbo:before-render", onTurboBefore);
      doc?.removeEventListener("turbo:load", onTurboSettled);
      doc?.removeEventListener("turbo:render", onTurboSettled);
      doc?.removeEventListener("turbo:frame-load", onTurboSettled);
      nav?.removeEventListener("navigate", onNavigate);
      nav?.removeEventListener("navigatesuccess", onNavigateSuccess);
    },
  };
}
