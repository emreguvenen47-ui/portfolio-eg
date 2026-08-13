import "server-only";
import { getHistories, getQuotes } from "@/lib/providers";
import { getFinancials, getMetrics, getRecommendations } from "@/lib/providers/fundamentals";
import { getYahooStatements } from "@/lib/providers/yahoo-fundamentals";
import { ordered, netCash, totalDebt, ttmGrowth } from "@/lib/research/statements";
import { scoreQuality } from "@/lib/portfolio/quality-score";
import { buildFacts } from "@/lib/scanner/metrics";
import type { UniverseRow } from "@/lib/scanner/screener-universe";
import type { Candle } from "@/lib/types";
import { diskCache } from "@/lib/server/disk-cache";
import type { Row } from "./metrics";

/**
 * Turn a universe row into a full metric row.
 *
 * Ratios are computed locally from filed inputs wherever the arithmetic is
 * unambiguous — enterprise value from market cap, debt and cash; EV/EBITDA
 * from that and reported EBITDA. Spending a provider request on a precomputed
 * ratio we can derive ourselves is the difference between covering a hundred
 * small caps and covering six.
 *
 * A ratio whose inputs are missing stays null. It is never approximated, and
 * a null never becomes a zero.
 */

const CACHE_TTL_MS = 24 * 60 * 60_000;
/**
 * A row whose fundamentals fetch came back empty is held only briefly.
 *
 * Warming a pool can outrun a provider's allowance, and a throttled response
 * looks exactly like a company that reports nothing. Caching that for a day
 * would freeze a transient outage into permanent "N/A" for hundreds of names.
 * Held for minutes instead, so the next pass re-asks.
 */
const PROVISIONAL_TTL_MS = 5 * 60_000;

interface CacheEntry {
  at: number;
  value: Row | null;
  /** True when the fundamentals fetch produced nothing to work from. */
  provisional: boolean;
}

/**
 * Kept on disk for the same reason the scanner's is: these rows cost metered
 * calls to build, and a restart that discards them makes the screener start
 * from an empty table every session. The entry keeps its own timestamp so the
 * provisional/final distinction survives the round trip.
 */
const cache = diskCache<CacheEntry>("screener-rows", CACHE_TTL_MS);

const fresh = (e: CacheEntry): boolean =>
  Date.now() - e.at < (e.provisional ? PROVISIONAL_TTL_MS : CACHE_TTL_MS);

const closes = (c: Candle[]) => c.map((x) => x.close).filter((x) => Number.isFinite(x) && x > 0);

const sma = (px: number[], n: number): number | null =>
  px.length < n ? null : px.slice(-n).reduce((a, b) => a + b, 0) / n;

