/**
 * Data confidence.
 *
 * A single deterministic grade per research panel, so the reader can tell a
 * figure lifted from a filing apart from one inferred by a model — without
 * having to remember which panel is which.
 *
 * Three inputs, all cheap: how authoritative the source is, how fresh the data
 * is relative to how fast it changes, and how much of the panel actually has
 * data. No model, no network.
 *
 * One rule is absolute: an AI-generated block can never reach HIGH. Confidence
 * here means confidence in the *provenance* of a number, and a model's output
 * has no provenance regardless of how plausible it reads.
 */

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export type SourceAuthority =
  | "filing" // SEC / KAP / Form 4 — the company's own regulatory submission
  | "official" // a statistical agency or central bank
  | "exchange" // exchange or market-data vendor prices
  | "vendor" // third-party aggregation of the above
  | "market-implied" // prediction or derivatives pricing
  | "inferred"; // computed heuristic
// `ai` is deliberately absent from the union used for factual panels; it has
// its own constructor below so it cannot be passed by accident.

export interface ConfidenceInput {
  authority: SourceAuthority;
  /** When the underlying data was produced. */
  asOf?: string | null;
  /** How long this kind of data stays current, in days. */
  freshnessWindowDays?: number;
  /** Fields with data over fields attempted. */
  coverage?: { have: number; total: number };
}

export interface ConfidenceReport {
  level: Confidence;
  /** One line the UI puts in a tooltip. */
  why: string;
  /** Rendered next to the badge where the panel has room. */
  asOf: string | null;
  isDelayed: boolean;
}

const AUTHORITY_SCORE: Record<SourceAuthority, number> = {
  filing: 3,
  official: 3,
  exchange: 2,
  vendor: 2,
  "market-implied": 1,
  inferred: 1,
};

const AUTHORITY_LABEL: Record<SourceAuthority, string> = {
  filing: "regulatory filing",
  official: "official statistical source",
  exchange: "exchange or market data",
  vendor: "third-party vendor",
  "market-implied": "market-implied pricing",
  inferred: "computed from other figures",
};

export function assessConfidence(input: ConfidenceInput): ConfidenceReport {
  const { authority, asOf = null, freshnessWindowDays, coverage } = input;

  let score = AUTHORITY_SCORE[authority];
  const reasons: string[] = [AUTHORITY_LABEL[authority]];

  // --- freshness
  let isDelayed = false;
  if (asOf && freshnessWindowDays) {
    const ageDays = (Date.now() - Date.parse(asOf)) / 86_400_000;
    if (Number.isFinite(ageDays)) {
      if (ageDays > freshnessWindowDays * 3) {
        score -= 2;
        isDelayed = true;
        reasons.push(`${Math.round(ageDays)} days old, well past its usual cadence`);
      } else if (ageDays > freshnessWindowDays) {
        score -= 1;
        isDelayed = true;
        reasons.push(`${Math.round(ageDays)} days old`);
      } else {
        reasons.push("current");
      }
    }
  }

  // --- coverage
  if (coverage && coverage.total > 0) {
    const ratio = coverage.have / coverage.total;
    if (ratio < 0.4) {
      score -= 2;
      reasons.push(`only ${coverage.have} of ${coverage.total} fields populated`);
    } else if (ratio < 0.75) {
      score -= 1;
      reasons.push(`${coverage.have} of ${coverage.total} fields populated`);
    } else {
      reasons.push(`${coverage.have} of ${coverage.total} fields populated`);
    }
  }

  const level: Confidence = score >= 3 ? "HIGH" : score >= 1 ? "MEDIUM" : "LOW";
  return { level, why: reasons.join("; "), asOf, isDelayed };
}

/**
 * Confidence for a model-generated block.
 *
 * Capped at MEDIUM by construction and usually LOW. This is a separate
 * function rather than an `authority: "ai"` value so no caller can hand a
 * model's output to `assessConfidence` and get HIGH back.
 */
export function aiConfidence(groundedInFacts: boolean): ConfidenceReport {
  return {
    level: groundedInFacts ? "MEDIUM" : "LOW",
    why: groundedInFacts
      ? "model reasoning over figures computed in this terminal; the reasoning itself is not sourced"
      : "model reasoning with no verified figures behind it",
    asOf: null,
    isDelayed: false,
  };
}

/** Ready-made assessments for the panels that always have the same provenance. */
export const PANEL_CONFIDENCE = {
  financials: (asOf: string | null, have: number, total: number) =>
    assessConfidence({
      authority: "filing",
      asOf,
      // Quarterly filings; stale after about four months.
      freshnessWindowDays: 120,
      coverage: { have, total },
    }),
  insiders: (asOf: string | null) =>
    assessConfidence({ authority: "filing", asOf, freshnessWindowDays: 30 }),
  ownership13f: (asOf: string | null) =>
    assessConfidence({ authority: "filing", asOf, freshnessWindowDays: 45 }),
  etfHoldings: (asOf: string | null) =>
    assessConfidence({ authority: "filing", asOf, freshnessWindowDays: 3 }),
  economicRelease: (asOf: string | null) =>
    assessConfidence({ authority: "official", asOf, freshnessWindowDays: 45 }),
  prices: (delayed: boolean) =>
    assessConfidence({ authority: delayed ? "vendor" : "exchange" }),
  analysts: (have: number, total: number) =>
    assessConfidence({ authority: "vendor", coverage: { have, total } }),
  predictionMarket: () => assessConfidence({ authority: "market-implied" }),
  heuristic: (have: number, total: number) =>
    assessConfidence({ authority: "inferred", coverage: { have, total } }),
  contracts: (asOf: string | null) =>
    assessConfidence({ authority: "official", asOf, freshnessWindowDays: 90 }),
} as const;
