/**
 * Management guidance tracker.
 *
 * No configured provider carries structured guidance. Finnhub's free tier has
 * no guidance endpoint, and the alternative — parsing forward-looking language
 * out of earnings-call transcripts or press releases — is exactly the kind of
 * "interpret random text" the spec rules out. A mis-parsed revenue range shown
 * next to reported figures would be indistinguishable from a filed number.
 *
 * So this module ships as a working seam with no data behind it: the shapes,
 * the classification rules and the trend logic are real and tested, and
 * `GuidanceSource` is the single interface a provider has to satisfy. Until
 * one is registered, `getGuidance` returns an empty report and the UI says
 * why.
 */

export type GuidanceMetric =
  | "revenue"
  | "eps"
  | "grossMargin"
  | "operatingMargin"
  | "capex"
  | "fcf";

export const GUIDANCE_LABEL: Record<GuidanceMetric, string> = {
  revenue: "Revenue",
  eps: "EPS",
  grossMargin: "Gross Margin",
  operatingMargin: "Operating Margin",
  capex: "CapEx",
  fcf: "Free Cash Flow",
};

export type GuidanceChange = "RAISED" | "MAINTAINED" | "LOWERED" | "WITHDRAWN" | "N/A";

export interface GuidanceEntry {
  metric: GuidanceMetric;
  /** Fiscal period the guidance covers, e.g. "FY2026" or "2026 Q3". */
  period: string;
  /** When management issued it. */
  issuedAt: string;
  previous: { low: number | null; high: number | null } | null;
  current: { low: number | null; high: number | null } | null;
  change: GuidanceChange;
  /** Reported result for the period, once it exists. */
  actual: number | null;
  unit: "usd" | "pct" | "num";
}

export type GuidanceTrend = "IMPROVING" | "STABLE" | "DETERIORATING" | "N/A";

export interface GuidanceReport {
  entries: GuidanceEntry[];
  trend: GuidanceTrend;
  available: boolean;
  note: string;
}

/** Implement and register this to light the panel up. */
export interface GuidanceSource {
  name: string;
  guidance(symbol: string): Promise<GuidanceEntry[]>;
}

const SOURCES: GuidanceSource[] = [];

/** Register a provider at startup; the panel picks it up with no other change. */
export function registerGuidanceSource(source: GuidanceSource): void {
  SOURCES.push(source);
}

/** Midpoint of a guided range, for comparing one guide against the next. */
const mid = (r: { low: number | null; high: number | null } | null): number | null => {
  if (!r) return null;
  if (r.low !== null && r.high !== null) return (r.low + r.high) / 2;
  return r.low ?? r.high;
};

/** Classify a single revision from the numbers alone. */
export function classifyChange(e: Omit<GuidanceEntry, "change">): GuidanceChange {
  if (e.current === null) return e.previous ? "WITHDRAWN" : "N/A";
  const now = mid(e.current);
  const before = mid(e.previous);
  if (now === null) return "N/A";
  if (before === null) return "MAINTAINED";
  // A guide is only "raised" if it moved beyond rounding noise.
  const delta = (now - before) / Math.abs(before || 1);
  if (delta > 0.005) return "RAISED";
  if (delta < -0.005) return "LOWERED";
  return "MAINTAINED";
}

/** Direction of the most recent guidance round across all metrics. */
export function guidanceTrend(entries: GuidanceEntry[]): GuidanceTrend {
  if (!entries.length) return "N/A";
  const latest = entries[0].issuedAt;
  const round = entries.filter((e) => e.issuedAt === latest);
  const raised = round.filter((e) => e.change === "RAISED").length;
  const lowered = round.filter((e) => e.change === "LOWERED" || e.change === "WITHDRAWN").length;
  if (raised === 0 && lowered === 0) return "STABLE";
  if (raised > lowered) return "IMPROVING";
  if (lowered > raised) return "DETERIORATING";
  return "STABLE";
}

export async function getGuidance(symbol: string): Promise<GuidanceReport> {
  for (const s of SOURCES) {
    try {
      const entries = await s.guidance(symbol);
      if (entries.length) {
        return {
          entries,
          trend: guidanceTrend(entries),
          available: true,
          note: `Guidance from ${s.name}.`,
        };
      }
    } catch {
      // Try the next source rather than failing the page.
    }
  }
  return {
    entries: [],
    trend: "N/A",
    available: false,
    note: "No structured management guidance is available from the configured data providers. Guidance is deliberately not inferred from transcript or press-release text — a mis-read range shown here would be indistinguishable from a filed figure.",
  };
}
