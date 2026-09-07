import "server-only";
import { getHistoricalPrices } from "@/lib/providers";
import { diskCache } from "@/lib/server/disk-cache";
import type { CongressTrade } from "./alt-data";

/**
 * MEMBER PERFORMANCE over the DEEP ledger (12y archive + live feed).
 *
 * Scoring, stated honestly:
 *  - Only BUY filings are scored (sale sizes are ranges; portfolio P&L is
 *    unknowable from disclosures).
 *  - Window: trades from the last ~5 years (the candle budget — 1300 daily
 *    bars per ticker — reaches exactly that far). Older archive rows still
 *    show in the ledger; they are outside the scoring window and say so.
 *  - Metric: excess return vs the S&P 500 over a FIXED 6-month horizon from
 *    the first close on/after the trade date (comparable across years).
 *    Trades younger than 6 months score to-date instead and are flagged.
 *  - Candle budget: the ~250 most-traded tickers; buys outside that set are
 *    listed but unscored. Members need ≥5 scored buys to be ranked at all.
 *
 * The first computation walks ~250 candle series (minutes, provider-paced),
 * so it runs in the BACKGROUND: callers get {computing:true} until the disk
 * cache fills, then 12h freshness.
 */

export interface FiledPurchase {
  ticker: string;
  company: string | null;
  transactionDate: string;
  valueLow: number | null;
  valueHigh: number | null;
  excessVsSpyPct: number | null;
  horizon: "6M" | "TO_DATE" | null;
  sourceUrl: string | null;
  soldLater: boolean;
}

export interface MemberPerf {
  politician: string;
  chamber: string;
  state: string | null;
  buys: number;
  scored: number;
  hitRateVsSpy: number | null;
  medianExcessPct: number | null;
  avgExcessPct: number | null;
  best: { ticker: string; excessPct: number } | null;
  worst: { ticker: string; excessPct: number } | null;
  purchases: FiledPurchase[];
}

export const PERF_MIN_SAMPLE = 5;
const SCORING_YEARS = 5;
const TICKER_CAP = 250;
const HORIZON_DAYS = 126; // ~6 months of sessions

interface PerfCache {
  at: string;
  ledgerStamp: string;
  members: MemberPerf[];
  scoredTrades: number;
  windowFrom: string;
}

const store = diskCache<PerfCache>("congress-member-perf-v2", 12 * 60 * 60_000);
const KEY = "perf";
const FLIGHT = Symbol.for("pcc.congress.perf.flight");
const g = globalThis as unknown as Record<symbol, boolean | undefined>;

const median = (xs: number[]): number | null => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Excess vs SPY from first close on/after txDate over a fixed session count. */
function excessAt(
  series: Array<{ date: string; close: number }>,
  spy: Array<{ date: string; close: number }>,
  txDate: string,
): { excess: number; horizon: "6M" | "TO_DATE" } | null {
  const i0 = series.findIndex((c) => c.date >= txDate);
  if (i0 < 0 || series[i0]!.close <= 0) return null;
  const iH = Math.min(i0 + HORIZON_DAYS, series.length - 1);
  if (iH <= i0) return null;
  const ret = series[iH]!.close / series[i0]!.close - 1;
  const s0 = spy.findIndex((c) => c.date >= series[i0]!.date);
  if (s0 < 0) return null;
  const sH = Math.min(s0 + (iH - i0), spy.length - 1);
  if (sH <= s0 || spy[s0]!.close <= 0) return null;
  const spyRet = spy[sH]!.close / spy[s0]!.close - 1;
  return {
    excess: (ret - spyRet) * 100,
    horizon: iH - i0 >= HORIZON_DAYS ? "6M" : "TO_DATE",
  };
}

