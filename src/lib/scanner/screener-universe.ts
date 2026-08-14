import "server-only";
import { classifyMarketCap, classifySector } from "./classify";
import type { CapBucket, Region, Sector } from "./types";
import { loadBistUniverse } from "@/lib/providers/bist-universe";

/**
 * The scannable universe, WITH market cap and sector, in one request.
 *
 * This is what makes filter-first possible. Previously size and sector only
 * existed after a per-symbol profile call, so the scanner could not know which
 * companies were small caps until it had already spent its request budget —
 * and it spent that budget on a hand-written seed list that began with the
 * mega caps. A small-cap query could therefore only ever return whatever
 * happened to be warm, which was never a small cap.
 *
 * Nasdaq's public screener returns roughly 7,000 US listings with market cap,
 * sector and industry in a single call. The pool can now be built from the
 * user's filters first and fundamentals fetched only for what survives them.
 */

const TTL_MS = 12 * 60 * 60_000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) PortfolioEG/1.0";

const KEY = Symbol.for("pcc.scanner.screenerUniverse");
const cache = globalThis as unknown as Record<
  symbol,
  { at: number; value: UniverseRow[] } | undefined
>;

export interface UniverseRow {
  symbol: string;
  name: string;
  region: Region;
  currency: string;
  /** Absolute currency units, never millions. */
  marketCap: number | null;
  bucket: CapBucket | null;
  sector: Sector;
  /** Provider industry string, used for the narrow peer group. */
  industry: string | null;
  price: number | null;
  /** Average daily share volume as reported by the screener. */
  volume: number | null;
  dollarVolume: number | null;
  /**
   * Listing venue — NASDAQ, NYSE or AMEX.
   *
   * Carried because some sources key a company by venue rather than by ticker
   * alone, and guessing produces a lookup for a company that does not exist
   * rather than an error. Null for BIST, which has one venue.
   */
  exchange: string | null;
}

interface NasdaqRow {
  symbol?: string;
  name?: string;
  lastsale?: string;
  volume?: string;
  marketCap?: string;
  country?: string;
  industry?: string;
  sector?: string;
}

const money = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = Number(String(s).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The three US venues, fetched separately so each row knows where it lists.
 *
 * The combined download does not say. Three requests behind a twelve-hour
 * cache is a small price for never having to guess a venue — and a wrong guess
 * does not fail loudly, it returns a different company's numbers.
 */
const US_VENUES = ["nasdaq", "nyse", "amex"] as const;

async function loadUs(): Promise<UniverseRow[]> {
  const perVenue = await Promise.all(US_VENUES.map((v) => loadVenue(v)));
  const all = perVenue.flat();

  // If every venue failed, say so by returning nothing; the caller keeps the
  // previous pull rather than emptying the scanner.
  if (all.length === 0) return [];

  // A symbol listed on two venues keeps the first, which is the deeper book.
  const seen = new Set<string>();
  return all.filter((r) => (seen.has(r.symbol) ? false : (seen.add(r.symbol), true)));
}

async function loadVenue(venue: (typeof US_VENUES)[number]): Promise<UniverseRow[]> {
  try {
    const res = await fetch(
      `https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&offset=0&download=true&exchange=${venue}`,
      {
        cache: "no-store",
        headers: { "User-Agent": UA, Accept: "application/json" },
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data?: { rows?: NasdaqRow[] } };
    const rows = json.data?.rows ?? [];

    return rows
      .filter((r) => r.symbol && !/[.^/]/.test(r.symbol))
      .map((r) => {
        const marketCap = money(r.marketCap);
        const price = money(r.lastsale);
        const volume = money(r.volume);
        return {
          symbol: r.symbol!.trim().toUpperCase(),
          name: (r.name ?? r.symbol!).replace(/\s+Common Stock\s*$/i, "").trim(),
          region: "US" as const,
          currency: "USD",
          marketCap,
          bucket: classifyMarketCap(marketCap, "USD", "US"),
          sector: classifySector(r.industry, r.sector),
          industry: r.industry?.trim() || null,
          price,
          volume,
          dollarVolume: price !== null && volume !== null ? price * volume : null,
          exchange: venue.toUpperCase(),
        };
      });
  } catch {
    return [];
  }
}

/**
 * BIST rows.
 *
 * The listing feed carries no market cap, so every BIST name is SIZE UNKNOWN
 * and is excluded whenever a size filter is active — rather than being
 * defaulted into a bucket it may not belong to.
 */
async function loadBist(): Promise<UniverseRow[]> {
  const rows = await loadBistUniverse().catch(() => []);
  return rows.map((b) => ({
    symbol: b.ticker,
    name: b.companyName,
    region: "BIST" as const,
    currency: b.currency || "TRY",
    marketCap: null,
    bucket: null,
    sector: "Other" as Sector,
    industry: null,
    price: null,
    volume: null,
    dollarVolume: null,
    // Borsa İstanbul has one venue, so there is nothing to distinguish.
    exchange: null,
  }));
}

/**
 * One load at a time.
 *
 * The universe is a single seven-thousand-row fetch that every scanner and
 * screener request needs. On a cold start several requests arrive together and
 * each would pull the whole listing; sharing the promise makes that one pull.
 */
let loading: Promise<UniverseRow[]> | null = null;

export async function loadScreenerUniverse(): Promise<UniverseRow[]> {
  const hit = cache[KEY];
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  if (loading) return loading;
  loading = loadUniverse().finally(() => {
    loading = null;
  });
  return loading;
}

async function loadUniverse(): Promise<UniverseRow[]> {
  const hit = cache[KEY];
  const [us, bist] = await Promise.all([loadUs(), loadBist()]);
  const value = [...us, ...bist];

  // Keep the previous pull rather than emptying the scanner on one blip.
  if (us.length === 0) return hit?.value ?? value;

  cache[KEY] = { at: Date.now(), value };
  return value;
}

export const cachedScreenerUniverse = (): UniverseRow[] => cache[KEY]?.value ?? [];
