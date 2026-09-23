/**
 * Capability claims.
 *
 * A script does one kind of thing, named by a capability such as
 * `hanime1:download`. Several single-purpose scripts can run together because
 * their capabilities differ. An all-in-one script bundles several of them and
 * therefore collides with each single-purpose script it covers.
 *
 * Claims live on `globalThis`, shared by every script in the page. The first
 * claim wins; a later script that overlaps stands down instead of injecting
 * twice.
 */

/** `feature` is one capability. `aio` bundles several and excludes them. */
export type ScriptKind = "feature" | "aio";

export interface ScriptClaim {
  /** Userscript id, e.g. "h1dl". */
  id: string;
  kind: ScriptKind;
  /** Capabilities this script provides. */
  capabilities: string[];
}

interface ClaimRegistry {
  claims: ScriptClaim[];
}

const CLAIM_GLOBAL = "__userscriptClaims";

function registry(): ClaimRegistry {
  const root = globalThis as unknown as Record<string, ClaimRegistry>;
  let value = root[CLAIM_GLOBAL];
  if (!value) {
    value = { claims: [] };
    root[CLAIM_GLOBAL] = value;
  }
  return value;
}

export interface ClaimResult {
  /** False when an already-installed script covers the same capability. */
  ok: boolean;
  /** The script that got there first, when `ok` is false. */
  conflict?: ScriptClaim;
}

/**
 * Claim this script's capabilities.
 *
 * A `feature` conflicts only with an `aio` that lists the same capability.
 * An `aio` conflicts with any script, feature or aio, sharing one capability.
 * Two features never conflict, even on the same capability: the user may want
 * both, and they are expected to target different sites.
 */
export function claimCapabilities(claim: ScriptClaim): ClaimResult {
  const existing = registry().claims;

  const conflict = existing.find((other) => overlaps(claim, other));
  if (conflict) return { ok: false, conflict };

  existing.push(claim);
  return { ok: true };
}

function overlaps(a: ScriptClaim, b: ScriptClaim): boolean {
  const shared = a.capabilities.some((item) => b.capabilities.includes(item));
  if (!shared) return false;
  // Two single-purpose scripts coexist. Anything involving an aio does not.
  return a.kind === "aio" || b.kind === "aio";
}
