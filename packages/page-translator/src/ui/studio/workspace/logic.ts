import type {
  CaptureCandidate,
  LiveCaptureCandidate,
} from "../../../capture/export";

export type StudioNodeFilterTab = "all" | "captured" | "excluded" | "manual";

export interface StudioActivityEntry {
  id: number;
  kind: "scan" | "mutation" | "rule" | "dict" | "breakpoint";
  summary: string;
  timestamp: string;
}

export interface StudioRecordState {
  entries: StudioActivityEntry[];
  nextId: number;
  recording: boolean;
}

export interface StudioBreakpointGate {
  isPaused: () => boolean;
  isWaiting: () => boolean;
  onStateChange: (cb: () => void) => () => void;
  releaseAll: () => void;
  setPaused: (paused: boolean) => void;
  step: () => void;
  waitIfPaused: () => Promise<void>;
}

const MAX_ACTIVITY_ENTRIES = 200;

function normalizeRegion(region: string | string[] | null): string {
  if (Array.isArray(region)) {
    return region.join(",");
  }
  return region ?? "";
}

function getLogicalParent(el: Element): Element | null {
  if (el.parentElement) {
    return el.parentElement;
  }
  const parent = el.parentNode;
  if (parent && "host" in parent) {
    return (parent as ShadowRoot).host;
  }
  return null;
}

/** Filters live capture candidates by workspace tab and case-insensitive substring query. */
export function filterStudioCandidates(
  entries: readonly LiveCaptureCandidate[],
  options: {
    manualElements?: ReadonlySet<Element>;
    query: string;
    tab: StudioNodeFilterTab;
  }
): LiveCaptureCandidate[] {
  const query = options.query.trim().toLowerCase();

  return entries.filter((entry) => {
    const { candidate, element } = entry;
    if (options.tab === "captured" && !candidate.included) {
      return false;
    }
    if (options.tab === "excluded" && candidate.included) {
      return false;
    }
    if (options.tab === "manual" && !options.manualElements?.has(element)) {
      return false;
    }

    if (!query) {
      return true;
    }

    const haystack = [
      candidate.textPreview,
      candidate.domPath,
      normalizeRegion(candidate.region),
      candidate.excludeReason ?? "",
    ]
      .join("\n")
      .toLowerCase();

    return haystack.includes(query);
  });
}

/** Walks up ancestors from target to find the nearest matching LiveCaptureCandidate index. */
export function findCandidateIndexForElement(
  entries: readonly LiveCaptureCandidate[],
  target: Element | null
): number | null {
  if (!target) {
    return null;
  }

  const byElement = new Map<Element, number>();
  for (const entry of entries) {
    byElement.set(entry.element, entry.index);
  }

  let current: Element | null = target;
  while (current) {
    const found = byElement.get(current);
    if (found !== undefined) {
      return found;
    }
    current = getLogicalParent(current);
  }

  return null;
}

/** Serializes raw CaptureCandidate records with host, url, adapterId, and count metadata. */
export function buildRawNodesExportJson(params: {
  adapterId: string;
  candidates: readonly CaptureCandidate[];
  host: string;
  url: string;
}): string {
  return JSON.stringify(
    {
      adapterId: params.adapterId,
      candidates: params.candidates,
      count: params.candidates.length,
      host: params.host,
      url: params.url,
    },
    null,
    2
  );
}

/** Creates an initial Studio activity recording state. */
export function createStudioRecordState(recording = false): StudioRecordState {
  return {
    entries: [],
    nextId: 1,
    recording,
  };
}

/** Appends a timestamped activity entry when recording is active. */
export function appendStudioActivity(
  state: StudioRecordState,
  kind: StudioActivityEntry["kind"],
  summary: string,
  timestamp = new Date().toISOString()
): StudioRecordState {
  if (!state.recording) {
    return state;
  }
  const entry: StudioActivityEntry = {
    id: state.nextId,
    kind,
    summary,
    timestamp,
  };
  const nextEntries = [...state.entries, entry].slice(-MAX_ACTIVITY_ENTRIES);
  return {
    entries: nextEntries,
    nextId: state.nextId + 1,
    recording: state.recording,
  };
}

/** Clears recorded activity entries while preserving recording toggle and ID sequence. */
export function clearStudioActivity(
  state: StudioRecordState
): StudioRecordState {
  return {
    ...state,
    entries: [],
  };
}

/** Creates a pause/step breakpoint gate for inspecting translation pipeline batches. */
export function createStudioBreakpointGate(): StudioBreakpointGate {
  let paused = false;
  const waiters: Array<() => void> = [];
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const drainAll = (): number => {
    const pending = waiters.splice(0, waiters.length);
    for (const resolve of pending) {
      resolve();
    }
    return pending.length;
  };

  return {
    isPaused: () => paused,
    isWaiting: () => waiters.length > 0,
    onStateChange: (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    releaseAll: () => {
      if (drainAll() > 0) {
        notify();
      }
    },
    setPaused: (nextPaused: boolean) => {
      if (paused === nextPaused) {
        return;
      }
      paused = nextPaused;
      if (!nextPaused) {
        drainAll();
      }
      notify();
    },
    step: () => {
      const next = waiters.shift();
      if (next) {
        next();
        notify();
      }
    },
    waitIfPaused: () => {
      if (!paused) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
        notify();
      });
    },
  };
}
