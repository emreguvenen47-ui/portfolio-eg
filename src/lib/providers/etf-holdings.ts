import "server-only";

/**
 * ETF holdings.
 *
 * Status on this deployment: no source. Finnhub's `/etf/holdings` is not on
 * this plan; the issuer endpoints that publish holdings publicly (iShares,
 * Invesco) return HTML or 503 to a plain request and would need scraping,
 * which the brief rules out and which breaks the first time a page template
 * changes.
 *
 * So this is a complete seam with nothing behind it. `ETFHoldingsSource` is
 * the only interface a provider has to satisfy; register one and the holdings
 * explorer, reverse lookup, overlap and full X-Ray look-through all start
 * working with no other change.
 *
 * The alternative — inferring that QQQ is "about 9% NVDA" from a published
 * factsheet number and treating it as live — would put a stale, invented
 * weight next to real portfolio figures. N/A is the honest answer.
 */

export interface Holding {
  ticker: string;
  name: string;
  /** Percent of fund assets, 0..100. */
  weight: number;
  sector: string | null;
  country: string | null;
  /** Market value of the position inside the fund, if the source carries it. */
  value: number | null;
  /** Weight change against the previous published file, in points. */
  weightChange: number | null;
}

export interface ETFProfile {
  symbol: string;
  name: string | null;
  aum: number | null;
  expenseRatio: number | null;
  dividendYield: number | null;
  holdingsCount: number | null;
  /** Date the holdings file was published. */
  asOf: string | null;
}

export interface ETFHoldings {
  profile: ETFProfile;
  holdings: Holding[];
  available: boolean;
  note: string;
}

/** Implement and register this to light up every ETF surface. */
export interface ETFHoldingsSource {
  name: string;
  /** Full holdings, heaviest first. */
  holdings(symbol: string): Promise<{ profile: ETFProfile; holdings: Holding[] } | null>;
}

/**
 * Registered sources, on globalThis.
 *
 * A plain module array does not survive here: Next hands Server Components and
 * Route Handlers separate instances of the same module, so registration ran in
 * one copy and every lookup read an empty array in another. The symptom was a
 * source that worked perfectly when called directly and reported "not
 * configured" through the normal path — which reads as missing data rather
 * than as a wiring fault.
 */
const SOURCES_KEY = Symbol.for("pcc.etfHoldings.sources");
const SOURCES: ETFHoldingsSource[] = ((globalThis as unknown as Record<symbol, ETFHoldingsSource[]>)[
  SOURCES_KEY
] ??= []);

export function registerHoldingsSource(s: ETFHoldingsSource): void {
  // Registration now runs once per module instance rather than once per
  // process, so the same source arrives more than once. Keyed by name so a
  // second copy replaces rather than duplicates.
  if (SOURCES.some((x) => x.name === s.name)) return;
  SOURCES.push(s);
}

export const hasHoldingsSource = (): boolean => SOURCES.length > 0;

const UNAVAILABLE_NOTE =
  "No ETF holdings source is configured. Fund holdings are not on the current data plan, and issuer files are not fetched because a scraped weight of unknown vintage shown next to real portfolio figures is worse than a blank. Register an ETFHoldingsSource to enable holdings, overlap and full look-through.";

const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_KEY = Symbol.for("pcc.etfHoldings.cache");
const cache: Map<string, { at: number; value: ETFHoldings }> = ((
  globalThis as unknown as Record<symbol, Map<string, { at: number; value: ETFHoldings }>>
)[CACHE_KEY] ??= new Map());

