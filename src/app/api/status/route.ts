import { NextResponse } from "next/server";
import { getProviderHealth, marketOpenNow, quoteTtlMs, resolveProvider } from "@/lib/providers";
import { finnhubUsage } from "@/lib/providers/finnhub";
import { upstreamCallCount } from "@/lib/providers/fundamentals";
import { queueStats } from "@/lib/server/warm-queue";
import { isAiConfigured } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

/**
 * Header-badge probe.
 *
 * Deliberately does NOT fetch a quote: it reports what the last real fetch
 * did. An endpoint polled by every open tab must not consume upstream
 * requests, and an independent probe would also disagree with the page it sits
 * above, which is what made the badge flicker.
 */
export async function GET() {
  const health = getProviderHealth();
  const { chain, configured, twelveDataKeyPresent, finnhubKeyPresent } = resolveProvider();

  return NextResponse.json({
    status: health.status,
    feed: health.feed,
    provider: health.provider,
    configured,
    providers: chain.map((p) => p.name),
    twelveDataKeyPresent,
    finnhubKeyPresent,
    aiConfigured: isAiConfigured(),
    reason:
      health.reason ??
      (health.status === "MARKET_CLOSED" ? "Venue closed — last official print" : undefined),
    /** When the underlying prices were last refreshed (not "now"). */
    /**
     * Background enrichment. Non-zero pending means tables are still filling
     * in; the count is what the scanner and screener show as "enriching N".
     */
    warmQueue: queueStats(),
    /** Cumulative upstream fundamentals calls — the number benchmarks watch. */
    upstreamCalls: upstreamCallCount(),
    dataUpdatedAt: health.updatedAt,
    lastSuccessAt: health.lastSuccessAt,
    /**
     * Client poll cadence, dictated by the server. Outside market hours this
     * stretches to minutes: the last trade is not going to change, so polling
     * faster would only spend request budget.
     */
    refreshMs: quoteTtlMs(),
    marketOpen: marketOpenNow(),
    requestBudget: finnhubUsage(),
    updatedAt: new Date().toISOString(),
  });
}
