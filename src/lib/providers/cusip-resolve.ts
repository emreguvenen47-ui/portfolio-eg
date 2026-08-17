import "server-only";
import { cachedScreenerUniverse, loadScreenerUniverse } from "@/lib/scanner/screener-universe";

/**
 * CUSIP to ticker, resolved through the issuer name on the filing.
 *
 * There is no free CUSIP-to-ticker directory — the identifier is licensed, and
 * the hand-written map this replaces covered forty companies out of the
 * forty-seven thousand rows a large manager files. Everything else rendered as
 * a truncated issuer string, unlinkable and unusable in a chart.
 *
 * A 13F does carry the issuer name, and the listing already holds seven
 * thousand company names. Matching one to the other recovers most of it.
 *
 * WHERE THIS STOPS, deliberately: a name that does not match confidently
 * resolves to null and the row keeps its issuer string. A wrong ticker here is
 * worse than no ticker — it would attribute one manager's position to another
 * company, and the number would look perfectly reasonable. So the matching is
 * exact-after-normalisation, never fuzzy, and ambiguous names are dropped
 * rather than guessed.
 */

/**
 * Corporate-form words and filing abbreviations, removed before comparison.
 *
 * A 13F writes "AMERICAN EXPRESS CO", the listing writes "American Express
 * Company". Neither spelling is wrong; they simply are not the same string.
 */
const NOISE = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "companies",
  "ltd", "limited", "plc", "llc", "lp", "holdings", "holding", "group",
  "the", "sa", "nv", "ag", "se", "trust", "tr", "fund", "etf",
  "common", "stock", "shares", "share", "class", "cl", "ord", "adr", "ads",
  "new", "del", "delaware", "usa", "us", "international", "intl",
]);

/** Long forms a 13F habitually truncates. */
const EXPAND: Record<string, string> = {
  amern: "american",
  amer: "american",
  intl: "international",
  natl: "national",
  finl: "financial",
  fin: "financial",
  tech: "technologies",
  technol: "technologies",
  pharm: "pharmaceuticals",
  pharma: "pharmaceuticals",
  comm: "communications",
  commun: "communications",
  sys: "systems",
  svcs: "services",
  svc: "services",
  mtr: "motor",
  indl: "industrial",
  inds: "industries",
  res: "resources",
  pptys: "properties",
  enrgy: "energy",
  entmt: "entertainment",
  entm: "entertainment",
  hldgs: "holdings",
};

function normalise(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .map((w) => EXPAND[w] ?? w)
    .filter((w) => w.length > 0 && !NOISE.has(w))
    .join(" ");
}

interface Resolver {
  /** Normalised company name → ticker. Ambiguous names are absent. */
  byName: Map<string, string>;
  /** CUSIP → ticker, learned as filings are read. */
  byCusip: Map<string, string>;
  built: boolean;
}

const KEY = Symbol.for("pcc.cusip.resolver");
const state: Resolver = ((globalThis as unknown as Record<symbol, Resolver>)[KEY] ??= {
  byName: new Map(),
  byCusip: new Map(),
  built: false,
});

/** Seed from the listing. Cheap: it is already in memory for the scanner. */
export async function buildResolver(): Promise<void> {
  if (state.built) return;

  const universe = cachedScreenerUniverse().length
    ? cachedScreenerUniverse()
    : await loadScreenerUniverse().catch(() => []);
  if (universe.length === 0) return;

  // Two companies normalising to the same name make both unusable: there is
  // no way to tell which the filing meant.
  const seen = new Map<string, string | null>();
  for (const r of universe) {
    if (r.region !== "US") continue;
    const key = normalise(r.name);
    if (!key) continue;
    seen.set(key, seen.has(key) ? null : r.symbol);
  }

  for (const [k, v] of seen) if (v !== null) state.byName.set(k, v);
  state.built = true;
}

/** Hand-verified CUSIPs, which always win over a name match. */
export function seedCusips(map: Record<string, string>): void {
  for (const [c, t] of Object.entries(map)) state.byCusip.set(c.toUpperCase(), t);
}

/**
 * Resolve one holding.
 *
 * The CUSIP is the key, but the name is what does the work the first time; the
 * pairing is then remembered so the same CUSIP costs nothing again.
 */
export function resolveHolding(cusip: string, issuer: string): string | null {
  const c = cusip.toUpperCase();
  const known = state.byCusip.get(c);
  if (known) return known;

  const hit = state.byName.get(normalise(issuer));
  if (!hit) return null;

  state.byCusip.set(c, hit);
  return hit;
}

export const resolverStats = () => ({
  names: state.byName.size,
  cusips: state.byCusip.size,
  built: state.built,
});