export async function getHoldings(symbol: string): Promise<ETFHoldings> {
  const key = symbol.trim().toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  for (const s of SOURCES) {
    try {
      const r = await s.holdings(key);
      if (r && r.holdings.length) {
        const value: ETFHoldings = {
          profile: r.profile,
          holdings: [...r.holdings].sort((a, b) => b.weight - a.weight),
          available: true,
          note: `Holdings from ${s.name}${r.profile.asOf ? `, as of ${r.profile.asOf}` : ""}.`,
        };
        cache.set(key, { at: Date.now(), value });
        return value;
      }
    } catch {
      // Try the next source rather than failing the page.
    }
  }

  const value: ETFHoldings = {
    profile: {
      symbol: key,
      name: null,
      aum: null,
      expenseRatio: null,
      dividendYield: null,
      holdingsCount: null,
      asOf: null,
    },
    holdings: [],
    available: false,
    note: UNAVAILABLE_NOTE,
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

// ------------------------------------------------------------ derived views

export interface HoldingsSummary {
  holdingsCount: number | null;
  top10Concentration: number | null;
  largest: Holding | null;
  bySector: { label: string; weight: number }[];
  byCountry: { label: string; weight: number }[];
}

export function summarise(h: ETFHoldings): HoldingsSummary {
  if (!h.available || h.holdings.length === 0) {
    return {
      holdingsCount: null,
      top10Concentration: null,
      largest: null,
      bySector: [],
      byCountry: [],
    };
  }
  const group = (pick: (x: Holding) => string | null) => {
    const m = new Map<string, number>();
    for (const x of h.holdings) {
      const k = pick(x);
      if (!k) continue;
      m.set(k, (m.get(k) ?? 0) + x.weight);
    }
    return [...m.entries()]
      .map(([label, weight]) => ({ label, weight }))
      .sort((a, b) => b.weight - a.weight);
  };

  return {
    holdingsCount: h.holdings.length,
    top10Concentration: h.holdings.slice(0, 10).reduce((s, x) => s + x.weight, 0),
    largest: h.holdings[0],
    bySector: group((x) => x.sector),
    byCountry: group((x) => x.country),
  };
}

/**
 * Which of these ETFs hold the given stock, and at what weight.
 *
 * Answered only from real holdings files. With no source registered this
 * returns an empty list, which the UI renders as N/A rather than "no ETF owns
 * this" — those are very different claims.
 */
export async function reverseLookup(
  stock: string,
  etfs: string[],
): Promise<{ available: boolean; rows: { etf: string; weight: number; rank: number; aum: number | null }[] }> {
  if (!hasHoldingsSource()) return { available: false, rows: [] };

  const target = stock.trim().toUpperCase();
  const rows: { etf: string; weight: number; rank: number; aum: number | null }[] = [];

  for (const etf of etfs) {
    const h = await getHoldings(etf);
    if (!h.available) continue;
    const idx = h.holdings.findIndex((x) => x.ticker.toUpperCase() === target);
    if (idx >= 0) {
      rows.push({
        etf,
        weight: h.holdings[idx].weight,
        rank: idx + 1,
        aum: h.profile.aum,
      });
    }
  }
  return { available: true, rows: rows.sort((a, b) => b.weight - a.weight) };
}

/** Overlap between two funds: the weight they hold in common. */
export async function overlap(
  a: string,
  b: string,
): Promise<{ available: boolean; overlapPct: number | null; common: { ticker: string; a: number; b: number }[] }> {
  const [ha, hb] = await Promise.all([getHoldings(a), getHoldings(b)]);
  if (!ha.available || !hb.available) return { available: false, overlapPct: null, common: [] };

  const mapB = new Map(hb.holdings.map((h) => [h.ticker.toUpperCase(), h.weight]));
  const common: { ticker: string; a: number; b: number }[] = [];
  let shared = 0;
  for (const h of ha.holdings) {
    const wb = mapB.get(h.ticker.toUpperCase());
    if (wb === undefined) continue;
    // Overlap is the sum of the smaller weight in each shared name — the
    // portion of the two funds that is genuinely the same exposure.
    shared += Math.min(h.weight, wb);
    common.push({ ticker: h.ticker, a: h.weight, b: wb });
  }
  return {
    available: true,
    overlapPct: shared,
    common: common.sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b)).slice(0, 25),
  };
}
