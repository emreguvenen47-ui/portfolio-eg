import { NextResponse } from "next/server";
import "@/lib/providers/register";
import { refreshLedger } from "@/lib/research/fmp-congress";
import { capitolTradesSource } from "@/lib/research/capitol-trades";
import { allHealth } from "@/lib/research/congress-health";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * CONGRESS SOURCE HEALTH — hit this on ANY deployment to learn whether THAT
 * runtime can reach each upstream. It performs one real attempt per source
 * (respecting backoffs) and returns the persisted ledger:
 *   SOURCE / STATUS / HTTP STATUS / LAST SUCCESS / LAST ATTEMPT / CACHE AGE
 * A sample row is included on success so "reachable" is proven by data,
 * never inferred from a 200.
 */
export async function GET() {
  // One live attempt per source (both respect their own TTL/backoff).
  const ledger = await refreshLedger();
  await capitolTradesSource.trades("").catch(() => []);

  const health = allHealth(["fmp-congress", "capitol-trades"]).map((h) => ({
    SOURCE: h.source,
    STATUS: h.state,
    HTTP_STATUS: h.httpStatus,
    LAST_SUCCESS: h.lastSuccess,
    LAST_ATTEMPT: h.lastAttempt,
    CACHE_AGE_SECONDS: h.cacheAgeMs !== null ? Math.round(h.cacheAgeMs / 1000) : null,
    CACHED_ROWS: h.cachedRows,
    NOTE: h.note,
  }));

  return NextResponse.json({
    runtime: process.env.VERCEL ? "vercel" : "self-hosted",
    checkedAt: new Date().toISOString(),
    health,
    ledgerRows: ledger.rows.length,
    ledgerUpdatedAt: ledger.updatedAt || null,
    sampleTrade: ledger.rows[0] ?? null,
  });
}
