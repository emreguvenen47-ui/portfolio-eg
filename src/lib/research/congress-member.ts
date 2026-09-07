import "server-only";
import { getHistoricalPrices } from "@/lib/providers";
import { diskCache } from "@/lib/server/disk-cache";
import { getAllCongressRows } from "./congress-archive";
import { getMemberPerformance, type MemberPerf } from "./congress-perf";
import { computePositionReturn, firstSellAfter } from "./congress-returns";
import { withLag, type CongressRow } from "./congress";
import type { CongressTrade } from "./alt-data";

/**
 * MEMBER PROFILE — one politician's full disclosure history, "what office
 * they hold" stated plainly, and a deterministic REAL-PRICE read of what
 * they likely still hold and what it has actually returned: each BUY is
 * matched to the earliest later SELL of the same ticker (a realized
 * holding-period return) or, absent one, priced from the buy date to today
 * (an unrealized, still-held return). This is a disclosure trail, not a
 * verified portfolio — every row says so.
 */

export interface HoldingEstimate {
  ticker: string;
  company: string | null;
  status: "LIKELY HELD" | "LIKELY EXITED" | "UNPRICED";
  entryDate: string | null;
  entryPrice: number | null;
  exitDate: string | null;
  exitOrCurrentPrice: number | null;
  returnPct: number | null;
  excessVsSpyPct: number | null;
  totalBuys: number;
  totalSells: number;
  sourceUrl: string | null;
}

export interface MemberProfile {
  politician: string;
  chamber: "House" | "Senate";
  state: string | null;
  office: string; // "Senator for California" / "Representative for NJ"
  rows: CongressRow[]; // full history, newest first
  perf: MemberPerf | null;
  holdings: HoldingEstimate[]; // best-performing-first
  firstFiling: string | null;
  lastFiling: string | null;
}

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

function officeOf(chamber: string, state: string | null): string {
  const stateName = state ? (STATE_NAMES[state] ?? state) : null;
  if (chamber === "Senate") return stateName ? `U.S. Senator for ${stateName}` : "U.S. Senator";
  return stateName ? `U.S. Representative for ${stateName}` : "U.S. Representative";
}

const MAX_TICKERS = 80;
const holdingsCache = diskCache<HoldingEstimate[]>("congress-member-holdings", 12 * 60 * 60_000);

