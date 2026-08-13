import type { Sector } from "@/lib/scanner/types";
import { METRIC_BY_KEY, metricApplies, type MetricKey, type Row } from "./metrics";

/**
 * Filter evaluation for the custom screener.
 *
 * Two rules carry the whole design:
 *
 * 1. A company with no value for a filtered metric FAILS that criterion. It is
 *    not quietly admitted. "EV/EBITDA below 10" cannot be satisfied by a
 *    company whose EV/EBITDA is unknown, and letting it through would fill a
 *    value screen with companies nobody measured.
 *
 * 2. A metric that does not apply to a company's sector is SKIPPED, not
 *    failed. A bank has no EV/EBITDA to compare, so a screen containing that
 *    criterion does not silently exclude every bank — it just does not test
 *    them on it. `reason` records which happened, so the UI can tell a genuine
 *    miss from a not-applicable.
 */

export type Comparator = "lt" | "lte" | "gt" | "gte" | "between";

/** What the threshold is measured against. */
export type Basis = "absolute" | "sectorMedian" | "industryMedian" | "sectorPercentile" | "industryPercentile";

export interface Criterion {
  id: string;
  metric: MetricKey;
  comparator: Comparator;
  basis: Basis;
  /** For `absolute`: the raw threshold. For percentile bases: 0..100. */
  value: number | null;
  /** Upper bound for `between`. */
  value2: number | null;
  enabled: boolean;
}

export type Combinator = "AND" | "OR";

export interface Screen {
  id: string;
  name: string;
  combinator: Combinator;
  criteria: Criterion[];
}

