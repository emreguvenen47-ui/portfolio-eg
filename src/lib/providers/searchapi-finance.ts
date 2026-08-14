import "server-only";
import { sharedCache } from "@/lib/server/shared-cache";

/**
 * Google Finance, via SearchApi — the third opinion.
 *
 * THE CONSTRAINT THAT SHAPES EVERYTHING HERE: the account has a fixed pool of
 * credits, not a monthly allowance. At the time of writing, ninety-nine. That
 * is roughly one hundred companies, ever, unless answers are kept.
 *
 * So this provider is built around not spending:
 *
 * - Never automatic. No page render, no scanner pass, no background sweep can
 *   reach it. It answers a button, and only a button.
 * - Answers are cached for a week and written to the shared Supabase cache, so
 *   a company looked up once is never paid for twice — across users, across
 *   restarts, across deploys.
 * - The remaining balance travels with every response, and the provider
 *   refuses outright below a reserve, so the pool cannot be drained to zero by
 *   a stuck loop.
 *
 * What it is for: a third derivation of figures the other two sources
 * disagree on. Google's financials carry revenue, net income, EPS, net margin,
 * assets, equity, EBITDA and ROA — enough to break a tie on the ratios that
 * matter, and quite separate from both SEC filings and Finnhub.
 */

const BASE = "https://www.searchapi.io/api/v1/search";
const ACCOUNT = "https://www.searchapi.io/api/v1/me";
const TIMEOUT_MS = 20_000;

/** Filed figures change quarterly; a week is conservative. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60_000;

/**
 * Credits held back so an accident cannot empty the pool.
 *
 * A few in reserve means a later deliberate lookup still works after something
 * has gone wrong, rather than the feature being silently dead.
 */
const RESERVE = 5;

export const isSearchApiConfigured = (): boolean =>
  Boolean(process.env.SEARCHAPI_KEY?.trim());

export interface GoogleFinancePeriod {
  year: number;
  /** Absent on an annual period. */
  quarter: number | null;
  currency: string;
  revenue: number | null;
  netIncome: number | null;
  eps: number | null;
  netMargin: number | null;
  totalAssets: number | null;
  totalEquity: number | null;
  ebitda: number | null;
  freeCashFlow: number | null;
  returnOnAssets: number | null;
  returnOnCapital: number | null;
  priceToBook: number | null;
  sharesOutstanding: number | null;
}

export interface GoogleFinance {
  symbol: string;
  exchange: string | null;
  price: number | null;
  currency: string | null;
  /** Headline stats as Google presents them, label → value, unparsed. */
  stats: Record<string, string>;
  quarterly: GoogleFinancePeriod[];
  annual: GoogleFinancePeriod[];
  fetchedAt: string;
}

/** Durable and shared: a symbol paid for once is never paid for again. */
const cache = sharedCache<GoogleFinance | null>("gfinance", CACHE_TTL_MS);

const n = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Google nests most figures as `{value, last_year_value, price_change}`. */
const val = (v: unknown): number | null => {
  if (typeof v === "number") return n(v);
  if (v && typeof v === "object" && "value" in v) return n((v as { value: unknown }).value);
  return null;
};

interface RawPeriod {
  year?: number;
  quarter?: number;
  currency?: string;
  [k: string]: unknown;
}

function toPeriod(r: RawPeriod): GoogleFinancePeriod | null {
  if (typeof r.year !== "number") return null;
  return {
    year: r.year,
    quarter: typeof r.quarter === "number" ? r.quarter : null,
    currency: typeof r.currency === "string" ? r.currency : "USD",
    revenue: val(r.revenue),
    netIncome: val(r.net_income),
    eps: val(r.earnings_per_share),
    netMargin: val(r.net_profit_margin),
    totalAssets: val(r.total_assets),
    totalEquity: val(r.total_equity),
    ebitda: val(r.ebitda),
    freeCashFlow: val(r.free_cash_flow),
    returnOnAssets: val(r.return_on_assets_percentage),
    returnOnCapital: val(r.return_on_capital),
    priceToBook: val(r.price_to_book),
    sharesOutstanding: val(r.shares_outstanding),
  };
}

export interface CreditBalance {
  remaining: number | null;
  usedThisMonth: number | null;
}

