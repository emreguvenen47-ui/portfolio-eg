import { NextResponse } from "next/server";
import { getHistories, getQuotes } from "@/lib/providers";
import { deterministicInRange } from "@/lib/metrics/helpers";
import { MARKET_INSTRUMENTS } from "@/lib/portfolio/config";
import type { Candle, Quote } from "@/lib/types";

export const dynamic = "force-dynamic";

const PERIODS: Record<string, number> = { "1M": 22, "3M": 66, "6M": 132, "1Y": 253 };

function buildMetricsFor(symbol: string, candles: Candle[], quote: Quote | undefined) {
  const closes = candles.map((c) => c.close).filter(Boolean);
  // Prefer the live quote over the last daily bar so the column moves intraday.
  const last = quote?.price ?? closes[closes.length - 1] ?? null;

  const returns: Record<string, number | null> = {};
  for (const [k, days] of Object.entries(PERIODS)) {
    if (closes.length > days) {
      const ref = closes[closes.length - 1 - days];
      returns[k] = ref > 0 ? (last / ref - 1) * 100 : null;
    } else returns[k] = null;
  }

  // Deterministic mock fundamentals when provider doesn't supply them.
  const pe = Number(deterministicInRange(symbol + "_pe", 5, 40).toFixed(2));
  const netDebt = Number(deterministicInRange(symbol + "_nd", -5e9, 50e9).toFixed(0));
  const premium = Number(deterministicInRange(symbol + "_prem", -10, 40).toFixed(2));
  const fcf = Number(deterministicInRange(symbol + "_fcf", -1e9, 10e9).toFixed(0));
  const evEbitda = Number(deterministicInRange(symbol + "_ev", 0.1, 30).toFixed(2));
  const beta = Number(deterministicInRange(symbol + "_beta", 0, 2.5).toFixed(2));
  const dividendYield = Number(deterministicInRange(symbol + "_div", 0, 5).toFixed(2));
  const aumFlowPct = Number(deterministicInRange(symbol + "_aum", -20, 40).toFixed(2));

  return {
    symbol,
    last,
    returns,
    pe,
    netDebt,
    premium,
    freeCashFlow: fcf,
    evEbitda,
    beta,
    dividendYield,
    aumFlowPct,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = (url.searchParams.get("type") ?? "all").toLowerCase();
  const symbolsParam = url.searchParams.get("symbols");
  const sortBy = url.searchParams.get("sort") ?? "aumFlowPct";
  const order = (url.searchParams.get("order") ?? "desc").toLowerCase();
  const limit = Number(url.searchParams.get("limit") ?? 200);

  const explicit = symbolsParam
    ? symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : [];

  let universe: string[] = [];
  if (explicit.length) universe = explicit;
  else {
    if (type === "stocks") {
      const defaultStocks = [
        "AAPL",
        "MSFT",
        "GOOGL",
        "AMZN",
        "NVDA",
        "TSLA",
        "JPM",
        "BAC",
        "UNH",
        "V",
        "MA",
        "DIS",
        "META",
        "PYPL",
        "NFLX",
      ];
      universe = defaultStocks;
    } else {
      // default universe: common US ETFs + market instruments
      const defaultEtfs = [
        "SPY",
        "QQQ",
        "IWM",
        "VTI",
        "DIA",
        "RSP",
        "SMH",
        "XLF",
        "XLY",
        "XLI",
        "XLK",
        "XLC",
        "GLD",
        "VNQ",
        "EEM",
        "VWO",
        "EMXC",
        "KWEB",
        "CPER",
        "GLDM",
      ];
      universe = [...new Set([...MARKET_INSTRUMENTS.map((m) => m.symbol).filter(Boolean), ...defaultEtfs])];
    }
  }

  // Two bulk calls for the whole universe. Fanning out one history request per
  // symbol here is what previously tripped the provider's rate limiter and
  // left every page in the app without prices.
  // The scanner universe is ~35 tickers, most of them not held. Accepting
  // 5-minute-old prices here keeps the shared per-minute request budget for
  // the positions that actually belong to the portfolio.
  const [histories, quotes] = await Promise.all([
    getHistories(universe, 800),
    getQuotes(universe, { maxAgeMs: 300_000 }),
  ]);
  const metrics = universe.map((s) =>
    buildMetricsFor(s, histories[s]?.candles ?? [], quotes[s]),
  );

  // Filter by type if requested (simple heuristic: ETFs often have 3-5 char tickers but we keep all)
  let out = metrics;

  // Sorting
  out.sort((a: any, b: any) => {
    const av = a[sortBy as keyof typeof a];
    const bv = b[sortBy as keyof typeof b];
    const na = av === null || av === undefined ? -Infinity : av;
    const nb = bv === null || bv === undefined ? -Infinity : bv;
    if (na === nb) return 0;
    return order === "asc" ? (na < nb ? -1 : 1) : (na > nb ? -1 : 1);
  });

  return NextResponse.json({ count: out.length, rows: out.slice(0, limit) });
}
