import "server-only";
import { eodhdGet, eodhdNum } from "./eodhd/client";
import { diskCache } from "@/lib/server/disk-cache";

/**
 * GLOBAL FX BOARD — the major pairs with 90-day tracks, straight from the
 * EODHD FOREX EOD series (the same source the gold/silver spot strip uses).
 * One EOD call per pair, disk-cached 6h: FX closes move daily, not per view.
 */

export interface FxRow {
  pair: string; // "EUR/USD"
  code: string; // EURUSD.FOREX
  alias: string; // EURUSD → /chart/EURUSD
  last: number | null;
  chg1dPct: number | null;
  chg1mPct: number | null;
  chgYtdPct: number | null;
  /** ~90 daily closes, oldest→newest, for the sparkline. */
  spark: number[];
  decimals: number;
}

export const FX_PAIRS: Array<{ pair: string; alias: string; decimals: number }> = [
  { pair: "EUR/USD", alias: "EURUSD", decimals: 4 },
  { pair: "GBP/USD", alias: "GBPUSD", decimals: 4 },
  { pair: "USD/JPY", alias: "USDJPY", decimals: 2 },
  { pair: "USD/TRY", alias: "USDTRY", decimals: 2 },
  { pair: "EUR/TRY", alias: "EURTRY", decimals: 2 },
  { pair: "GBP/TRY", alias: "GBPTRY", decimals: 2 },
  { pair: "USD/CHF", alias: "USDCHF", decimals: 4 },
  { pair: "AUD/USD", alias: "AUDUSD", decimals: 4 },
  { pair: "NZD/USD", alias: "NZDUSD", decimals: 4 },
  { pair: "USD/CAD", alias: "USDCAD", decimals: 4 },
  { pair: "USD/CNY", alias: "USDCNY", decimals: 4 },
  { pair: "USD/MXN", alias: "USDMXN", decimals: 3 },
  { pair: "USD/INR", alias: "USDINR", decimals: 2 },
  { pair: "USD/SEK", alias: "USDSEK", decimals: 3 },
];

const store = diskCache<FxRow>("fx-board", 6 * 60 * 60_000);

async function fetchPair(p: (typeof FX_PAIRS)[number]): Promise<FxRow> {
  const code = `${p.alias}.FOREX`;
  const cached = store.get(p.alias);
  if (cached && !store.isStale(p.alias)) return cached;
  try {
    const rows = await eodhdGet<Array<{ date: string; close: number | string }>>(
      `/eod/${encodeURIComponent(code)}`,
      { order: "d", limit: "260" },
    );
    const series = rows
      .map((r) => ({ date: r.date, close: eodhdNum(r.close) }))
      .filter((r): r is { date: string; close: number } => r.close !== null)
      .reverse(); // oldest → newest
    const last = series.at(-1)?.close ?? null;
    const at = (back: number) => series[series.length - 1 - back]?.close ?? null;
    const yearStart = series.find((r) => r.date >= `${new Date().getUTCFullYear()}-01-01`)?.close ?? null;
    const chg = (ref: number | null) => (last !== null && ref !== null && ref > 0 ? (last / ref - 1) * 100 : null);
    const row: FxRow = {
      pair: p.pair,
      code,
      alias: p.alias,
      last,
      chg1dPct: chg(at(1)),
      chg1mPct: chg(at(21)),
      chgYtdPct: chg(yearStart),
      spark: series.slice(-90).map((r) => r.close),
      decimals: p.decimals,
    };
    store.set(p.alias, row);
    return row;
  } catch {
    return (
      cached ?? { pair: p.pair, code, alias: p.alias, last: null, chg1dPct: null, chg1mPct: null, chgYtdPct: null, spark: [], decimals: p.decimals }
    );
  }
}

export async function getFxBoard(): Promise<FxRow[]> {
  // Sequential-ish with small fan-out to respect the per-minute limit.
  const out: FxRow[] = [];
  for (let i = 0; i < FX_PAIRS.length; i += 4) {
    const batch = await Promise.all(FX_PAIRS.slice(i, i + 4).map(fetchPair));
    out.push(...batch);
  }
  return out;
}
