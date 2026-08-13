import "@/lib/providers/register";
import { NextResponse } from "next/server";
import { getHistories, getQuotes } from "@/lib/providers";
import { getMetrics, getFinancials, getRecommendations, getInsiders } from "@/lib/providers/fundamentals";
import { compare, type CompareInput } from "@/lib/research/compare";
import { ordered } from "@/lib/research/statements";
import { analyseInsiders } from "@/lib/research/insiders";
import { analyseAnalysts } from "@/lib/research/analysts";
import { buildHealth } from "@/lib/research/health";
import { buildSmartMoney } from "@/lib/research/smart-money";
import { scanSymbol } from "@/lib/portfolio/scanner";
import { technicalState } from "@/lib/portfolio/alert-engine";
import { getCatalysts } from "@/lib/events/catalysts";
import { valuationRows } from "@/lib/portfolio/quality-score";

export const dynamic = "force-dynamic";

/**
 * Comparison data for 2–5 symbols.
 *
 * Everything is assembled from the existing cached providers — fundamentals
 * are on a daily cache, prices on the shared quote clock. No model is called.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("symbols") ?? "";
  const symbols = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].slice(0, 5);

  if (symbols.length < 2) {
    return NextResponse.json({ error: "Give between 2 and 5 symbols" }, { status: 400 });
  }

  const [quotes, histories] = await Promise.all([
    getQuotes(symbols, { maxAgeMs: 5 * 60_000 }).catch(() => ({}) as Awaited<ReturnType<typeof getQuotes>>),
    getHistories(symbols, 400).catch(() => ({}) as Awaited<ReturnType<typeof getHistories>>),
  ]);

  const inputs: CompareInput[] = await Promise.all(
    symbols.map(async (symbol) => {
      const [metrics, financials, recs, insiders, catalysts] = await Promise.all([
        getMetrics(symbol).catch(() => null),
        getFinancials(symbol).catch(() => null),
        getRecommendations(symbol).catch(() => null),
        getInsiders(symbol).catch(() => null),
        getCatalysts(symbol).catch(() => []),
      ]);

      const candles = histories[symbol]?.candles ?? [];
      const quote = quotes[symbol] ?? null;
      const periods = ordered(financials ?? [], 8);
      const last = quote?.price ?? candles.at(-1)?.close ?? null;
      const tech = technicalState(candles, last);
      const insiderReport = insiders?.length ? analyseInsiders(insiders) : null;
      const analysts = analyseAnalysts(recs);
      const health = buildHealth(metrics, periods, symbol);

      const valRows = valuationRows(metrics).filter((r) => r.verdict !== "N/A");
      const valSum = valRows.reduce(
        (a, r) => a + (r.verdict === "CHEAP" ? -1 : r.verdict === "EXPENSIVE" ? 1 : 0),
        0,
      );
      const valuation =
        valRows.length === 0
          ? ("N/A" as const)
          : valSum >= Math.ceil(valRows.length / 2)
            ? ("EXPENSIVE" as const)
            : valSum <= -Math.ceil(valRows.length / 2)
              ? ("CHEAP" as const)
              : ("FAIR" as const);

      const smart = buildSmartMoney({
        insiders: insiderReport,
        analysts,
        guidance: { entries: [], trend: "N/A", available: false, note: "" },
        health,
        metrics,
        technical: tech?.state ?? null,
        valuation,
      });

      const scan = scanSymbol(symbol, candles, quote ?? undefined, metrics, []);

      return {
        symbol,
        quote,
        candles,
        periods,
        metrics,
        recommendations: recs,
        technical: tech?.state ?? null,
        insiderSignal: insiderReport?.signal ?? null,
        smartMoney: smart.score,
        opportunityScore: scan.score,
        nextCatalyst: catalysts[0] ? `${catalysts[0].date} ${catalysts[0].title}` : null,
      } satisfies CompareInput;
    }),
  );

  return NextResponse.json({ result: compare(inputs) });
}
