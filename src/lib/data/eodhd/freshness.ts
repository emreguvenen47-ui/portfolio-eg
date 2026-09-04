import "server-only";
import { eodhdGet } from "./client";
import { getCompanySnapshot } from "./fundamentals";
import { getUniverseRows, upsertOpportunityRows, computeOpportunityRow } from "../opportunities";
import { getScreenerUniverse } from "./screener";

/**
 * FRESHNESS PIPELINE — latest-report DISCOVERY decoupled from the statement
 * cache (sprint spec).
 *
 * Discovery: one cheap earnings-calendar call finds every symbol that
 * REPORTED in the window. Any of those whose canonical universe row predates
 * its report date gets a PRIORITY refresh: snapshot force-refetched (cache
 * invalidated), ratios recomputed, opportunity/screener row upserted — the
 * whole derived chain, not just the financials tab. The company that reported
 * yesterday must not wait for the weekly full sweep.
 *
 * Budget honesty: EODHD charges 10 requests per fundamentals call; a full
 * 7k sweep is ~78k requests (nearly the daily 100k). Priority refresh keeps
 * daily usage proportional to how many companies actually reported.
 */

interface CalendarRow {
  code?: string;
  report_date?: string;
  date?: string; // period end
}

export interface RecentReporter {
  symbol: string;
  reportDate: string;
  periodEnd: string | null;
}

/** US symbols with an earnings report date inside [from, to]. One API call. */
export async function getRecentReporters(fromIso: string, toIso: string): Promise<RecentReporter[]> {
  const res = await eodhdGet<{ earnings?: CalendarRow[] }>(`/calendar/earnings`, {
    from: fromIso,
    to: toIso,
  });
  const rows = res.earnings ?? [];
  const out: RecentReporter[] = [];
  for (const r of rows) {
    const code = r.code ?? "";
    if (!code.endsWith(".US")) continue;
    out.push({
      symbol: code.slice(0, -3),
      reportDate: r.report_date ?? "",
      periodEnd: r.date ?? null,
    });
  }
  return out;
}

export interface PriorityRefreshResult {
  window: { from: string; to: string };
  reportersInWindow: number;
  inUniverse: number;
  refreshed: number;
  failed: number;
  skippedFresh: number;
  tookMs: number;
}

/**
 * Refresh every universe company that reported inside the window and whose
 * canonical row is older than its report date. Paced for the per-minute limit.
 */
export async function refreshRecentReporters(days = 4, opts: { paceMs?: number; max?: number } = {}): Promise<PriorityRefreshResult> {
  const t0 = Date.now();
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const reporters = await getRecentReporters(from, to);

  const rows = getUniverseRows();
  const rowBySymbol = new Map(rows.map((r) => [r.symbol, r]));
  const screener = await getScreenerUniverse().catch(() => []);
  const screenerBySymbol = new Map(screener.map((r) => [r.symbol, r]));

  const due = reporters.filter((rep) => {
    const row = rowBySymbol.get(rep.symbol);
    if (!row) return false; // not in the supported universe
    // Refresh when the stored row predates the report — regardless of how
    // recently it was FETCHED. Cache age is not financial freshness.
    return row.updatedAt.slice(0, 10) <= rep.reportDate;
  });

  const pace = opts.paceMs ?? 400;
  const cap = opts.max ?? 800;
  let refreshed = 0;
  let failed = 0;
  const fresh: NonNullable<Awaited<ReturnType<typeof computeOpportunityRow>>>[] = [];

  for (const rep of due.slice(0, cap)) {
    try {
      // Invalidate the statement cache FIRST — discovery says a newer report
      // exists, so serving the cached snapshot would be a stale CURRENT.
      await getCompanySnapshot(rep.symbol, { force: true });
      const base = screenerBySymbol.get(rep.symbol);
      if (base) {
        const row = await computeOpportunityRow(base);
        if (row) {
          fresh.push(row);
          refreshed++;
        } else failed++;
      } else failed++;
    } catch {
      failed++;
    }
    await new Promise((r) => setTimeout(r, pace));
  }
  if (fresh.length) upsertOpportunityRows(fresh);

  return {
    window: { from, to },
    reportersInWindow: reporters.length,
    inUniverse: due.length,
    refreshed,
    failed,
    skippedFresh: due.length - Math.min(due.length, cap),
    tookMs: Date.now() - t0,
  };
}
