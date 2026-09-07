import "@/lib/providers/register";
import { NextResponse } from "next/server";
import { getHistoricalPrices, getQuotes } from "@/lib/providers";
import { getCompanySnapshot } from "@/lib/data/eodhd/fundamentals";
import { buildTechnicalDecision } from "@/lib/engines/technical-v3";
import { computeValuation } from "@/lib/engines/valuation";
import { buildRiskProfile } from "@/lib/engines/risk-metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * COMPARISON DATA for 2–5 symbols — canonical stack only: EODHD snapshot,
 * V3 technical decision, valuation models, risk profile. The same engines the
 * ticker page uses, so a number here always matches the number there.
 */

export interface CompareRow {
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  marketCap: number | null;
  // valuation
  peTtm: number | null;
  forwardPe: number | null;
  priceToSales: number | null;
  priceToBook: number | null;
  evToEbitda: number | null;
  fcfYield: number | null; // fraction
  upsidePct: number | null;
  valuationConfidence: string | null;
  // growth & profitability
  revenueGrowthYoY: number | null; // fraction
  epsGrowthFwd: number | null; // fraction, next-FY est vs TTM
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  roe: number | null;
  roic: number | null;
  // balance
  netDebtToEbitda: number | null;
  currentRatio: number | null;
  // technical
  signal: string | null;
  setup: string | null;
  technicalScore: number | null;
  riskReward: number | null;
  // risk
  beta: number | null;
  realizedVolPct: number | null;
  maxDrawdownPct: number | null;
  // performance
  perf1M: number | null;
  perf6M: number | null;
  perf1Y: number | null;
  /** Weekly closes over ~1y, normalized to 100 at the start (chart). */
  series: Array<{ date: string; value: number }>;
}

const perf = (candles: Array<{ close: number }>, bars: number): number | null => {
  if (candles.length < 2) return null;
  const last = candles[candles.length - 1]!.close;
  const ref = candles[Math.max(0, candles.length - 1 - bars)]?.close;
  return ref && ref > 0 ? Number(((last / ref - 1) * 100).toFixed(1)) : null;
};

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("symbols") ?? "";
  const symbols = [...new Set(raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 5);
  if (symbols.length < 2) {
    return NextResponse.json({ error: "Give between 2 and 5 symbols" }, { status: 400 });
  }

  const [quotes, bench] = await Promise.all([
    getQuotes(symbols).catch(() => ({}) as Awaited<ReturnType<typeof getQuotes>>),
    getHistoricalPrices("^GSPC", 600).catch(() => ({ candles: [] as Array<{ date: string; close: number; high: number; low: number; volume?: number; open: number }> })),
  ]);

  const rows: CompareRow[] = [];
  for (const symbol of symbols) {
    const [snap, hist] = await Promise.all([
      getCompanySnapshot(symbol).catch(() => null),
      getHistoricalPrices(symbol, 600).catch(() => ({ candles: [] })),
    ]);
    const candles = hist.candles;
    const last = candles.at(-1)?.close ?? quotes[symbol]?.price ?? null;
    const d = candles.length >= 60 ? buildTechnicalDecision(symbol, candles) : null;
    const v = snap && last !== null ? computeValuation(snap, last) : null;
    const risk = candles.length >= 60 ? buildRiskProfile(candles, bench.candles.length ? bench.candles : null) : null;

    // Weekly-ish normalized series for the relative chart.
    const year = candles.slice(-253);
    const base = year[0]?.close ?? null;
    const series =
      base && base > 0
        ? year.filter((_, i) => i % 5 === 0 || i === year.length - 1).map((c) => ({ date: c.date, value: Number(((c.close / base) * 100).toFixed(2)) }))
        : [];

    rows.push({
      symbol,
      name: snap?.identity.name ?? null,
      sector: snap?.identity.sector ?? null,
      price: last,
      marketCap: snap?.marketCap ?? null,
      peTtm: snap?.peTtm ?? null,
      forwardPe: snap?.forwardPe ?? null,
      priceToSales: snap?.priceToSales ?? null,
      priceToBook: snap?.priceToBook ?? null,
      evToEbitda: snap?.evToEbitda ?? null,
      fcfYield: snap?.fcfYield ?? null,
      upsidePct: v?.verdict === "OK" ? v.upsidePct : null,
      valuationConfidence: v?.verdict === "OK" ? v.confidence : v ? "INVALID" : null,
      revenueGrowthYoY: snap?.revenueGrowthYoY ?? null,
      epsGrowthFwd:
        snap?.epsEstimateNextYear != null && snap?.epsTtm != null && snap.epsTtm > 0
          ? snap.epsEstimateNextYear / snap.epsTtm - 1
          : null,
      grossMargin: snap?.grossMarginTtm ?? null,
      operatingMargin: snap?.operatingMarginTtm ?? null,
      netMargin: snap?.netMarginTtm ?? null,
      roe: snap?.roe ?? null,
      roic: snap?.roic ?? null,
      netDebtToEbitda: snap?.netDebtToEbitda ?? null,
      currentRatio: snap?.currentRatio ?? null,
      signal: d?.signal ?? null,
      setup: d && d.setup !== "NONE" ? d.setup : null,
      technicalScore: d?.score?.total ?? null,
      riskReward: d?.riskReward ?? null,
      beta: risk?.beta ?? null,
      realizedVolPct: risk?.realizedVolPct ?? null,
      maxDrawdownPct: risk?.maxDrawdownPct ?? null,
      perf1M: perf(candles, 22),
      perf6M: perf(candles, 128),
      perf1Y: perf(candles, 253),
      series,
    });
  }

  return NextResponse.json({ rows });
}