function rsi(px: number[], period = 14): number | null {
  if (px.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = px.length - period; i < px.length; i++) {
    const d = px[i] - px[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + gain / period / avgLoss);
}

const pctFrom = (v: number | null, ref: number | null): number | null =>
  v === null || ref === null || ref === 0 ? null : (v / ref - 1) * 100;

function retBars(px: number[], bars: number): number | null {
  if (px.length <= bars) return null;
  const ref = px[px.length - 1 - bars];
  return ref > 0 ? (px.at(-1)! / ref - 1) * 100 : null;
}

function ytdReturn(candles: Candle[]): number | null {
  const year = new Date().getUTCFullYear();
  const start = `${year}-01-01`;
  const inYear = candles.filter((c) => c.date >= start);
  if (inYear.length < 2) return null;
  const first = inYear[0].close;
  const last = inYear.at(-1)!.close;
  return first > 0 ? (last / first - 1) * 100 : null;
}

const ttmOf = (
  ps: ReturnType<typeof ordered>,
  f: (p: ReturnType<typeof ordered>[number]) => number | null,
): number | null => {
  const w = ps.slice(-4);
  if (w.length < 4) return null;
  return w.reduce<number | null>((s, p) => {
    const v = f(p);
    return s === null || v === null ? null : s + v;
  }, 0);
};

export interface EnrichOptions {
  /** Benchmark series for relative strength. */
  benchmark?: Candle[];
  /**
   * Analyst consensus costs its own request against a tight allowance, and
   * most screens never mention it. Fetched only when asked for.
   */
  needAnalyst?: boolean;
}

export async function enrichRow(u: UniverseRow, opts: EnrichOptions = {}): Promise<Row | null> {
  const hit = cache.get(u.symbol);
  if (hit && fresh(hit)) return hit.value;

  const [metrics, secFin, quotes, histories, recs] = await Promise.all([
    getMetrics(u.symbol).catch(() => null),
    getFinancials(u.symbol).catch(() => null),
    getQuotes([u.symbol], { maxAgeMs: 30 * 60_000 }).catch(() => ({}) as Record<string, never>),
    getHistories([u.symbol], 400).catch(() => ({}) as Record<string, never>),
    opts.needAnalyst ? getRecommendations(u.symbol).catch(() => null) : null,
  ]);

  const alt = secFin?.length ? null : await getYahooStatements(u.symbol).catch(() => null);
  const periods = ordered(alt?.quarterly ?? secFin ?? [], 8);
  const candles =
    (histories as Record<string, { candles?: Candle[] }>)[u.symbol]?.candles ?? [];
  const quote = (quotes as Record<string, { price?: number } | undefined>)[u.symbol];
  const price = quote?.price ?? candles.at(-1)?.close ?? u.price ?? null;

  const r = recs?.[0];
  const analystScore = (() => {
    if (!r) return null;
    const t = r.strongBuy + r.buy + r.hold + r.sell + r.strongSell;
    if (t === 0) return null;
    return Math.round(((r.strongBuy * 2 + r.buy - r.sell - r.strongSell * 2) / (t * 2) + 1) * 50);
  })();

  const facts = buildFacts({ symbol: u.symbol, metrics, periods, candles, analystScore });

  const last = periods.at(-1) ?? null;
  const px = closes(candles);
  const mcap = u.marketCap;

  // --- enterprise value, derived rather than fetched
  const debt = last ? totalDebt(last) : null;
  const cash = last?.cash ?? null;
  const sti = last?.shortTermInvestments ?? null;
  const liquid = cash === null ? null : cash + (sti ?? 0);
  const ev =
    mcap !== null && debt !== null && liquid !== null ? mcap + debt - liquid : null;
  const nd = debt !== null && liquid !== null ? debt - liquid : null;

  const ttmEbit = ttmOf(periods, (p) => p.operatingIncome);
  const ttmDep = ttmOf(periods, (p) => p.depreciation);
  const ebitda = ttmEbit !== null && ttmDep !== null ? ttmEbit + ttmDep : null;
  const ttmRev = ttmOf(periods, (p) => p.revenue);
  const ttmNi = ttmOf(periods, (p) => p.netIncome);
  const ttmFcf = ttmOf(periods, (p) => p.freeCashFlow);

  const num = (v: number | string | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const year1 = periods.length >= 5 ? periods[periods.length - 5] : null;
  const prior = periods.length >= 2 ? periods[periods.length - 2] : null;

  const high52 = px.length > 60 ? Math.max(...px.slice(-253)) : null;
  const low52 = px.length > 60 ? Math.min(...px.slice(-253)) : null;

  const bench = opts.benchmark ? closes(opts.benchmark) : [];
  const rel = (() => {
    const a = retBars(px, 126);
    const b = retBars(bench, 126);
    return a !== null && b !== null ? a - b : null;
  })();

  const value: Row = {
    ...facts,
    peg: num(metrics?.pegTTM) ?? num(metrics?.forwardPEG),
    marketCap: mcap,
    enterpriseValue: ev,
    evEbit: ev !== null && ttmEbit !== null && ttmEbit > 0 ? ev / ttmEbit : null,
    ebitdaMargin: ebitda !== null && ttmRev ? (ebitda / ttmRev) * 100 : null,
    earningsYield: facts.pe !== null && facts.pe > 0 ? (1 / facts.pe) * 100 : null,
    dividendYield: num(metrics?.dividendYieldIndicatedAnnual),
    netDebtToEbitda: nd !== null && ebitda !== null && ebitda > 0 ? nd / ebitda : null,
    cashToDebt: liquid !== null && debt !== null && debt > 0 ? liquid / debt : null,
    quickRatio: num(metrics?.quickRatioQuarterly),
    netDebt: nd,
    cash: liquid,
    rsi: rsi(px),
    fromHigh52: pctFrom(price, high52),
    fromLow52: pctFrom(price, low52),
    from20dma: pctFrom(price, sma(px, 20)),
    from50dma: pctFrom(price, sma(px, 50)),
    from200dma: pctFrom(price, sma(px, 200)),
    returnYtd: ytdReturn(candles),
    return1d: retBars(px, 1),
    return1w: retBars(px, 5),
    relativeStrength: rel,
    avgDollarVolume: u.dollarVolume,
    qualityScore: scoreQuality(metrics).total,
    // Filled in by the caller once peer groups exist; the screener computes
    // these from the same engine the scanner uses.
    opportunityScore: null,
    fairValueUpside: null,
    bookValueGrowthYoy:
      last?.equity != null && year1?.equity
        ? ((last.equity - year1.equity) / Math.abs(year1.equity)) * 100
        : null,
    revenueGrowthQoq:
      last?.revenue != null && prior?.revenue
        ? ((last.revenue - prior.revenue) / Math.abs(prior.revenue)) * 100
        : null,
    epsGrowthQoq:
      last?.eps != null && prior?.eps
        ? ((last.eps - prior.eps) / Math.abs(prior.eps)) * 100
        : null,
    operatingIncomeGrowth: ttmGrowth(periods, (p) => p.operatingIncome),
    fcfGrowth: ttmGrowth(periods, (p) => p.freeCashFlow),
  };

  // EV/EBITDA and P/E are derived here when the provider bag lacks them, so a
  // small cap with filed statements is not dropped for want of a precomputed
  // ratio nobody publishes for it.
  if (value.evEbitda === null && ev !== null && ebitda !== null && ebitda > 0) {
    value.evEbitda = ev / ebitda;
  }
  if (value.evSales === null && ev !== null && ttmRev && ttmRev > 0) {
    value.evSales = ev / ttmRev;
  }
  if (value.pe === null && mcap !== null && ttmNi !== null && ttmNi > 0) {
    value.pe = mcap / ttmNi;
  }
  if (value.ps === null && mcap !== null && ttmRev && ttmRev > 0) {
    value.ps = mcap / ttmRev;
  }
  if (value.pb === null && mcap !== null && last?.equity && last.equity > 0) {
    value.pb = mcap / last.equity;
  }
  if (value.fcfYield === null && ev !== null && ev > 0 && ttmFcf !== null) {
    value.fcfYield = (ttmFcf / ev) * 100;
  }

  // Price and universe fields always populate; the fundamentals are what a
  // throttled fetch loses, so that is what decides whether this row is final.
  const provisional = periods.length === 0 && metrics === null;
  cache.set(u.symbol, { at: Date.now(), value, provisional });
  return value;
}

export const cachedRow = (symbol: string): Row | null | undefined => {
  const e = cache.get(symbol);
  return e && fresh(e) ? e.value : undefined;
};

export const hasRow = (symbol: string): boolean => {
  const e = cache.get(symbol);
  return e !== undefined && fresh(e);
};
export const rowCacheSize = (): number => cache.size();
