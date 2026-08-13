import { NextResponse } from "next/server";
import { getHistories, getQuotes } from "@/lib/providers";
import { getMetrics, getRecommendations } from "@/lib/providers/fundamentals";
import { SCAN_UNIVERSE, scanSymbol } from "@/lib/portfolio/scanner";

export const dynamic = "force-dynamic";

/**
 * Scanner sweep. Prices and candles come from the shared cache; fundamentals
 * are on a six-hour cache of their own, so a repeat sweep is nearly free.
 * No model is involved at any point.
 */

const CACHE_TTL_MS = 15 * 60_000;
const CACHE_KEY = Symbol.for("pcc.scanner.cache");
const cache = ((globalThis as unknown as Record<symbol, { at: number; rows: unknown } | undefined>)[
  CACHE_KEY
] ??= undefined);

let store: { at: number; rows: unknown } | undefined = cache;

export async function GET() {
  if (store && Date.now() - store.at < CACHE_TTL_MS) {
    return NextResponse.json({ rows: store.rows, cached: true });
  }

  const symbols = SCAN_UNIVERSE.map((u) => u.symbol);
  const [histories, quotes] = await Promise.all([
    // Accept older prices here: a ranking sweep does not need tick freshness,
    // and reusing the portfolio's own refresh keeps the request budget intact.
    getHistories(symbols, 400),
    getQuotes(symbols, { maxAgeMs: 15 * 60_000 }),
  ]);

  const rows = await Promise.all(
    SCAN_UNIVERSE.map(async (u) => {
      const metrics = await getMetrics(u.symbol).catch(() => null);

      // Fold analyst consensus into the metrics bag when it exists. Absent
      // coverage simply drops the component rather than blocking the row.
      let withRec = metrics;
      const recs = await getRecommendations(u.symbol).catch(() => null);
      const r = recs?.[0];
      if (metrics && r) {
        const total = r.strongBuy + r.buy + r.hold + r.sell + r.strongSell;
        if (total > 0) {
          const net = (r.strongBuy * 2 + r.buy - r.sell - r.strongSell * 2) / (total * 2);
          withRec = { ...metrics, __recScore: Math.round((net + 1) * 50) };
        }
      }

      return scanSymbol(
        u.symbol,
        histories[u.symbol]?.candles ?? [],
        quotes[u.symbol],
        withRec,
        u.tags,
      );
    }),
  );

  const sorted = rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  store = { at: Date.now(), rows: sorted };
  return NextResponse.json({ rows: sorted });
}
