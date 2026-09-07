import "server-only";
import { getHistoricalPrices } from "@/lib/providers";
import { diskCache } from "@/lib/server/disk-cache";
import { computePositionReturn, firstSellAfter } from "./congress-returns";
import type { CongressTrade } from "./alt-data";

/**
 * MEMBER PERFORMANCE over the DEEP ledger (14y archive + live feed).
 *
 * Scoring, stated honestly:
 *  - Only BUY filings are scored (sale sizes are ranges; portfolio P&L is
 *    unknowable from disclosures).
 *  - Each BUY is matched to the EARLIEST later SELL of the same ticker by the
 *    same member, if one exists (a full, realized holding-period return); if
 *    none exists, it is scored HELD from the buy date to today's close. NO
 *    fixed horizon — a name bought years ago and still held compounds fully,
 *    which is why this reads much higher than a truncated-window metric.
 *  - Scoring window: buys from the last SCORING_YEARS (candle-budget bound).
 *    Older archive rows still show in the disclosure history; they are
 *    outside the scoring window and are not ranked.
 *  - Candle budget: the ~250 most-traded tickers across the whole ledger;
 *    buys outside that set are listed but unscored. Members need
 *    ≥PERF_MIN_SAMPLE scored buys to be ranked at all.
 *
 * The first computation walks ~250 candle series (minutes, provider-paced),
 * so it runs in the BACKGROUND: callers get {computing:true} until the disk
 * cache fills, then a 12h freshness window.
 */

export interface FiledPurchase {
  ticker: string;
  company: string | null;
  transactionDate: string;
  valueLow: number | null;
  valueHigh: number | null;
  status: "HELD" | "SOLD" | null; // null = unscored (candle budget miss)
  exitDate: string | null;
  entryPrice: number | null;
  exitOrCurrentPrice: number | null;
  returnPct: number | null; // full holding-period return, entry → exit/now
  excessVsSpyPct: number | null;
  sourceUrl: string | null;
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
const SCORING_YEARS = 8;
const CANDLE_BARS = 2200; // ~8.7 trading years
const TICKER_CAP = 250;

interface PerfCache {
  at: string;
  ledgerStamp: string;
  members: MemberPerf[];
  scoredTrades: number;
  windowFrom: string;
}

const store = diskCache<PerfCache>("congress-member-perf-v3", 12 * 60 * 60_000);
const KEY = "perf";
const FLIGHT = Symbol.for("pcc.congress.perf.flight");
const g = globalThis as unknown as Record<symbol, boolean | undefined>;

const median = (xs: number[]): number | null => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

async function compute(rows: CongressTrade[], ledgerStamp: string): Promise<void> {
  const windowFrom = new Date(Date.now() - SCORING_YEARS * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const buys = rows.filter((r) => r.side === "BUY" && r.ticker && r.transactionDate >= windowFrom);

  // Candle budget goes to the most-traded tickers across the whole ledger.
  const freq = new Map<string, number>();
  for (const b of buys) freq.set(b.ticker, (freq.get(b.ticker) ?? 0) + 1);
  const tickers = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, TICKER_CAP).map(([t]) => t);
  const tickerSet = new Set(tickers);

  const fetchSeries = async (sym: string) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const h = await getHistoricalPrices(sym, CANDLE_BARS);
        if (h.candles.length >= 60) return h.candles;
      } catch {
        /* retry once — a transient fetch failure must not zero the run */
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

  // Sell dates per (politician, ticker), for matching each buy to its exit.
  const sellsByKey = new Map<string, string[]>();
  for (const r of rows) {
    if (r.side !== "SELL") continue;
    const k = `${r.politician}|${r.ticker}`;
    const arr = sellsByKey.get(k) ?? [];
    arr.push(r.transactionDate);
    sellsByKey.set(k, arr);
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
        let result: ReturnType<typeof computePositionReturn> = null;
        if (series && spy.length) {
          const sellDates = sellsByKey.get(`${politician}|${t.ticker}`) ?? [];
          const exit = firstSellAfter(sellDates, t.transactionDate);
          result = computePositionReturn(t.transactionDate, series, spy, exit);
        }
        return {
          ticker: t.ticker,
          company: t.company ?? null,
          transactionDate: t.transactionDate,
          valueLow: t.valueLow,
          valueHigh: t.valueHigh,
          status: result?.status ?? null,
          exitDate: result?.exitDate ?? null,
          entryPrice: result?.entryPrice ?? null,
          exitOrCurrentPrice: result ? (result.exitPrice ?? result.currentPrice) : null,
          returnPct: result?.returnPct ?? null,
          excessVsSpyPct: result?.excessVsSpyPct ?? null,
          sourceUrl: t.sourceUrl ?? null,
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
      purchases: purchases.slice(0, 60),
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
