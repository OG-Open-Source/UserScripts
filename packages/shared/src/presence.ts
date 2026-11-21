/**
 * Script presence registry.
 *
 * There is no hand-written catalog. Every script announces itself wherever it
 * runs by writing an annotation into the page's DOM; the manager page
 * (index.html, itself a userscript) reads those annotations to know which
 * scripts are installed and what they provide.
 *
 * Same-page discovery uses `globalThis` so scripts see each other even before
 * the DOM annotation is written; the DOM copy is what the manager reads.
 */
/** What a script publishes about itself. The manager page reads this. */
export interface ScriptPresence {
  /** One-line description. */
  description: string;
  /** Userscript id, e.g. "h1dl". */
  id: string;
  /** Absolute URL of the script's locales.json. */
  localeUrl: string;
  /** Display name. */
  name: string;
}

const REGISTRY_ELEMENT_ID = "userscript-registry";
const PRESENCE_EVENT = "userscript:presence";
const PRESENCE_GLOBAL = "__userscriptPresence";

function all(): ScriptPresence[] {
  const root = globalThis as unknown as Record<string, ScriptPresence[]>;
  if (!root[PRESENCE_GLOBAL]) {
    root[PRESENCE_GLOBAL] = [];
  }
  return root[PRESENCE_GLOBAL];
}

/**
 * Announce this script and leave a DOM annotation the manager page reads.
 *
 * Safe to call on any page: the annotation is invisible and costs nothing.
 * Fires an event each time so the manager can pick up late arrivals.
 */
export function publishPresence(presence: ScriptPresence): void {
  const merged: ScriptPresence[] = [];
  for (const item of [...readPresence(), ...all()]) {
    if (!merged.some((existing) => existing.id === item.id)) {
      merged.push(item);
    }
  }
  const idx = merged.findIndex((item) => item.id === presence.id);
  if (idx >= 0) {
    merged[idx] = presence;
  } else {
    merged.push(presence);
  }

  const root = globalThis as unknown as Record<string, ScriptPresence[]>;
  root[PRESENCE_GLOBAL] = merged;

  let el = document.getElementById(
    REGISTRY_ELEMENT_ID
  ) as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement("script");
    el.type = "application/json";
    el.id = REGISTRY_ELEMENT_ID;
    document.head.append(el);
  }
  el.textContent = JSON.stringify(merged);

  window.dispatchEvent(new CustomEvent(PRESENCE_EVENT));
}

/** Read the annotations currently in the page. */
export function readPresence(): ScriptPresence[] {
  const el = document.getElementById(REGISTRY_ELEMENT_ID);
  if (!el?.textContent) {
    return all();
  }
  try {
    return JSON.parse(el.textContent) as ScriptPresence[];
  } catch {
    return all();
  }
}

/**
 * Returns true when running on the hosted UserScripts settings site or any local
 * preview page bearing `<meta name="userscripts-manager" content="1">`.
 */
export function isManagerPage(
  doc: Pick<Document, "querySelector"> = document,
  loc: Pick<Location, "hostname" | "pathname"> = location
): boolean {
  if (
    loc.hostname === "og-open-source.github.io" &&
    loc.pathname.startsWith("/UserScripts")
  ) {
    return true;
  }
  return Boolean(
    doc.querySelector?.('meta[name="userscripts-manager"][content="1"]')
  );
}

/** Await annotations for a moment — scripts run at document-idle, not before. */
export async function waitForPresence(ms = 2000): Promise<ScriptPresence[]> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const seen = readPresence();
    if (seen.length) {
      return seen;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return readPresence();
}
