import { NextResponse } from "next/server";
import "@/lib/providers/register";
import { refreshRecentReporters } from "@/lib/data/eodhd/freshness";
import { getUniverseMeta } from "@/lib/data/opportunities";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * MANUAL / CRON PRIORITY REFRESH — POST /api/admin/refresh?days=4
 *
 * Same pipeline the hourly scheduler runs: earnings-calendar discovery →
 * force-refetch snapshots for companies that reported → rebuild their
 * canonical rows. Safe to wire to an external cron (Vercel cron, GitHub
 * Actions, crontab) in deployments where the in-process scheduler can't run.
 */
async function run(req: Request) {
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(10, Number(url.searchParams.get("days")) || 4));
  try {
    // Congressional ledger accumulation rides the same cron (2 requests).
    const { refreshLedger } = await import("@/lib/research/fmp-congress");
    const congress = await refreshLedger().catch(() => null);
    // Serverless-safe chunk: ~45 symbols per invocation inside the 60s cap;
    // the hourly cron chips through the backlog run by run.
    const result = await refreshRecentReporters(days, { paceMs: 300, max: 45 });
    return NextResponse.json({ ok: true, result, universe: getUniverseMeta(), congressLedgerRows: congress?.rows.length ?? null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

/** Vercel cron invokes GET; manual/CI use POST. Same pipeline. */
export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
