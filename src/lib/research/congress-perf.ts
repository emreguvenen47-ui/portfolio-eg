import "server-only";
import { getHistoricalPrices } from "@/lib/providers";
import { diskCache } from "@/lib/server/disk-cache";
import type { CongressTrade } from "./alt-data";

/**
 * MEMBER PERFORMANCE — how each member's DISCLOSED BUYS have done since the
 * trade date, versus the S&P 500 over the exact same window.
 *
 * Honesty rules: only BUY filings are scored (sale sizing is a range, so
 * portfolio P&L is unknowable); returns start at the first close ON/AFTER the
 * transaction date; every member needs ≥ MIN_SAMPLE scored buys or shows
 * nothing; excess = ticker return − SPY return over the identical window.
 * "Filed purchases" lists what they bought per the filings — a disclosure
 * trail, NOT a portfolio statement.
 */

export interface FiledPurchase {
  ticker: string;
  company: string | null;
  transactionDate: string;
  valueLow: number | null;
  valueHigh: number | null;
  returnSincePct: number | null;
  excessVsSpyPct: number | null;
  sourceUrl: string | null;
  soldLater: boolean; // a later SELL filing exists for the same ticker
}

export interface MemberPerf {
  politician: string;
  chamber: string;
  state: string | null;
  buys: number;
  scored: number;
  hitRateVsSpy: number | null; // share of buys beating SPY
  medianExcessPct: number | null;
  avgExcessPct: number | null;
  best: { ticker: string; excessPct: number } | null;
  worst: { ticker: string; excessPct: number } | null;
  purchases: FiledPurchase[];
}

export const PERF_MIN_SAMPLE = 3;

const store = diskCache<{ at: string; ledgerStamp: string; members: MemberPerf[] }>(
  "congress-member-perf",
  6 * 60 * 60_000,
);
const KEY = "perf";

const median = (xs: number[]): number | null => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Close on/after a date, and the latest close, from a candle series. */
function window(candles: Array<{ date: string; close: number }>, fromDate: string): [number, number] | null {
  const start = candles.find((c) => c.date >= fromDate);
  const last = candles[candles.length - 1];
  if (!start || !last || start.close <= 0) return null;
  if (start.date === last.date) return null; // trade too recent to score
  return [start.close, last.close];
}

export async function buildMemberPerformance(rows: CongressTrade[]): Promise<MemberPerf[]> {
  const ledgerStamp = `${rows.length}:${rows[0]?.disclosureDate ?? ""}`;
  const cached = store.get(KEY);
  if (cached && cached.ledgerStamp === ledgerStamp && !store.isStale(KEY)) return cached.members;

  const buys = rows.filter((r) => r.side === "BUY" && r.ticker && r.transactionDate);
  const tickers = [...new Set(buys.map((r) => r.ticker))].slice(0, 60);

  // Candle series: SPY benchmark + each bought ticker (provider-cached).
  const seriesByTicker = new Map<string, Array<{ date: string; close: number }>>();
  const spy = await getHistoricalPrices("SPY", 400).catch(() => ({ candles: [] }));
  for (const t of tickers) {
    const h = await getHistoricalPrices(t, 400).catch(() => ({ candles: [] }));
    if (h.candles.length >= 30) seriesByTicker.set(t, h.candles);
  }

  const soldTickersByMember = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.side === "SELL") {
      const set = soldTickersByMember.get(r.politician) ?? new Set<string>();
      set.add(r.ticker);
      soldTickersByMember.set(r.politician, set);
    }
  }

  const byMember = new Map<string, CongressTrade[]>();
  for (const r of buys) {
    const g = byMember.get(r.politician) ?? [];
    g.push(r);
    byMember.set(r.politician, g);
  }

  const members: MemberPerf[] = [];
  for (const [politician, trades] of byMember) {
    const purchases: FiledPurchase[] = trades
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate))
      .map((t) => {
        const series = seriesByTicker.get(t.ticker);
        const w = series ? window(series, t.transactionDate) : null;
        const ws = w ? window(spy.candles, t.transactionDate) : null;
        const ret = w ? (w[1] / w[0] - 1) * 100 : null;
        const spyRet = ws ? (ws[1] / ws[0] - 1) * 100 : null;
        return {
          ticker: t.ticker,
          company: t.company ?? null,
          transactionDate: t.transactionDate,
          valueLow: t.valueLow,
          valueHigh: t.valueHigh,
          returnSincePct: ret !== null ? Number(ret.toFixed(1)) : null,
          excessVsSpyPct: ret !== null && spyRet !== null ? Number((ret - spyRet).toFixed(1)) : null,
          sourceUrl: t.sourceUrl ?? null,
          soldLater: soldTickersByMember.get(politician)?.has(t.ticker) ?? false,
        };
      });

    const scoredList = purchases.filter((p) => p.excessVsSpyPct !== null);
    const excess = scoredList.map((p) => p.excessVsSpyPct!) ;
    const sortedByExcess = [...scoredList].sort((a, b) => b.excessVsSpyPct! - a.excessVsSpyPct!);
    members.push({
      politician,
      chamber: trades[0]!.chamber,
      state: trades[0]!.state ?? null,
      buys: trades.length,
      scored: scoredList.length,
      hitRateVsSpy: scoredList.length ? Number((scoredList.filter((p) => p.excessVsSpyPct! > 0).length / scoredList.length).toFixed(2)) : null,
      medianExcessPct: median(excess) !== null ? Number(median(excess)!.toFixed(1)) : null,
      avgExcessPct: excess.length ? Number((excess.reduce((a, b) => a + b, 0) / excess.length).toFixed(1)) : null,
      best: sortedByExcess[0] ? { ticker: sortedByExcess[0].ticker, excessPct: sortedByExcess[0].excessVsSpyPct! } : null,
      worst: sortedByExcess.at(-1) ? { ticker: sortedByExcess.at(-1)!.ticker, excessPct: sortedByExcess.at(-1)!.excessVsSpyPct! } : null,
      purchases,
    });
  }

  members.sort((a, b) => (b.medianExcessPct ?? -999) - (a.medianExcessPct ?? -999));
  store.set(KEY, { at: new Date().toISOString(), ledgerStamp, members });
  store.flushNow();
  return members;
}
