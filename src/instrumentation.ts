/**
 * BACKGROUND FRESHNESS SCHEDULER (Next.js instrumentation hook).
 *
 * Two cadences, budget-aware (EODHD bills fundamentals at 10 requests/call;
 * a full 7k sweep is ~78k of the 100k daily budget, so full sweeps are a
 * weekly/scripted operation — NOT the daily freshness mechanism):
 *
 *  - PRIORITY REFRESH, hourly: one earnings-calendar call discovers who
 *    reported in the last few days; only those companies get their snapshot
 *    force-refetched and their canonical/screener/opportunities row rebuilt.
 *    A company that reported yesterday never waits for a full sweep.
 *  - On a sustained quota error the loop backs off until the next UTC day.
 *
 * Disable with EG_AUTO_REFRESH=0. Manual trigger: POST /api/admin/refresh.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // On serverless there is no long-lived process — the Vercel cron hitting
  // /api/admin/refresh (vercel.json) is the scheduler there.
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return;
  if (process.env.EG_AUTO_REFRESH === "0") return;
  if (!process.env.EODHD_API_KEY) return;

  const HOUR = 60 * 60_000;
  let pausedUntil = 0;

  const tick = async () => {
    if (Date.now() < pausedUntil) return;
    try {
      const { refreshRecentReporters } = await import("@/lib/data/eodhd/freshness");
      const res = await refreshRecentReporters(4, { paceMs: 450, max: 600 });
      if (res.refreshed || res.inUniverse) {
        console.log(
          `[freshness] window ${res.window.from}..${res.window.to}: ${res.reportersInWindow} reporters, ${res.inUniverse} due, refreshed ${res.refreshed}, failed ${res.failed} in ${(res.tookMs / 1000).toFixed(0)}s`,
        );
      }
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (msg.includes("402") || msg.toLowerCase().includes("payment")) {
        // Daily quota exhausted — resume after the next UTC midnight.
        const nextUtcMidnight = new Date();
        nextUtcMidnight.setUTCHours(24, 5, 0, 0);
        pausedUntil = nextUtcMidnight.getTime();
        console.warn(`[freshness] EODHD daily quota exhausted; paused until ${nextUtcMidnight.toISOString()}`);
      } else {
        console.error("[freshness] tick failed:", msg);
      }
    }
  };

  // First run shortly after boot (don't block startup), then hourly.
  setTimeout(() => void tick(), 90_000);
  setInterval(() => void tick(), HOUR);
}
