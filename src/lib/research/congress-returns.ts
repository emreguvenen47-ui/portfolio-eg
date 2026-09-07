import "server-only";

/**
 * POSITION RETURN — the actual question a reader asks: "if I'd copied this
 * buy, what would I have made?" Answered honestly:
 *   - If a LATER SELL filing exists for the same ticker → return from the
 *     first close on/after the BUY date to the first close on/after the
 *     SELL date. Status SOLD.
 *   - Otherwise → return from the BUY date to the latest available close.
 *     Status HELD (still open as of today).
 * No fixed horizon, no truncation — a 2021 buy still held today scores its
 * full multi-year run. Excess is the identical window on the S&P 500.
 */

export interface Candle {
  date: string;
  close: number;
}

export interface PositionReturn {
  entryDate: string;
  entryPrice: number;
  exitDate: string | null; // null = still held
  exitPrice: number | null; // null = still held
  currentPrice: number | null; // set when still held
  status: "HELD" | "SOLD";
  returnPct: number;
  spyReturnPct: number | null;
  excessVsSpyPct: number | null;
  daysHeld: number;
}

export function computePositionReturn(
  buyDate: string,
  series: Candle[],
  spySeries: Candle[],
  sellDateAfter: string | null,
): PositionReturn | null {
  const i0 = series.findIndex((c) => c.date >= buyDate);
  if (i0 < 0 || series[i0]!.close <= 0) return null;
  const entryDate = series[i0]!.date;
  const entryPrice = series[i0]!.close;

  let exitIdx = series.length - 1;
  let status: "HELD" | "SOLD" = "HELD";
  if (sellDateAfter) {
    const iSell = series.findIndex((c) => c.date >= sellDateAfter);
    if (iSell > i0) {
      exitIdx = iSell;
      status = "SOLD";
    }
  }
  if (exitIdx <= i0) return null;
  const exitDateActual = series[exitIdx]!.date;
  const exitPrice = series[exitIdx]!.close;
  const returnPct = (exitPrice / entryPrice - 1) * 100;

  let spyReturnPct: number | null = null;
  const s0 = spySeries.findIndex((c) => c.date >= entryDate);
  if (s0 >= 0 && spySeries[s0]!.close > 0) {
    const sExitIdx0 = spySeries.findIndex((c) => c.date >= exitDateActual);
    const sExit = sExitIdx0 >= 0 ? sExitIdx0 : spySeries.length - 1;
    if (sExit > s0) spyReturnPct = (spySeries[sExit]!.close / spySeries[s0]!.close - 1) * 100;
  }

  return {
    entryDate,
    entryPrice: Number(entryPrice.toFixed(2)),
    exitDate: status === "SOLD" ? exitDateActual : null,
    exitPrice: status === "SOLD" ? Number(exitPrice.toFixed(2)) : null,
    currentPrice: status === "HELD" ? Number(exitPrice.toFixed(2)) : null,
    status,
    returnPct: Number(returnPct.toFixed(1)),
    spyReturnPct: spyReturnPct !== null ? Number(spyReturnPct.toFixed(1)) : null,
    excessVsSpyPct: spyReturnPct !== null ? Number((returnPct - spyReturnPct).toFixed(1)) : null,
    daysHeld: Math.round((Date.parse(exitDateActual) - Date.parse(entryDate)) / 86_400_000),
  };
}

/** Earliest SELL transaction date after `afterDate` for one ticker, or null. */
export function firstSellAfter(sellDates: string[], afterDate: string): string | null {
  const later = sellDates.filter((d) => d > afterDate).sort();
  return later[0] ?? null;
}
