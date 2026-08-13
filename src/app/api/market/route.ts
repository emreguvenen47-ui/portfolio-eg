import { NextResponse } from "next/server";
import { aggregateStatus, getProviderHealth, getQuotes, quoteTtlMs } from "@/lib/providers";
import { isSymbolMarketOpen, venueFor } from "@/lib/providers/market-hours";
import { MARKET_INSTRUMENTS } from "@/lib/portfolio/config";
import { loadPortfolioForCaller } from "@/lib/server/user-portfolio";

export const dynamic = "force-dynamic";

/**
 * The one market-data endpoint every client component should read.
 *
 * Components used to each poll their own slice, which meant several
 * independent cadences over the same shared provider cache. Pointing them at a
 * single payload keeps one refresh clock for the whole app and makes the
 * per-symbol provenance (provider, market timestamp, status) available
 * everywhere without another round trip.
 *
 * Quotes only. Historical candles live on a six-hour cache and are NOT
 * refreshed here — dragging 800 daily bars per symbol along with a two-minute
 * quote tick would be the most expensive thing the app does.
 */
export async function GET() {
  let positionSymbols: string[] = [];
  try {
    const portfolio = await loadPortfolioForCaller();
    positionSymbols = portfolio.positions
      .map((p) => p.symbol)
      .filter((s): s is string => Boolean(s));
  } catch {
    // A missing workbook still leaves the market monitor worth serving.
  }

  const symbols = [
    ...new Set([...positionSymbols, ...MARKET_INSTRUMENTS.map((m) => m.symbol)]),
  ];

  const quotes = await getQuotes(symbols);

  // Symbols no provider could price. Reported explicitly so the UI can render
  // UNAVAILABLE instead of quietly dropping a row.
  const unavailable = symbols.filter((s) => !quotes[s]);

  return NextResponse.json({
    quotes,
    unavailable,
    status: aggregateStatus(Object.values(quotes)),
    feed: getProviderHealth().feed,
    venues: Object.fromEntries(
      symbols.map((s) => [s, { venue: venueFor(s), open: isSymbolMarketOpen(s) }]),
    ),
    refreshMs: quoteTtlMs(),
    updatedAt: new Date().toISOString(),
  });
}
