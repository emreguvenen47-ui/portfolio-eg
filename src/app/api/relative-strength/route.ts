import { NextResponse } from "next/server";
import { getHistories } from "@/lib/providers";
import { relativeStrength, RS_BENCHMARKS } from "@/lib/portfolio/relative-strength";

export const dynamic = "force-dynamic";

/** Relative performance from cached daily candles. No model call. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();
  const raw = (url.searchParams.get("benchmark") ?? "SPY").trim().toUpperCase();
  const bm = RS_BENCHMARKS.find((b) => b.key === raw) ?? RS_BENCHMARKS[0];

  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const series = await getHistories([symbol, bm.key], 400);
  const asset = series[symbol]?.candles ?? [];
  const benchmark = series[bm.key]?.candles ?? [];

  return NextResponse.json({
    rs: relativeStrength(asset, benchmark, bm.label),
  });
}
