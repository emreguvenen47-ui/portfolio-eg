import "server-only";
import { getCrumb } from "./yahoo-fundamentals";
import { greeks, yearsToExpiry, type Greeks } from "@/lib/research/greeks";

/**
 * Option chains.
 *
 * The same public endpoint Yahoo Finance's own site calls, behind the same
 * cookie-and-crumb handshake the statements provider already performs — the
 * crumb is shared, so adding options costs no extra handshake.
 *
 * On pricing, which is the part that matters for a ledger: an option's "price"
 * is not one number. The last trade may be hours stale on a strike nobody has
 * touched today, while bid and ask describe where you could actually deal. So
 * all three travel together and the mark is the mid when a two-sided quote
 * exists, falling back to the last trade only when it does not — and `markFrom`
 * says which happened, because a position valued off a stale print is not the
 * same as one valued off a live market.
 *
 * Greeks are computed from the chain's own published implied volatility —
 * arithmetic on observed inputs, not a forecast. Nothing is solved for: a
 * strike with no credible IV gets no greeks rather than an invented one. See
 * greeks.ts.
 */

const BASE = "https://query2.finance.yahoo.com/v7/finance/options";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) PortfolioEG/1.0";
const TIMEOUT_MS = 12_000;

/** Chains move all day; a few minutes is the useful compromise. */
const CACHE_TTL_MS = 5 * 60_000;

export type OptionType = "CALL" | "PUT";

export interface OptionQuote {
  /** OCC-style contract symbol, e.g. AAPL260814C00315000. */
  contract: string;
  type: OptionType;
  strike: number;
  /** Expiry as yyyy-mm-dd, UTC. */
  expiry: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  /** Mid when a two-sided quote exists, else the last trade. Null if neither. */
  mark: number | null;
  markFrom: "MID" | "LAST" | null;
  impliedVolatility: number | null;
  openInterest: number | null;
  volume: number | null;
  inTheMoney: boolean | null;
  /**
   * Derivatives of the Black-Scholes price at this contract's own published
   * implied volatility. Null when the venue publishes no IV — see greeks.ts
   * for why nothing is solved for in that case.
   */
  greeks: Greeks | null;
}

export interface OptionChain {
  symbol: string;
  /** Underlying price at the time the chain was pulled. */
  underlying: number | null;
  /** Every expiry the venue lists, yyyy-mm-dd. */
  expiries: string[];
  /** The expiry these contracts belong to. */
  expiry: string | null;
  calls: OptionQuote[];
  puts: OptionQuote[];
  fetchedAt: string;
}

const KEY = Symbol.for("pcc.yahoo.options");
const cache: Map<string, { at: number; value: OptionChain | null }> = ((
  globalThis as unknown as Record<symbol, Map<string, { at: number; value: OptionChain | null }>>
)[KEY] ??= new Map());

const n = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const toDate = (epochSeconds: unknown): string | null => {
  const e = n(epochSeconds);
  return e === null ? null : new Date(e * 1000).toISOString().slice(0, 10);
};

interface RawContract {
  contractSymbol?: string;
  strike?: number;
  expiration?: number;
  bid?: number;
  ask?: number;
  lastPrice?: number;
  impliedVolatility?: number;
  openInterest?: number;
  volume?: number;
  inTheMoney?: boolean;
}

