import "server-only";
import { eodhdGet, eodhdNum } from "./client";
import { diskCache } from "@/lib/server/disk-cache";

/**
 * Screener V2 ingest (master spec §29).
 *
 * Architecture: EODHD /screener → background/lazy ingest → normalized rows on
 * disk → instant in-process filtering. User filter changes never hit EODHD.
 *
 * The EODHD screener returns coarse fields (verified live): code, name,
 * exchange, market_capitalization, earnings_share, dividend_yield, sector,
 * industry, adjusted_close, refund_*_p (returns), avgvol. Deep metrics come
 * from `getCompanySnapshot` for symbols the user actually opens; the table
 * carries what a first-pass screen needs.
 */

export interface ScreenerRow {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  price: number | null;
  epsTtm: number | null;
  peTtm: number | null; // derived price/eps when both present and eps>0
  dividendYield: number | null;
  return1dPct: number | null;
  return5dPct: number | null;
  avgVol200d: number | null;
  fetchedAt: string;
}

interface RawRow {
  code: string;
  name?: string;
  exchange?: string;
  sector?: string;
  industry?: string;
  market_capitalization?: number;
  adjusted_close?: number;
  earnings_share?: number;
  dividend_yield?: number;
  refund_1d_p?: number;
  refund_5d_p?: number;
  avgvol_200d?: number;
}

const store = diskCache<ScreenerRow[]>("eodhd-screener", 24 * 60 * 60_000);
const KEY = "us-universe";

async function fetchPage(
  offset: number,
  limit: number,
  mcapMin: number,
  mcapMax: number | null,
): Promise<RawRow[]> {
  const filters: Array<[string, string, number | string]> = [
    ["market_capitalization", ">", mcapMin],
    ["exchange", "=", "us"],
  ];
  if (mcapMax !== null) filters.push(["market_capitalization", "<=", mcapMax]);
  const res = await eodhdGet<{ data?: RawRow[] }>("/screener", {
    filters: JSON.stringify(filters),
    sort: "market_capitalization.desc",
    limit: String(limit),
    offset: String(offset),
  });
  return res.data ?? [];
}

/**
 * EODHD's screener caps offset around 1,000, so a single query cannot list a
 * ~6,000-name universe. Partition by market-cap bands (each well under the
 * cap) and union the pages. Bands verified against live counts.
 */
const MCAP_BANDS: Array<[number, number | null]> = [
  [100e9, null],
  [30e9, 100e9],
  [10e9, 30e9],
  [5e9, 10e9],
  [2e9, 5e9],
  [1e9, 2e9],
  [500e6, 1e9],
  [250e6, 500e6],
];

function normalizeRow(r: RawRow): ScreenerRow {
  const price = eodhdNum(r.adjusted_close);
  const eps = eodhdNum(r.earnings_share);
  return {
    symbol: r.code,
    name: r.name ?? null,
    sector: r.sector ?? null,
    industry: r.industry ?? null,
    marketCap: eodhdNum(r.market_capitalization),
    price,
    epsTtm: eps,
    peTtm: price !== null && eps !== null && eps > 0 ? Number((price / eps).toFixed(2)) : null,
    dividendYield: eodhdNum(r.dividend_yield),
    return1dPct: eodhdNum(r.refund_1d_p),
    return5dPct: eodhdNum(r.refund_5d_p),
    avgVol200d: eodhdNum(r.avgvol_200d),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * The US large/mid-cap universe (>$2B), ~1500 rows, refreshed at most daily.
 * Serves stale data while a refresh is due rather than blocking the screener.
 */
export async function getScreenerUniverse(maxRows = 8000): Promise<ScreenerRow[]> {
  const cached = store.get(KEY);
  if (cached && !store.isStale(KEY)) return cached;

  const pages: RawRow[] = [];
  const pageSize = 100; // EODHD caps screener page size
  const maxOffsetPerBand = 900; // provider offset cap
  for (const [lo, hi] of MCAP_BANDS) {
    for (let offset = 0; offset <= maxOffsetPerBand; offset += pageSize) {
      try {
        const page = await fetchPage(offset, pageSize, lo, hi);
        pages.push(...page);
        if (page.length < pageSize) break;
      } catch {
        break; // keep what this band already yielded; move to next band
      }
    }
    if (pages.length >= maxRows) break;
  }
  // Union may contain duplicates on band edges; last write wins by symbol.
  const bySymbol = new Map<string, RawRow>();
  for (const r of pages) if (r.code) bySymbol.set(r.code, r);
  const rows = [...bySymbol.values()]
    .map(normalizeRow)
    .filter((r) => r.symbol && r.marketCap !== null)
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
    .slice(0, maxRows);
  if (rows.length > 0) {
    store.set(KEY, rows);
    store.flushNow();
    return rows;
  }
  return cached ?? [];
}

// ------------------------------------------------------------ query filtering

export interface ScreenerQuery {
  sectors?: string[];
  minMarketCap?: number;
  maxPe?: number;
  minPe?: number;
  minDividendYield?: number;
  text?: string;
  limit?: number;
}

export function filterUniverse(rows: ScreenerRow[], q: ScreenerQuery): ScreenerRow[] {
  let out = rows;
  if (q.sectors?.length) {
    const set = new Set(q.sectors.map((s) => s.toLowerCase()));
    out = out.filter((r) => r.sector && set.has(r.sector.toLowerCase()));
  }
  if (q.minMarketCap !== undefined) out = out.filter((r) => (r.marketCap ?? 0) >= q.minMarketCap!);
  if (q.maxPe !== undefined) out = out.filter((r) => r.peTtm !== null && r.peTtm <= q.maxPe!);
  if (q.minPe !== undefined) out = out.filter((r) => r.peTtm !== null && r.peTtm >= q.minPe!);
  if (q.minDividendYield !== undefined)
    out = out.filter((r) => (r.dividendYield ?? 0) >= q.minDividendYield!);
  if (q.text) {
    const t = q.text.toLowerCase();
    out = out.filter(
      (r) => r.symbol.toLowerCase().includes(t) || (r.name ?? "").toLowerCase().includes(t),
    );
  }
  return out.slice(0, q.limit ?? 100);
}
