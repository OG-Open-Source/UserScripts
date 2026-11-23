import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { collectSegments } from "../../src/capture/segmenter";
import type { SiteStructureAdapter } from "../../src/structure/adapter";
import type {
  FingerprintData,
  FingerprintStorage,
} from "../../src/structure/fingerprints";
import { load } from "../../src/structure/fingerprints";
import { resolveAdapter } from "../../src/structure/registry";
import { parseSiteDelta } from "../../src/structure/site-rules";

const FIXTURE =
  "<main><div>Plain <span>nested <strong>inline</strong></span> tail</div><p>Second paragraph.</p></main>";

class MemoryStorage implements FingerprintStorage {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | null {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }
}

function setupFixture() {
  const win = new Window({ url: "https://unknown.example/" });
  win.document.body.innerHTML = FIXTURE;
  const doc = win.document as unknown as Document;
  const { body } = doc;
  if (!body) {
    throw new Error("Fixture body is required");
  }
  const getStyle = (el: Element) => ({
    display:
      (el as HTMLElement).style.display ||
      (["BODY", "MAIN", "DIV", "P"].includes(el.tagName) ? "block" : "inline"),
    fontFamily: (el as HTMLElement).style.fontFamily,
    visibility: (el as HTMLElement).style.visibility || "visible",
  });
  return { body, doc, getStyle };
}

function segmentSnapshot(segments: ReturnType<typeof collectSegments>) {
  return segments.map((segment) => ({
    container: segment.container.outerHTML,
    displayContents: segment.displayContents,
    modifiers: [...segment.modifiers].sort((a, b) => a.localeCompare(b)),
    nodes: segment.nodes.map((node) =>
      node.nodeType === 1 ? (node as Element).outerHTML : node.nodeValue
    ),
    sourceRule: segment.sourceRule,
  }));
}

function createAdapter(
  id: string,
  detect: SiteStructureAdapter["detect"] = () => false
): SiteStructureAdapter {
  return {
    id,
    detect,
    regions: (doc) => ({ content: doc.body ? [doc.body] : [] }),
    captureScope: (doc) => (doc.body ? [doc.body] : []),
    onSpaNavigate: (doc) => (doc.body ? [doc.body] : []),
    elementPolicy: () => "prose",
  };
}

function createGate() {
  let release: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release?.() };
}

test("unknown hosts use fallback and reproduce unadapted segment output", () => {
  const unadapted = setupFixture();
  const adapted = setupFixture();
  const delta = parseSiteDelta("");
  const adapter = resolveAdapter({
    host: "unknown.example",
    doc: adapted.doc,
  });

  expect(adapter.id).toBe("fallback");
  expect(adapter.captureScope(adapted.doc)).toEqual([adapted.body]);
  const baseSegments = collectSegments(unadapted.body, delta, {
    getStyle: unadapted.getStyle,
  });
  const adaptedSegments = collectSegments(adapted.body, delta, {
    adapter,
    getStyle: adapted.getStyle,
  });
  expect(segmentSnapshot(adaptedSegments)).toEqual(
    segmentSnapshot(baseSegments)
  );
});

test("registry returns the first matching adapter and otherwise falls back", () => {
  const { doc } = setupFixture();
  const first = createAdapter("first", () => false);
  const second = createAdapter("second", ({ host }) =>
    host.endsWith(".example")
  );
  const third = createAdapter("third", () => true);

  expect(
    resolveAdapter({ host: "unknown.example", doc }, [first, second, third]).id
  ).toBe("second");
  expect(resolveAdapter({ host: "other.test", doc }, [first]).id).toBe(
    "fallback"
  );
});

test("fingerprint loader serves bundled Discourse JSON when remote fetch fails", async () => {
  const fingerprint = await load("discourse", {
    fetchText: () => Promise.reject(new Error("offline")),
    storage: new MemoryStorage(),
  });

  expect(fingerprint.id).toBe("discourse");
  expect(fingerprint.version).toBe(1);
  expect(fingerprint.regions.content).toContain("#main-outlet");
  expect(fingerprint.spaRescanSelectors).toContain("#main-outlet");
  expect(fingerprint.policies[".badge-wrapper"]).toBe("badge");
});

test("fingerprint loader falls back safely when GM storage is unconfigured", async () => {
  const fingerprint = await load("github", {
    fetchText: () => Promise.reject(new Error("offline")),
  });

  expect(fingerprint.id).toBe("github");
  expect(fingerprint.regions.content).toContain("main");
  expect(fingerprint.captureSelectors).toContain("main .markdown-body");
});

test("fingerprint loader returns cached data while SWR stores and publishes fresh data", async () => {
  const storage = new MemoryStorage();
  const bundled = await load("discourse", {
    fetchText: () => Promise.reject(new Error("offline")),
    storage: new MemoryStorage(),
  });
  const cachedRemote: FingerprintData = { ...bundled, version: 2 };
  const freshRemote: FingerprintData = { ...bundled, version: 3 };
  const refreshGate = createGate();
  let fetchCount = 0;
  const options = {
    fetchText: async () => {
      fetchCount += 1;
      if (fetchCount > 1) {
        await refreshGate.promise;
        return JSON.stringify(freshRemote);
      }
      return JSON.stringify(cachedRemote);
    },
    storage,
  };

  expect((await load("discourse", options)).version).toBe(2);
  let publishUpdate: ((next: FingerprintData) => void) | undefined;
  const updated = new Promise<FingerprintData>((resolve) => {
    publishUpdate = resolve;
  });
  const cached = await load("discourse", {
    ...options,
    onUpdate: (next) => publishUpdate?.(next),
  });
  expect(cached.version).toBe(2);

  refreshGate.release();
  expect((await updated).version).toBe(3);
  const reloaded = await load("discourse", {
    fetchText: () => Promise.reject(new Error("offline")),
    storage,
  });
  expect(reloaded.version).toBe(3);
});

test("fingerprint SWR reports onUpdate failures through onUpdateError", async () => {
  const storage = new MemoryStorage();
  const bundled = await load("discourse", {
    fetchText: () => Promise.reject(new Error("offline")),
    storage: new MemoryStorage(),
  });
  const cachedRemote: FingerprintData = { ...bundled, version: 2 };
  const freshRemote: FingerprintData = { ...bundled, version: 3 };
  await load("discourse", {
    fetchText: () => Promise.resolve(JSON.stringify(cachedRemote)),
    storage,
  });

  const updateError = new Error("apply refreshed fingerprint failed");
  const reported: unknown[] = [];
  let markAttempted: (() => void) | undefined;
  const attempted = new Promise<void>((resolve) => {
    markAttempted = resolve;
  });
  const cached = await load("discourse", {
    fetchText: () => Promise.resolve(JSON.stringify(freshRemote)),
    storage,
    onUpdate: () => {
      markAttempted?.();
      throw updateError;
    },
    onUpdateError: (error) => {
      reported.push(error);
    },
  });
  expect(cached.version).toBe(2);

  await attempted;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(reported).toEqual([updateError]);
});