function toQuote(
  c: RawContract,
  type: OptionType,
  spot: number | null,
  rate: number,
): OptionQuote | null {
  const strike = n(c.strike);
  const contract = c.contractSymbol;
  const expiry = toDate(c.expiration);
  if (strike === null || !contract || !expiry) return null;

  const bid = n(c.bid);
  const ask = n(c.ask);
  const last = n(c.lastPrice);

  // A zero bid with a zero ask is Yahoo saying "no quote", not a free option.
  const twoSided = bid !== null && ask !== null && ask > 0;
  const mark = twoSided ? (bid + ask) / 2 : last;

  const iv = n(c.impliedVolatility);
  const markPrice = mark !== null && mark > 0 ? mark : null;

  /**
   * Greeks, but only when the chain's own price agrees with them.
   *
   * A published implied volatility is supposed to be the number that makes the
   * model reproduce the market price. Out of hours Yahoo publishes values that
   * do not: a September call marked at 7.35 came back with an IV of 1.6%,
   * which prices the same contract at one cent. Delta and gamma computed from
   * that are arithmetically correct and financially meaningless.
   *
   * So the model is checked against the market it claims to describe. If the
   * theoretical price is nowhere near the mark, the input was not an implied
   * volatility for this contract and the greeks are withheld. Nothing is
   * solved for and nothing is adjusted — the row simply reads N/A, which is
   * what "we cannot measure this right now" looks like.
   */
  const raw =
    spot !== null && iv !== null
      ? greeks({ spot, strike, years: yearsToExpiry(expiry), iv, rate, type })
      : null;

  // Proportional, with a few cents of slack for contracts priced in pennies.
  // A flat allowance let a 0.23 mark pass against a theoretical of zero, which
  // is the same failure in smaller numbers.
  const consistent =
    raw !== null &&
    (markPrice === null ||
      Math.abs(raw.theoretical - markPrice) <= Math.max(0.35 * markPrice, 0.05));

  return {
    contract,
    type,
    strike,
    expiry,
    bid,
    ask,
    last,
    mark: mark !== null && mark > 0 ? mark : null,
    markFrom: mark === null || mark <= 0 ? null : twoSided ? "MID" : "LAST",
    impliedVolatility: iv,
    openInterest: n(c.openInterest),
    volume: n(c.volume),
    inTheMoney: typeof c.inTheMoney === "boolean" ? c.inTheMoney : null,
    greeks: consistent ? raw : null,
  };
}

/**
 * Short-rate assumption for discounting.
 *
 * A single constant rather than a live curve. Over the horizons these chains
 * cover, rho is the smallest greek by an order of magnitude and a point of
 * rate error moves a one-year at-the-money option by cents; fetching a curve
 * to refine it would add a dependency for no visible difference. Stated here
 * so the assumption is not hidden.
 */
const RISK_FREE = 0.045;

/**
 * Fetch one expiry's chain. Omit `expiry` for the nearest one.
 */
export async function getOptionChain(
  symbol: string,
  expiry?: string,
): Promise<OptionChain | null> {
  const key = `${symbol.toUpperCase()}:${expiry ?? "front"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const auth = await getCrumb();
  if (!auth) return null;

  const params = new URLSearchParams({ crumb: auth.crumb });
  if (expiry) {
    // The endpoint takes an epoch-second expiry, not a date string.
    params.set("date", String(Math.floor(Date.parse(`${expiry}T00:00:00Z`) / 1000)));
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(symbol)}?${params}`, {
      headers: { "User-Agent": UA, Cookie: auth.cookie, Accept: "application/json" },
      cache: "no-store",
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = (await res.json()) as {
      optionChain?: {
        result?: {
          underlyingSymbol?: string;
          expirationDates?: number[];
          quote?: { regularMarketPrice?: number };
          options?: { expirationDate?: number; calls?: RawContract[]; puts?: RawContract[] }[];
        }[];
      };
    };

    const r = json.optionChain?.result?.[0];
    if (!r) throw new Error("No chain in response");

    const block = r.options?.[0];
    const value: OptionChain = {
      symbol: symbol.toUpperCase(),
      underlying: n(r.quote?.regularMarketPrice),
      expiries: (r.expirationDates ?? [])
        .map((e) => toDate(e))
        .filter((d): d is string => d !== null),
      expiry: toDate(block?.expirationDate),
      calls: (block?.calls ?? [])
        .map((c) => toQuote(c, "CALL", n(r.quote?.regularMarketPrice), RISK_FREE))
        .filter((q): q is OptionQuote => q !== null),
      puts: (block?.puts ?? [])
        .map((c) => toQuote(c, "PUT", n(r.quote?.regularMarketPrice), RISK_FREE))
        .filter((q): q is OptionQuote => q !== null),
      fetchedAt: new Date().toISOString(),
    };

    cache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    // Serve the previous pull rather than blanking a chain on one blip; a
    // null here means we have never had one.
    cache.set(key, { at: Date.now(), value: hit?.value ?? null });
    return hit?.value ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Current mark for a specific contract.
 *
 * Used to value an open position. Returns null rather than a guess when the
 * contract is not in the chain — an expired or delisted strike has no price,
 * and inventing one would put a fabricated P&L in a ledger.
 */
export async function getContractMark(
  symbol: string,
  contract: string,
  expiry: string,
): Promise<OptionQuote | null> {
  const chain = await getOptionChain(symbol, expiry);
  if (!chain) return null;
  return (
    [...chain.calls, ...chain.puts].find((q) => q.contract === contract) ?? null
  );
}