/** Medians and distributions per peer group, computed from the candidate set. */
export interface Aggregates {
  sectorMedian: Map<string, Partial<Record<MetricKey, number>>>;
  industryMedian: Map<string, Partial<Record<MetricKey, number>>>;
  sectorValues: Map<string, Partial<Record<MetricKey, number[]>>>;
  industryValues: Map<string, Partial<Record<MetricKey, number[]>>>;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Minimum members before a median is a median rather than a coincidence. */
export const MIN_AGG_SAMPLE = 5;

export interface Enriched {
  symbol: string;
  sector: Sector;
  industry: string | null;
  row: Row;
}

export function buildAggregates(rows: Enriched[], keys: MetricKey[]): Aggregates {
  const bySector = new Map<string, Enriched[]>();
  const byIndustry = new Map<string, Enriched[]>();
  for (const r of rows) {
    bySector.set(r.sector, [...(bySector.get(r.sector) ?? []), r]);
    if (r.industry) byIndustry.set(r.industry, [...(byIndustry.get(r.industry) ?? []), r]);
  }

  const build = (groups: Map<string, Enriched[]>) => {
    const medians = new Map<string, Partial<Record<MetricKey, number>>>();
    const values = new Map<string, Partial<Record<MetricKey, number[]>>>();
    for (const [label, members] of groups) {
      const m: Partial<Record<MetricKey, number>> = {};
      const v: Partial<Record<MetricKey, number[]>> = {};
      for (const k of keys) {
        const xs = members
          .map((x) => x.row[k])
          .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
        if (xs.length >= MIN_AGG_SAMPLE) {
          v[k] = xs.sort((a, b) => a - b);
          const md = median(xs);
          if (md !== null) m[k] = md;
        }
      }
      medians.set(label, m);
      values.set(label, v);
    }
    return { medians, values };
  };

  const s = build(bySector);
  const i = build(byIndustry);
  return {
    sectorMedian: s.medians,
    sectorValues: s.values,
    industryMedian: i.medians,
    industryValues: i.values,
  };
}

export type CriterionOutcome = "PASS" | "FAIL" | "NOT_APPLICABLE" | "NO_DATA" | "NO_PEERS";

export interface CriterionResult {
  criterion: Criterion;
  outcome: CriterionOutcome;
  /** The candidate's own value. */
  value: number | null;
  /** The threshold it was tested against, after resolving the basis. */
  threshold: number | null;
}

function percentileOf(sorted: number[], v: number): number {
  if (sorted.length < 2) return 50;
  const below = sorted.filter((x) => x < v).length;
  return (below / (sorted.length - 1)) * 100;
}

/** Resolve a criterion's threshold into an absolute number for this candidate. */
function resolveThreshold(
  c: Criterion,
  e: Enriched,
  agg: Aggregates,
): { threshold: number | null; missingPeers: boolean } {
  if (c.basis === "absolute") return { threshold: c.value, missingPeers: false };

  if (c.basis === "sectorMedian" || c.basis === "industryMedian") {
    const table = c.basis === "sectorMedian" ? agg.sectorMedian : agg.industryMedian;
    const key = c.basis === "sectorMedian" ? e.sector : (e.industry ?? "");
    const med = table.get(key)?.[c.metric];
    if (med === undefined) return { threshold: null, missingPeers: true };
    // `value` acts as a multiplier when set, so "P/E < 0.8 × sector median" is
    // expressible; left null it is the plain median.
    return { threshold: c.value === null ? med : med * c.value, missingPeers: false };
  }

  // Percentile bases compare the candidate's own percentile, so the threshold
  // is the percentile itself and the comparison happens on that scale.
  return { threshold: c.value, missingPeers: false };
}

function compare(c: Comparator, v: number, t: number, t2: number | null): boolean {
  switch (c) {
    case "lt":
      return v < t;
    case "lte":
      return v <= t;
    case "gt":
      return v > t;
    case "gte":
      return v >= t;
    case "between":
      return t2 !== null && v >= t && v <= t2;
  }
}

export function evaluateCriterion(
  c: Criterion,
  e: Enriched,
  agg: Aggregates,
): CriterionResult {
  const def = METRIC_BY_KEY.get(c.metric);
  if (!def) return { criterion: c, outcome: "NOT_APPLICABLE", value: null, threshold: null };

  // Not meaningful for this business — skipped rather than failed.
  if (!metricApplies(def, e.sector)) {
    return { criterion: c, outcome: "NOT_APPLICABLE", value: null, threshold: null };
  }

  const raw = e.row[c.metric];
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;

  // Applies but unknown: a real miss. Never admitted.
  if (value === null) return { criterion: c, outcome: "NO_DATA", value: null, threshold: null };

  if (c.basis === "sectorPercentile" || c.basis === "industryPercentile") {
    const table = c.basis === "sectorPercentile" ? agg.sectorValues : agg.industryValues;
    const key = c.basis === "sectorPercentile" ? e.sector : (e.industry ?? "");
    const dist = table.get(key)?.[c.metric];
    if (!dist) return { criterion: c, outcome: "NO_PEERS", value, threshold: c.value };

    let pct = percentileOf(dist, value);
    // Percentiles are stated as "better", so a lower-is-better metric inverts:
    // "valuation in the bottom 30%" means cheap, which is a high percentile on
    // the goodness scale.
    if (def.higherIsBetter === false) pct = 100 - pct;
    const ok = c.value !== null && compare(c.comparator, pct, c.value, c.value2);
    return { criterion: c, outcome: ok ? "PASS" : "FAIL", value: pct, threshold: c.value };
  }

  const { threshold, missingPeers } = resolveThreshold(c, e, agg);
  if (missingPeers) return { criterion: c, outcome: "NO_PEERS", value, threshold: null };
  if (threshold === null) return { criterion: c, outcome: "NO_DATA", value, threshold: null };

  const ok = compare(c.comparator, value, threshold, c.value2);
  return { criterion: c, outcome: ok ? "PASS" : "FAIL", value, threshold };
}

export interface MatchResult {
  matched: boolean;
  results: CriterionResult[];
  /**
   * Criteria that counted, i.e. everything except the not-applicable ones.
   * The honest denominator: a criterion we could not resolve still counted
   * against the candidate, it was not quietly forgiven.
   */
  tested: number;
}

/**
 * Evaluate a whole screen.
 *
 * Under AND, every tested criterion must pass. Under OR, at least one must.
 *
 * NOT_APPLICABLE is the ONLY outcome that drops out of the count. A bank has
 * no EV/EBITDA to compare, so the criterion is meaningless for it and testing
 * it would be wrong. Everything else counts against the candidate:
 *
 * - NO_DATA — the metric applies, we just don't know it. Not admitted.
 * - NO_PEERS — the metric applies and we know it, but the peer group is too
 *   thin to give the threshold a meaning. Also not admitted: dropping it would
 *   quietly turn a two-criterion screen into a one-criterion screen and return
 *   rows verified on half of what was asked.
 *
 * A candidate that could not be tested on ANYTHING does not match, because
 * "no criterion could be applied" is not the same as "it satisfies your screen".
 */
export function evaluateScreen(screen: Screen, e: Enriched, agg: Aggregates): MatchResult {
  const active = screen.criteria.filter((c) => c.enabled);
  if (active.length === 0) return { matched: true, results: [], tested: 0 };

  const results = active.map((c) => evaluateCriterion(c, e, agg));
  const testable = results.filter((r) => r.outcome !== "NOT_APPLICABLE");

  if (testable.length === 0) return { matched: false, results, tested: 0 };

  const passes = testable.filter((r) => r.outcome === "PASS").length;
  const matched =
    screen.combinator === "AND" ? passes === testable.length : passes > 0;

  return { matched, results, tested: testable.length };
}

/** Metrics a screen actually reads, so enrichment can prioritise them. */
export const metricsInScreen = (screen: Screen): MetricKey[] => [
  ...new Set(screen.criteria.filter((c) => c.enabled).map((c) => c.metric)),
];