/**
 * Remaining credits.
 *
 * This endpoint does not itself cost a search — verified against the balance
 * before and after — so it is safe to call for display.
 */
export async function getCredits(): Promise<CreditBalance> {
  const key = process.env.SEARCHAPI_KEY?.trim();
  if (!key) return { remaining: null, usedThisMonth: null };
  try {
    const res = await fetch(`${ACCOUNT}?api_key=${encodeURIComponent(key)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { remaining: null, usedThisMonth: null };
    const j = (await res.json()) as {
      account?: { remaining_credits?: number; current_month_usage?: number };
    };
    return {
      remaining: n(j.account?.remaining_credits),
      usedThisMonth: n(j.account?.current_month_usage),
    };
  } catch {
    return { remaining: null, usedThisMonth: null };
  }
}

export type LookupOutcome =
  | { status: "OK"; data: GoogleFinance; fromCache: boolean; creditsLeft: number | null }
  | { status: "CACHED_ONLY"; data: GoogleFinance }
  | { status: "NOT_CONFIGURED" }
  | { status: "EXHAUSTED"; creditsLeft: number | null }
  | { status: "FAILED"; reason: string };

/**
 * Look up one company.
 *
 * `spend` must be passed explicitly. A caller that only wants a cached answer
 * — a page render, say — passes false and gets nothing new, which is the
 * safeguard that keeps a render from costing a credit.
 */
export async function getGoogleFinance(
  symbol: string,
  exchange: string,
  spend: boolean,
): Promise<LookupOutcome> {
  const key = process.env.SEARCHAPI_KEY?.trim();
  if (!key) return { status: "NOT_CONFIGURED" };

  const sym = symbol.toUpperCase();
  await cache.ready();

  const hit = cache.get(sym);
  if (hit) return { status: "OK", data: hit, fromCache: true, creditsLeft: null };
  if (!spend) {
    return { status: "FAILED", reason: "Not looked up yet, and this call may not spend a credit." };
  }

  const credits = await getCredits();
  if (credits.remaining !== null && credits.remaining <= RESERVE) {
    return { status: "EXHAUSTED", creditsLeft: credits.remaining };
  }

  const params = new URLSearchParams({
    engine: "google_finance",
    q: `${sym}:${exchange}`,
    api_key: key,
  });

  try {
    const res = await fetch(`${BASE}?${params}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { status: "FAILED", reason: `Upstream returned ${res.status}` };

    const j = (await res.json()) as {
      summary?: { stock?: string; exchange?: string; price?: number; currency?: string };
      knowledge_graph?: { stats?: { label?: string; value?: string }[] };
      financials?: { quarterly?: RawPeriod[]; annual?: RawPeriod[] };
    };

    const quarterly = (j.financials?.quarterly ?? [])
      .map(toPeriod)
      .filter((p): p is GoogleFinancePeriod => p !== null);

    // A response with no financials is not worth a cache entry that would
    // stop us retrying after the upstream recovers.
    if (quarterly.length === 0 && (j.financials?.annual ?? []).length === 0) {
      return { status: "FAILED", reason: "No financials in the response for this symbol." };
    }

    const data: GoogleFinance = {
      symbol: sym,
      exchange: j.summary?.exchange ?? exchange,
      price: n(j.summary?.price),
      currency: j.summary?.currency ?? null,
      stats: Object.fromEntries(
        (j.knowledge_graph?.stats ?? [])
          .filter((s) => s.label && s.value)
          .map((s) => [s.label as string, s.value as string]),
      ),
      quarterly,
      annual: (j.financials?.annual ?? [])
        .map(toPeriod)
        .filter((p): p is GoogleFinancePeriod => p !== null),
      fetchedAt: new Date().toISOString(),
    };

    cache.set(sym, data);
    return {
      status: "OK",
      data,
      fromCache: false,
      creditsLeft: credits.remaining === null ? null : credits.remaining - 1,
    };
  } catch (e) {
    return { status: "FAILED", reason: e instanceof Error ? e.message : "Request failed" };
  }
}

/** Cached answer only — safe on a render, never costs anything. */
export async function peekGoogleFinance(symbol: string): Promise<GoogleFinance | null> {
  if (!isSearchApiConfigured()) return null;
  await cache.ready();
  return cache.get(symbol.toUpperCase()) ?? null;
}
