import { NextResponse } from "next/server";
import "@/lib/providers/register";
import { getHistoricalPrices } from "@/lib/providers";
import { aggregateStats, backtestSetups, type SetupOutcome } from "@/lib/engines/backtest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * QUANT BACKTEST — the app's own no-lookahead engine over 1–5 symbols.
 *
 * Method (stated, not implied): detector sees candles.slice(0, i+1) only;
 * entries fill at the NEXT bar's open; when stop and target sit inside the
 * same bar the STOP counts first (worst case); positions never overlap.
 * Setups below the minimum sample stay INSUFFICIENT_DATA — never a verdict
 * from thin evidence.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("symbols") ?? "";
  const symbols = [...new Set(raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 5);
  if (!symbols.length) return NextResponse.json({ error: "symbols required" }, { status: 400 });

  const perSymbol: Array<{ symbol: string; outcomes: number; bars: number }> = [];
  const all: SetupOutcome[] = [];
  for (const symbol of symbols) {
    try {
      const h = await getHistoricalPrices(symbol, 1300);
      if (h.candles.length < 300) {
        perSymbol.push({ symbol, outcomes: 0, bars: h.candles.length });
        continue;
      }
      const out = backtestSetups(symbol, h.candles, { stride: 3, horizon: 40 }).map((o) => ({ ...o, symbol } as SetupOutcome & { symbol: string }));
      all.push(...out);
      perSymbol.push({ symbol, outcomes: out.length, bars: h.candles.length });
    } catch {
      perSymbol.push({ symbol, outcomes: 0, bars: 0 });
    }
  }

  const stats = aggregateStats(all);

  // Simple sequential equity curve: outcomes in entry order, cumulative sum of
  // per-trade returns (equal-weight, non-compounded — stated on the page).
  const ordered = [...all].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  let acc = 0;
  const equity = ordered.map((o) => {
    acc += o.returnPct;
    return { date: o.entryDate, cum: Number(acc.toFixed(2)) };
  });

  const trades = ordered.slice(-25).reverse().map((o) => ({
    symbol: (o as SetupOutcome & { symbol?: string }).symbol ?? symbols[0],
    setup: o.setup,
    entryDate: o.entryDate,
    entryPrice: o.entryPrice,
    stopPrice: o.stopPrice,
    targetPrice: o.targetPrice,
    exit: o.exit,
    exitDate: o.exitDate,
    barsHeld: o.barsHeld,
    returnPct: Number(o.returnPct.toFixed(2)),
    mfePct: Number(o.mfePct.toFixed(2)),
    maePct: Number(o.maePct.toFixed(2)),
  }));

  return NextResponse.json({ symbols, perSymbol, totalOutcomes: all.length, stats, equity, trades });
}