/** Real per-ticker returns for one member's own bought tickers (on demand). */
async function buildHoldings(politician: string, rows: CongressRow[]): Promise<HoldingEstimate[]> {
  const cacheKey = `${politician}:${rows.length}`;
  const cached = holdingsCache.get(cacheKey);
  if (cached && !holdingsCache.isStale(cacheKey)) return cached;

  const byTicker = new Map<string, CongressRow[]>();
  for (const r of rows) {
    const g = byTicker.get(r.ticker) ?? [];
    g.push(r);
    byTicker.set(r.ticker, g);
  }
  // Prioritize tickers with the most recent activity — most relevant first.
  const tickers = [...byTicker.entries()]
    .sort((a, b) => b[1][0]!.transactionDate.localeCompare(a[1][0]!.transactionDate))
    .slice(0, MAX_TICKERS);

  const spy = await getHistoricalPrices("SPY", 2200).catch(() => ({ candles: [] }));
  const out: HoldingEstimate[] = [];
  for (const [ticker, txs] of tickers) {
    const buysSorted = txs.filter((t) => t.side === "BUY").sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
    const sells = txs.filter((t) => t.side === "SELL").map((t) => t.transactionDate);
    const lastBuy = buysSorted.at(-1) ?? null;
    if (!lastBuy) {
      // Ticker with only SELL filings (a prior holding never disclosed as a buy).
      out.push({
        ticker,
        company: txs[0]!.company ?? null,
        status: "LIKELY EXITED",
        entryDate: null,
        entryPrice: null,
        exitDate: txs.find((t) => t.side === "SELL")?.transactionDate ?? null,
        exitOrCurrentPrice: null,
        returnPct: null,
        excessVsSpyPct: null,
        totalBuys: 0,
        totalSells: sells.length,
        sourceUrl: txs.find((t) => t.side === "SELL")?.sourceUrl ?? null,
      });
      continue;
    }
    const h = await getHistoricalPrices(ticker, 2200).catch(() => ({ candles: [] }));
    const exit = firstSellAfter(sells, lastBuy.transactionDate);
    const result = h.candles.length >= 60 && spy.candles.length
      ? computePositionReturn(lastBuy.transactionDate, h.candles, spy.candles, exit)
      : null;
    out.push({
      ticker,
      company: lastBuy.company ?? null,
      status: result ? (result.status === "HELD" ? "LIKELY HELD" : "LIKELY EXITED") : "UNPRICED",
      entryDate: result?.entryDate ?? lastBuy.transactionDate,
      entryPrice: result?.entryPrice ?? null,
      exitDate: result?.exitDate ?? null,
      exitOrCurrentPrice: result ? (result.exitPrice ?? result.currentPrice) : null,
      returnPct: result?.returnPct ?? null,
      excessVsSpyPct: result?.excessVsSpyPct ?? null,
      totalBuys: buysSorted.length,
      totalSells: sells.length,
      sourceUrl: (exit ? txs.find((t) => t.side === "SELL" && t.transactionDate === exit)?.sourceUrl : lastBuy.sourceUrl) ?? null,
    });
    await new Promise((r) => setTimeout(r, 90)); // provider-friendly pacing
  }

  out.sort((a, b) => {
    if (a.status === "UNPRICED") return 1;
    if (b.status === "UNPRICED") return -1;
    return (b.returnPct ?? -999) - (a.returnPct ?? -999);
  });
  holdingsCache.set(cacheKey, out);
  holdingsCache.flushNow();
  return out;
}

export async function getMemberProfile(politicianExact: string): Promise<MemberProfile | null> {
  const all = await getAllCongressRows();
  const target = politicianExact.trim().toLowerCase();
  const mine: CongressTrade[] = all.filter((r) => r.politician.trim().toLowerCase() === target);
  if (mine.length === 0) return null;

  const rows = mine.map(withLag).sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
  const chamber = (rows[0]!.chamber as "House" | "Senate") ?? "House";
  const state = rows.find((r) => r.state)?.state ?? null;

  const holdings = await buildHoldings(rows[0]!.politician, rows);

  // Reuse the deep performance ranking (already computed against the full ledger).
  const perfResult = getMemberPerformance(all);
  const perf = perfResult.members.find((m) => m.politician.trim().toLowerCase() === target) ?? null;

  return {
    politician: rows[0]!.politician,
    chamber,
    state,
    office: officeOf(chamber, state),
    rows,
    perf,
    holdings,
    firstFiling: rows.at(-1)?.transactionDate ?? null,
    lastFiling: rows[0]?.transactionDate ?? null,
  };
}

/** All politicians in the ledger, for the directory/search list. */
export async function getAllMembers(): Promise<
  Array<{ politician: string; chamber: string; state: string | null; filings: number; buys: number; sells: number; lastFiling: string }>
> {
  const all = await getAllCongressRows();
  const byName = new Map<string, CongressTrade[]>();
  for (const r of all) {
    const g = byName.get(r.politician) ?? [];
    g.push(r);
    byName.set(r.politician, g);
  }
  return [...byName.entries()]
    .map(([politician, rows]) => ({
      politician,
      chamber: rows[0]!.chamber,
      state: rows.find((r) => r.state)?.state ?? null,
      filings: rows.length,
      buys: rows.filter((r) => r.side === "BUY").length,
      sells: rows.filter((r) => r.side === "SELL").length,
      lastFiling: rows.reduce((max, r) => (r.transactionDate > max ? r.transactionDate : max), rows[0]!.transactionDate),
    }))
    .sort((a, b) => b.filings - a.filings);
}
