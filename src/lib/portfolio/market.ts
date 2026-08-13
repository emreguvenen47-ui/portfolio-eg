import "server-only";
import type { Portfolio, Quote } from "@/lib/types";
import { aggregateStatus, getHistories, getQuotes } from "@/lib/providers";
import { MARKET_INSTRUMENTS } from "./config";
import type { MarketBundle } from "./analytics";
import type { AppSettings } from "./settings";

/** Symbols the app always needs, regardless of holdings. */
const CORE_SYMBOLS = ["USD/TRY", "SPX", "XU100"];

export async function buildMarketBundle(
  portfolio: Portfolio,
  settings: AppSettings,
  opts: { includeMarketMonitor?: boolean; history?: boolean } = {},
): Promise<MarketBundle> {
  const positionSymbols = portfolio.positions
    .map((p) => p.symbol)
    .filter((s): s is string => Boolean(s));

  const monitorSymbols = opts.includeMarketMonitor
    ? MARKET_INSTRUMENTS.map((m) => m.symbol)
    : [];

  const symbols = [...new Set([...positionSymbols, ...CORE_SYMBOLS, ...monitorSymbols])];

  const quoteList = await getQuotes(symbols);

  const histories: Record<string, import("@/lib/types").Candle[]> = {};
  if (opts.history !== false) {
    // One bulk call, not one request per symbol: fanning out across ~25
    // holdings trips the upstream rate limiter, which drops the whole page to
    // no prices at all. Results are cached per symbol inside the provider layer.
    const series = await getHistories(symbols, 800);
    for (const [s, h] of Object.entries(series)) histories[s] = h.candles;
  }

  const fxQuote = quoteList["USD/TRY"];
  const fxHistory = histories["USD/TRY"] ?? [];
  const marketRate = fxQuote?.price ?? fxHistory.at(-1)?.close ?? 0;

  // Remap monitor keys (SPX, VIX, ...) onto the quote map for convenience.
  const quotes: Record<string, Quote> = { ...quoteList };
  for (const m of MARKET_INSTRUMENTS) {
    const q = quoteList[m.symbol];
    if (q) quotes[m.key] = q;
  }

  return {
    quotes,
    histories,
    status: aggregateStatus(Object.values(quoteList)),
    usdTryRate: settings.usdTryOverride ?? marketRate,
    usdTryChangePct: fxQuote?.changePercent ?? 0,
  };
}
