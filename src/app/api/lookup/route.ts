import { NextResponse } from "next/server";
import { getHistoricalPrices, getQuotes } from "@/lib/providers";

export const dynamic = "force-dynamic";

/**
 * Ticker lookup for the manual portfolio editor.
 *
 * Goes through the same provider chain as everything else, so an added
 * position is priced by whichever real source answers. No model is involved
 * and none is needed: this is a symbol and a price.
 *
 * A symbol nothing can price returns 404 rather than a placeholder — the
 * editor surfaces SYMBOL NOT FOUND instead of storing a position that would
 * quietly distort the portfolio's return.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("symbol") ?? "";
  const symbol = raw.trim().toUpperCase();

  if (!symbol || !/^[A-Z0-9.\-^/]{1,24}$/.test(symbol)) {
    return NextResponse.json({ error: "SYMBOL NOT FOUND", symbol: raw }, { status: 400 });
  }

  const quotes = await getQuotes([symbol]);
  const quote = quotes[symbol];

  if (!quote) {
    return NextResponse.json(
      { error: "SYMBOL NOT FOUND", symbol },
      { status: 404 },
    );
  }

  // History is a nice-to-have here — a tradable symbol with a live quote but
  // no candle series is still addable, it just cannot be charted yet.
  const history = await getHistoricalPrices(symbol, 30).catch(() => null);

  return NextResponse.json({
    symbol,
    price: quote.price,
    changePercent: quote.changePercent,
    currency: quote.currency,
    provider: quote.provider,
    status: quote.status,
    timestamp: quote.timestamp,
    hasHistory: (history?.candles.length ?? 0) > 0,
  });
}
