import { NextResponse } from "next/server";
import "@/lib/providers/register";
import { getHistoricalPrices } from "@/lib/providers";
import { buildTechnicalReport } from "@/lib/engines/technical-report";

export const dynamic = "force-dynamic";

/**
 * EG ANALYZE — the workstation's deep technical report. Deterministic engine
 * output over provider candles; the canonical V3 decision supplies signal /
 * setup / stops / targets and this endpoint only ENRICHES around them.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();
  const tf = (url.searchParams.get("tf") ?? "DAILY").toUpperCase() === "WEEKLY" ? "WEEKLY" : "DAILY";
  if (!symbol || symbol.length > 24) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }
  const history = await getHistoricalPrices(symbol, 1300);
  const report = buildTechnicalReport(symbol, history.candles, tf);
  if (!report) {
    return NextResponse.json(
      { error: "Not enough price history to analyze (need 60+ bars)." },
      { status: 200 },
    );
  }
  return NextResponse.json({ report });
}
