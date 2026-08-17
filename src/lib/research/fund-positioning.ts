import "server-only";
import { cachedScreenerUniverse } from "@/lib/scanner/screener-universe";
import { detectSplit, findSuccessions } from "./corporate-actions";
import {
  holdingTicker,
  loadTrackedFilings,
  quartersBehind,
  TRACKED_MANAGERS,
  type FilerKind,
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
  kind: FilerKind;
  /**
   * Weight of the single largest holding.
   *
   * The number that separates a portfolio from a strategic stake: a fund's
   * biggest position is a few percent, Alphabet's is 95%. Surfaced so the
   * concentration is visible without reading the table.
   */
  topWeight: number;
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
      kind: latest.kind,
      topWeight: byValue[0]?.weight ?? 0,
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

// ------------------------------------------------------------- company flow

/**
 * The prior quarter, restated so it can be compared with this one.
 *
 * Splits are folded into the share count and CUSIP successions are merged into
 * the surviving identifier. Without this the ranking is led by artefacts: a
 * five-for-one split reads as a 935% purchase and a spinoff reads as every
 * holder liquidating at once.
 */
function restatePrior(
  prior: Map<string, { issuer: string; value: number; shares: number }>,
  now: Map<string, { issuer: string; value: number; shares: number }>,
): { restated: Map<string, { issuer: string; value: number; shares: number }>; actions: number } {
  const restated = new Map<string, { issuer: string; value: number; shares: number }>(
    [...prior.entries()].map(([c, v]) => [c, { ...v }]),
  );
  let actions = 0;

  // Splits: scale the prior share count onto the current basis.
  for (const [cusip, before] of restated) {
    const after = now.get(cusip);
    if (!after) continue;
    const { factor, detected } = detectSplit(before, after);
    if (detected) {
      before.shares *= factor;
      actions++;
    }
  }

  // Successions: move the old holding onto the new identifier(s), split by
  // the successors' share of the new value so a two-way spinoff nets to zero
  // rather than to a purchase and a sale.
  for (const s of findSuccessions(restated, now)) {
    const oldCusip = s.from[0];
    const old = restated.get(oldCusip);
    if (!old) continue;
    const targets = s.to.map((c) => ({ c, r: now.get(c)! })).filter((t) => t.r);
    const totalValue = targets.reduce((sum, t) => sum + t.r.value, 0);
    if (totalValue <= 0) continue;

    for (const t of targets) {
      const share = t.r.value / totalValue;
      const existing = restated.get(t.c);
      const carried = {
        issuer: t.r.issuer,
        value: old.value * share,
        // The successor's own share count is the right basis: the old count
        // was in units of a security that no longer exists.
        shares: t.r.shares,
      };
      restated.set(
        t.c,
        existing
          ? { issuer: existing.issuer, value: existing.value + carried.value, shares: existing.shares + carried.shares }
          : carried,
      );
    }
    restated.delete(oldCusip);
    actions++;
  }

  return { restated, actions };
}

export interface CompanyFlow {
  ticker: string | null;
  issuer: string;
  cusip: string;
  /** Managers who increased or opened, and who cut or exited. */
  buyers: string[];
  sellers: string[];
  /** Net shares added across every manager that filed both quarters. */
  netShares: number;
  /** Net shares as a share of the prior quarter's combined holding. */
  netPct: number | null;
  /** Combined reported value this quarter. */
  value: number;
  /** Managers holding it at all. */
  holders: number;
  /** Managers who opened a position that did not exist last quarter. */
  opened: number;
  /** Managers who sold out entirely. */
  closed: number;
  /**
   * Every holder exited and the ticker is no longer in the listing.
   *
   * That is the shape of an acquisition or a delisting, not of a decision.
   * Ranking it as "most sold" would put a cash takeover at the top of a list
   * meant to show what managers chose to do.
   */
  likelyDelisted: boolean;
}

export interface FlowReport {
  bought: CompanyFlow[];
  sold: CompanyFlow[];
  period: string | null;
  /** Managers whose filings could be compared quarter on quarter. */
  comparable: number;
  skippedStale: string[];
  /** Splits and CUSIP successions folded out of the comparison. */
  corporateActions: number;
  /** Names dropped from the sold list because they left the market entirely. */
  delisted: CompanyFlow[];
}

const TOP_FLOW = 20;

/**
 * Which companies the tracked managers moved into and out of last quarter.
 *
 * Aggregated across managers, netted by share count rather than by value: a
 * position can gain value without anybody buying a share of it, and counting
 * that as accumulation would turn a rising market into a wave of buying.
 *
 * Only managers who filed BOTH of the two most recent quarters are counted.
 * One who has stopped filing would otherwise appear to have sold everything
 * the moment their last filing aged out — an artefact that would dominate the
 * sold list with fictitious liquidations.
 *
 * Corporate filers are excluded. Four operating companies holding a dozen
 * strategic stakes between them are not part of "what funds did", and
 * Alphabet's single 95% position would swamp any ranking it entered.
 */
export async function companyFlow(): Promise<FlowReport> {
  const filings = await loadTrackedFilings();
  if (filings.length === 0) {
    return {
      bought: [], sold: [], period: null, comparable: 0,
      skippedStale: [], corporateActions: 0, delisted: [],
    };
  }

  const period =
    [...filings].sort((a, b) => b.reportPeriod.localeCompare(a.reportPeriod))[0]?.reportPeriod ??
    null;

  const byManager = new Map<string, ManagerFiling[]>();
  for (const f of filings) {
    if (f.kind !== "manager") continue;
    byManager.set(f.cik, [...(byManager.get(f.cik) ?? []), f]);
  }

  interface Agg {
    issuer: string;
    buyers: Set<string>;
    sellers: Set<string>;
    net: number;
    priorTotal: number;
    value: number;
    holders: Set<string>;
    opened: number;
    closed: number;
  }
  const agg = new Map<string, Agg>();
  const slot = (cusip: string, issuer: string): Agg => {
    let a = agg.get(cusip);
    if (!a) {
      a = {
        issuer,
        buyers: new Set(),
        sellers: new Set(),
        net: 0,
        priorTotal: 0,
        value: 0,
        holders: new Set(),
        opened: 0,
        closed: 0,
      };
      agg.set(cusip, a);
    }
    return a;
  };

  let comparable = 0;
  let corporateActions = 0;
  const skippedStale: string[] = [];

  for (const [, list] of byManager) {
    const sorted = [...list].sort((a, b) => b.reportPeriod.localeCompare(a.reportPeriod));
    const latest = sorted[0];
    const prior = sorted[1];
    if (!latest || !prior) continue;

    // A manager who has not filed the newest quarter cannot have moved in it.
    if (period && latest.reportPeriod !== period) {
      skippedStale.push(latest.manager);
      continue;
    }
    comparable++;

    const now = net(latest);
    const { restated: before, actions } = restatePrior(net(prior), now);
    corporateActions += actions;

    for (const [cusip, x] of now) {
      const a = slot(cusip, x.issuer);
      a.value += x.value;
      a.holders.add(latest.manager);

      const was = before.get(cusip)?.shares ?? 0;
      a.priorTotal += was;
      const delta = x.shares - was;
      a.net += delta;

      if (was === 0) {
        a.opened++;
        a.buyers.add(latest.manager);
      } else if (delta / was > 0.01) {
        a.buyers.add(latest.manager);
      } else if (delta / was < -0.01) {
        a.sellers.add(latest.manager);
      }
    }

    // Positions that vanished are the ones worth catching.
    for (const [cusip, x] of before) {
      if (now.has(cusip)) continue;
      const a = slot(cusip, x.issuer);
      a.priorTotal += x.shares;
      a.net -= x.shares;
      a.closed++;
      a.sellers.add(latest.manager);
    }
  }

  const listed = new Set(
    cachedScreenerUniverse()
      .filter((r) => r.region === "US")
      .map((r) => r.symbol),
  );

  const rows: CompanyFlow[] = [...agg.entries()].map(([cusip, a]) => {
    const ticker = holdingTicker(cusip, a.issuer);
    return {
    ticker,
    issuer: a.issuer,
    cusip,
    buyers: [...a.buyers],
    sellers: [...a.sellers],
    netShares: a.net,
    netPct: a.priorTotal > 0 ? (a.net / a.priorTotal) * 100 : null,
    value: a.value,
    holders: a.holders.size,
    opened: a.opened,
    closed: a.closed,
    // Only claimed when the listing is loaded; an empty listing would mark
    // everything as delisted.
    likelyDelisted:
      listed.size > 0 && a.holders.size === 0 && a.closed > 0 && (!ticker || !listed.has(ticker)),
    };
  });

  /**
   * Ranked by share count moved, not by percentage.
   *
   * A manager opening a $2M position in something illiquid is an infinite
   * percentage increase and no information. Absolute shares favour the
   * companies where real size changed hands.
   */
  const bought = rows
    .filter((r) => r.netShares > 0 && r.buyers.length > 0)
    .sort((a, b) => b.netShares - a.netShares)
    .slice(0, TOP_FLOW);

  const sold = rows
    .filter((r) => r.netShares < 0 && r.sellers.length > 0 && !r.likelyDelisted)
    .sort((a, b) => a.netShares - b.netShares)
    .slice(0, TOP_FLOW);

  const delisted = rows
    .filter((r) => r.likelyDelisted)
    .sort((a, b) => a.netShares - b.netShares)
    .slice(0, TOP_FLOW);

  return { bought, sold, period, comparable, skippedStale, corporateActions, delisted };
}
