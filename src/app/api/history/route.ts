import { NextResponse } from "next/server";
import { z } from "zod";
import { getHistoricalPrices, getIntraday } from "@/lib/providers";

export const dynamic = "force-dynamic";

/**
 * Historical prices for the ticker chart.
 *
 * No model is involved on any path here — this is provider data, cached by the
 * provider layer. Daily candles sit on a six-hour cache and intraday on a
 * short one, because a five-year series does not change between page views
 * while a 1D series does.
 */

const Query = z.object({
  symbol: z.string().min(1).max(24),
  range: z
    .enum(["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "MAX"])
    .default("1Y"),
});

/** Daily bars needed to cover each range, with headroom for a 200DMA. */
const BARS: Record<string, number> = {
  "1M": 260,
  "3M": 300,
  "6M": 380,
  YTD: 500,
  "1Y": 500,
  "3Y": 1000,
  "5Y": 1500,
  MAX: 2000,
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    symbol: url.searchParams.get("symbol") ?? "",
    range: url.searchParams.get("range") ?? "1Y",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const symbol = parsed.data.symbol.trim().toUpperCase();
  const range = parsed.data.range;

  if (range === "1D" || range === "5D") {
    const series = await getIntraday(symbol, range);
    if (!series || series.candles.length === 0) {
      return NextResponse.json(
        { symbol, range, candles: [], error: "HISTORICAL DATA UNAVAILABLE" },
        { status: 200 },
      );
    }
    return NextResponse.json({ symbol, range, intraday: true, candles: series.candles });
  }

  const series = await getHistoricalPrices(symbol, BARS[range] ?? 500);
  if (series.candles.length === 0) {
    return NextResponse.json(
      { symbol, range, candles: [], error: "HISTORICAL DATA UNAVAILABLE" },
      { status: 200 },
    );
  }

  return NextResponse.json({
    symbol,
    range,
    intraday: false,
    candles: series.candles,
    status: series.status,
  });
}
