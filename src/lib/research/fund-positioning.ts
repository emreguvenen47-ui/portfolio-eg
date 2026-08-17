import "server-only";
import {
  holdingTicker,
  loadTrackedFilings,
  quartersBehind,
  TRACKED_MANAGERS,
  type ManagerFiling,
} from "@/lib/providers/sec-13f";

/**
 * What the tracked managers hold, and what changed.
 *
 * Built from the 13F-HR information tables, which carry issuer, CUSIP, market
 * value and share count — and nothing else. Two consequences shape everything
 * below, and both are stated in the interface rather than left to be
 * discovered:
 *
 * A 13F is a QUARTERLY SNAPSHOT, filed up to 45 days after the quarter ends.
 * By the time it is public the manager may have reversed the whole position.
 * This is a record of past positioning, never of current positioning.
 *
 * A 13F covers LONG US EQUITY ONLY. No shorts, no bonds, no cash, no foreign
 * listings. A "portfolio" here is the reportable slice, so a macro fund with
 * most of its risk in futures will look tiny and oddly allocated. Percentages
 * are of the reported table, not of the manager's book.
 */

export interface FundPosition {
  ticker: string | null;
  issuer: string;
  cusip: string;
  value: number;
  shares: number;
  /** Share of this manager's reported table. */
  weight: number;
  /** Share count last quarter, when the manager filed one. */
  sharesPrior: number | null;
  changeShares: number | null;
  changePct: number | null;
  action: "NEW" | "ADDED" | "TRIMMED" | "EXITED" | "HELD";
}

export interface FundSnapshot {
  cik: string;
  manager: string;
  period: string;
  filedAt: string;
  /** Quarters behind the most recent filing among all tracked managers. */
  staleQuarters: number;
  /** Total reported value, i.e. the long US equity table only. */
  reportedValue: number;
  positions: number;
  /** Heaviest first, for the allocation chart. */
  top: FundPosition[];
  /** Biggest increases and new positions this quarter. */
  increased: FundPosition[];
  /** Biggest reductions and exits. */
  reduced: FundPosition[];
  /** True when there is no prior filing to compare against. */
  firstFiling: boolean;
}

/** Merge the rows a 13F splits by voting authority into one position. */
function net(f: ManagerFiling): Map<string, { issuer: string; value: number; shares: number }> {
  const out = new Map<string, { issuer: string; value: number; shares: number }>();
  for (const h of f.holdings) {
    const hit = out.get(h.cusip);
    if (hit) {
      hit.value += h.value;
      hit.shares += h.shares;
    } else {
      out.set(h.cusip, { issuer: h.issuer, value: h.value, shares: h.shares });
    }
  }
  return out;
}

const TOP_N = 12;

function classify(shares: number, prior: number | null): FundPosition["action"] {
  if (prior === null || prior === 0) return shares > 0 ? "NEW" : "HELD";
  if (shares === 0) return "EXITED";
  const delta = (shares - prior) / prior;
  // A one percent drift is share-count noise from splits and rounding, not a
  // decision worth reporting as one.
  if (delta > 0.01) return "ADDED";
  if (delta < -0.01) return "TRIMMED";
  return "HELD";
}

export async function fundPositioning(): Promise<{
  funds: FundSnapshot[];
  newestPeriod: string | null;
  trackedCount: number;
}> {
  const filings = await loadTrackedFilings();
  if (filings.length === 0) {
    return { funds: [], newestPeriod: null, trackedCount: TRACKED_MANAGERS.length };
  }

  const byManager = new Map<string, ManagerFiling[]>();
  for (const f of filings) byManager.set(f.cik, [...(byManager.get(f.cik) ?? []), f]);

  const newestPeriod =
    [...filings].sort((a, b) => b.reportPeriod.localeCompare(a.reportPeriod))[0]?.reportPeriod ??
    null;

  const funds: FundSnapshot[] = [];

  for (const [cik, list] of byManager) {
    const sorted = [...list].sort((a, b) => b.reportPeriod.localeCompare(a.reportPeriod));
    const latest = sorted[0];
    const prior = sorted[1] ?? null;
    if (!latest) continue;

    const now = net(latest);
    const before = prior ? net(prior) : null;

    const reportedValue = [...now.values()].reduce((s, x) => s + x.value, 0);
    if (reportedValue <= 0) continue;

    const rows: FundPosition[] = [...now.entries()].map(([cusip, x]) => {
      const priorShares = before?.get(cusip)?.shares ?? null;
      const changeShares = priorShares === null ? null : x.shares - priorShares;
      return {
        ticker: holdingTicker(cusip, x.issuer),
        issuer: x.issuer,
        cusip,
        value: x.value,
        shares: x.shares,
        weight: (x.value / reportedValue) * 100,
        sharesPrior: priorShares,
        changeShares,
        changePct:
          priorShares === null || priorShares === 0
            ? null
            : ((x.shares - priorShares) / priorShares) * 100,
        action: classify(x.shares, priorShares),
      };
    });

    /**
     * Exits do not appear in the current table at all, so they have to be
     * recovered from the prior one. A position sold to zero is the strongest
     * signal a 13F carries and leaving it out would make every fund look like
     * it only ever buys.
     */
    if (before) {
      for (const [cusip, x] of before) {
        if (now.has(cusip)) continue;
        rows.push({
          ticker: holdingTicker(cusip, x.issuer),
          issuer: x.issuer,
          cusip,
          value: 0,
          shares: 0,
          weight: 0,
          sharesPrior: x.shares,
          changeShares: -x.shares,
          changePct: -100,
          action: "EXITED",
        });
      }
    }

    const byValue = [...rows].sort((a, b) => b.value - a.value);

    // Ranked by the money moved, not by percentage: a 400% increase in a
    // rounding-error position is not the story a 2% add to a top holding is.
    const moved = (p: FundPosition) =>
      p.changeShares === null || p.shares === 0
        ? Math.abs((p.changeShares ?? 0) * (p.sharesPrior ? 0 : 0))
        : Math.abs(p.changeShares) * (p.value / Math.max(p.shares, 1));

    const exitValue = (p: FundPosition) =>
      p.action === "EXITED" && p.sharesPrior
        ? // No price in the current table for something no longer held; the
          // prior quarter's own value per share is the only honest estimate.
          Math.abs(p.changeShares ?? 0)
        : moved(p);

    funds.push({
      cik,
      manager: latest.manager,
      period: latest.reportPeriod,
      filedAt: latest.filedAt,
      staleQuarters: newestPeriod ? quartersBehind(latest.reportPeriod, newestPeriod) : 0,
      reportedValue,
      positions: now.size,
      top: byValue.slice(0, TOP_N),
      increased: rows
        .filter((p) => p.action === "NEW" || p.action === "ADDED")
        .sort((a, b) => moved(b) - moved(a))
        .slice(0, 8),
      reduced: rows
        .filter((p) => p.action === "TRIMMED" || p.action === "EXITED")
        .sort((a, b) => exitValue(b) - exitValue(a))
        .slice(0, 8),
      firstFiling: prior === null,
    });
  }

  return {
    // Largest reported book first — that is the order a reader expects.
    funds: funds.sort((a, b) => b.reportedValue - a.reportedValue),
    newestPeriod,
    trackedCount: TRACKED_MANAGERS.length,
  };
}
