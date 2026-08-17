import "server-only";

/**
 * Institutional ownership (13F).
 *
 * Status on this deployment: no source. Finnhub's `/stock/ownership` and
 * `/stock/fund-ownership` are not on this plan. SEC EDGAR is reachable and
 * free, but answering "who owns NVDA" from it means reverse-indexing every
 * 13F-HR filed in a quarter — thousands of documents — which is a data
 * pipeline, not a provider call.
 *
 * The seam below is complete and the UI states the gap. Register an
 * `OwnershipSource` and the panels fill in.
 *
 * One rule is baked into the types rather than left to the UI: 13F data is a
 * quarterly snapshot filed up to 45 days after the period ends. `asOf` and
 * `filedAt` are required, not optional, so nothing can render an institutional
 * position without saying how stale it is.
 */

export type PositionChange = "NEW POSITION" | "INCREASED" | "UNCHANGED" | "REDUCED" | "SOLD OUT";

export interface InstitutionalHolder {
  name: string;
  shares: number;
  /** Percent of shares outstanding, when the source carries it. */
  ownershipPct: number | null;
  value: number | null;
  /** Quarter end the filing describes — NOT the filing date. */
  asOf: string;
  /** When it was actually filed, which is what makes it stale. */
  filedAt: string;
  sharesPrior: number | null;
  change: PositionChange;
  changeShares: number | null;
}

export interface OwnershipBreakdown {
  /** Percent of shares outstanding held by institutions. */
  institutional: number | null;
  etf: number | null;
  insider: number | null;
}

export interface OwnershipReport {
  holders: InstitutionalHolder[];
  breakdown: OwnershipBreakdown;
  /** Most recent quarter end represented. */
  reportingPeriod: string | null;
  latestFiling: string | null;
  available: boolean;
  note: string;
}

export interface OwnershipSource {
  name: string;
  ownership(symbol: string): Promise<{
    holders: InstitutionalHolder[];
    breakdown: OwnershipBreakdown;
  } | null>;
}

/**
 * Registered sources, on globalThis.
 *
 * A plain module array does not survive here: Next hands Server Components and
 * Route Handlers separate instances of the same module, so registration ran in
 * one copy and every lookup read an empty array in another. The symptom was a
 * source that worked perfectly when called directly and reported "not
 * configured" through the normal path — which reads as missing data rather
 * than as a wiring fault.
 */
const SOURCES_KEY = Symbol.for("pcc.ownership.sources");
const SOURCES: OwnershipSource[] = ((globalThis as unknown as Record<symbol, OwnershipSource[]>)[
  SOURCES_KEY
] ??= []);

export function registerOwnershipSource(s: OwnershipSource): void {
  // Registration now runs once per module instance rather than once per
  // process, so the same source arrives more than once. Keyed by name so a
  // second copy replaces rather than duplicates.
  if (SOURCES.some((x) => x.name === s.name)) return;
  SOURCES.push(s);
}

export const hasOwnershipSource = (): boolean => SOURCES.length > 0;

const UNAVAILABLE_NOTE =
  "No institutional ownership source is configured. 13F holdings are not on the current data plan, and reconstructing them from SEC EDGAR requires indexing every 13F-HR filed each quarter. Insider ownership below comes from Form 4 filings and is real.";

/** Classify a change from the two share counts alone. */
export function classifyChange(shares: number, prior: number | null): PositionChange {
  if (prior === null) return "NEW POSITION";
  if (shares === 0) return "SOLD OUT";
  if (prior === 0) return "NEW POSITION";
  const delta = (shares - prior) / prior;
  // Sub-1% moves are filing noise, not a decision.
  if (Math.abs(delta) < 0.01) return "UNCHANGED";
  return delta > 0 ? "INCREASED" : "REDUCED";
}

export type OwnershipTrend = "ACCUMULATING" | "STABLE" | "DISTRIBUTING" | "N/A";

export interface OwnershipRadar {
  increased: number;
  reduced: number;
  newPositions: number;
  exited: number;
  trend: OwnershipTrend;
  why: string;
}

/**
 * Ownership change radar.
 *
 * Counts filings, never absences. An institution that did not file this
 * quarter has not necessarily sold — it may be below the reporting threshold,
 * or late. Treating a missing filing as an exit is the classic way to
 * manufacture a "distribution" signal that never happened, so only explicit
 * SOLD OUT rows count as exits.
 */
export function radar(holders: InstitutionalHolder[]): OwnershipRadar {
  if (holders.length === 0) {
    return {
      increased: 0,
      reduced: 0,
      newPositions: 0,
      exited: 0,
      trend: "N/A",
      why: "No institutional filings available for this symbol.",
    };
  }

  const increased = holders.filter((h) => h.change === "INCREASED").length;
  const reduced = holders.filter((h) => h.change === "REDUCED").length;
  const newPositions = holders.filter((h) => h.change === "NEW POSITION").length;
  const exited = holders.filter((h) => h.change === "SOLD OUT").length;

  const buyers = increased + newPositions;
  const sellers = reduced + exited;
  const decided = buyers + sellers;

  let trend: OwnershipTrend = "STABLE";
  let why = "Increases and reductions were broadly balanced across filers this quarter.";
  if (decided >= 5) {
    if (buyers >= sellers * 1.5) {
      trend = "ACCUMULATING";
      why = `${buyers} filers added or opened positions against ${sellers} trimming or exiting.`;
    } else if (sellers >= buyers * 1.5) {
      trend = "DISTRIBUTING";
      why = `${sellers} filers trimmed or exited against ${buyers} adding or opening.`;
    } else {
      why = `${buyers} filers added against ${sellers} reducing — no clear direction.`;
    }
  } else {
    trend = "N/A";
    why = `Only ${decided} filers changed position; too few to call a direction.`;
  }

  return { increased, reduced, newPositions, exited, trend, why };
}

export async function getOwnership(symbol: string): Promise<OwnershipReport> {
  for (const s of SOURCES) {
    try {
      const r = await s.ownership(symbol);
      if (r && r.holders.length) {
        const periods = r.holders.map((h) => h.asOf).sort();
        const filings = r.holders.map((h) => h.filedAt).sort();
        return {
          holders: r.holders,
          breakdown: r.breakdown,
          reportingPeriod: periods.at(-1) ?? null,
          latestFiling: filings.at(-1) ?? null,
          available: true,
          note: `Institutional holdings from ${s.name}. 13F filings are a quarterly snapshot, filed up to 45 days after quarter end — this is a delayed record of past positioning, not current positioning.`,
        };
      }
    } catch {
      // Try the next source.
    }
  }

  return {
    holders: [],
    breakdown: { institutional: null, etf: null, insider: null },
    reportingPeriod: null,
    latestFiling: null,
    available: false,
    note: UNAVAILABLE_NOTE,
  };
}