async function compute(rows: CongressTrade[], ledgerStamp: string): Promise<void> {
  const windowFrom = new Date(Date.now() - SCORING_YEARS * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const buys = rows.filter((r) => r.side === "BUY" && r.ticker && r.transactionDate >= windowFrom);

  // Candle budget goes to the most-traded tickers.
  const freq = new Map<string, number>();
  for (const b of buys) freq.set(b.ticker, (freq.get(b.ticker) ?? 0) + 1);
  const tickers = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, TICKER_CAP).map(([t]) => t);
  const tickerSet = new Set(tickers);

  const fetchSeries = async (sym: string) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const h = await getHistoricalPrices(sym, 1400);
        if (h.candles.length >= 60) return h.candles;
      } catch {
        /* retry once after a beat — transient fetch failures must not zero the run */
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    return [];
  };
  const spy = await fetchSeries("SPY");
  const seriesByTicker = new Map<string, Array<{ date: string; close: number }>>();
  let fetchFails = 0;
  for (const t of tickers) {
    const candles = await fetchSeries(t);
    if (candles.length) seriesByTicker.set(t, candles);
    else fetchFails++;
    await new Promise((r) => setTimeout(r, 120)); // provider-friendly pacing
  }
  console.log(`[congress-perf] tickers ${tickers.length}, series ok ${seriesByTicker.size}, failed ${fetchFails}, spy bars ${spy.length}`);

  const soldByMember = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.side === "SELL") {
      const set = soldByMember.get(r.politician) ?? new Set<string>();
      set.add(r.ticker);
      soldByMember.set(r.politician, set);
    }
  }

  const byMember = new Map<string, CongressTrade[]>();
  for (const r of buys) {
    const gp = byMember.get(r.politician) ?? [];
    gp.push(r);
    byMember.set(r.politician, gp);
  }

  const members: MemberPerf[] = [];
  for (const [politician, trades] of byMember) {
    const purchases: FiledPurchase[] = trades
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate))
      .map((t) => {
        const series = tickerSet.has(t.ticker) ? seriesByTicker.get(t.ticker) : undefined;
        const ex = series && spy.length ? excessAt(series, spy, t.transactionDate) : null;
        return {
          ticker: t.ticker,
          company: t.company ?? null,
          transactionDate: t.transactionDate,
          valueLow: t.valueLow,
          valueHigh: t.valueHigh,
          excessVsSpyPct: ex ? Number(ex.excess.toFixed(1)) : null,
          horizon: ex?.horizon ?? null,
          sourceUrl: t.sourceUrl ?? null,
          soldLater: soldByMember.get(politician)?.has(t.ticker) ?? false,
        };
      });
    const scoredList = purchases.filter((p) => p.excessVsSpyPct !== null);
    const excess = scoredList.map((p) => p.excessVsSpyPct!);
    const byExcess = [...scoredList].sort((a, b) => b.excessVsSpyPct! - a.excessVsSpyPct!);
    members.push({
      politician,
      chamber: trades[0]!.chamber,
      state: trades[0]!.state ?? null,
      buys: trades.length,
      scored: scoredList.length,
      hitRateVsSpy: scoredList.length ? Number((scoredList.filter((p) => p.excessVsSpyPct! > 0).length / scoredList.length).toFixed(2)) : null,
      medianExcessPct: median(excess) !== null ? Number(median(excess)!.toFixed(1)) : null,
      avgExcessPct: excess.length ? Number((excess.reduce((a, b) => a + b, 0) / excess.length).toFixed(1)) : null,
      best: byExcess[0] ? { ticker: byExcess[0].ticker, excessPct: byExcess[0].excessVsSpyPct! } : null,
      worst: byExcess.at(-1) ? { ticker: byExcess.at(-1)!.ticker, excessPct: byExcess.at(-1)!.excessVsSpyPct! } : null,
      purchases: purchases.slice(0, 40),
    });
  }
  members.sort((a, b) => (b.medianExcessPct ?? -999) - (a.medianExcessPct ?? -999));

  store.set(KEY, {
    at: new Date().toISOString(),
    ledgerStamp,
    members,
    scoredTrades: members.reduce((a, m) => a + m.scored, 0),
    windowFrom,
  });
  store.flushNow();
}

/** Synchronous compute for scripts / admin routes. */
export async function forceCompute(rows: CongressTrade[]): Promise<void> {
  await compute(rows, `${rows.length}`);
}

export interface PerfResult {
  members: MemberPerf[];
  computing: boolean;
  computedAt: string | null;
  scoredTrades: number;
  windowFrom: string | null;
}

/** Non-blocking: cached result now; first/expired computes in the background. */
export function getMemberPerformance(rows: CongressTrade[]): PerfResult {
  const ledgerStamp = `${rows.length}`;
  const cached = store.get(KEY);
  const fresh = cached && !store.isStale(KEY) && cached.ledgerStamp === ledgerStamp;
  if (!fresh && !g[FLIGHT]) {
    g[FLIGHT] = true;
    void compute(rows, ledgerStamp)
      .catch(() => null)
      .finally(() => {
        g[FLIGHT] = false;
      });
  }
  return {
    members: cached?.members ?? [],
    computing: !fresh,
    computedAt: cached?.at ?? null,
    scoredTrades: cached?.scoredTrades ?? 0,
    windowFrom: cached?.windowFrom ?? null,
  };
}
