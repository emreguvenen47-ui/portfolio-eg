import type { CompanySnapshot } from "@/lib/data/normalize/company";

/**
 * Expectations Engine (master spec §18–19).
 *
 * Deterministic: revision score and expectation gap from validated snapshot
 * data. No fabricated analyst detail; when inputs are missing the outputs are
 * null, and the UI renders N/A.
 */

export interface ExpectationsResult {
  symbol: string;
  /** 0–100. >50 = expectations improving. Null when inputs missing. */
  revisionScore: number | null;
  revisionParts: string[];
  streetForwardEps: number | null;
  /** EPS the current price implies at the blended fair multiple. */
  valuationImpliedEps: number | null;
  /** (street − implied) / implied. Positive = street sees more than priced. */
  expectationGapPct: number | null;
  gapReading: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  consensus: {
    rating: number | null;
    target: number | null;
    strongBuy: number | null;
    buy: number | null;
    hold: number | null;
    sell: number | null;
    strongSell: number | null;
  };
}

export function computeExpectations(
  s: CompanySnapshot | null,
  price: number,
  fairMultiple: number | null,
): ExpectationsResult {
  const empty: ExpectationsResult = {
    symbol: s?.identity.symbol ?? "?",
    revisionScore: null,
    revisionParts: [],
    streetForwardEps: null,
    valuationImpliedEps: null,
    expectationGapPct: null,
    gapReading: null,
    consensus: {
      rating: null, target: null, strongBuy: null, buy: null, hold: null, sell: null, strongSell: null,
    },
  };
  if (!s) return empty;

  const consensus = {
    rating: s.analystRating,
    target: s.analystTargetPrice,
    ...s.analystCounts,
  };

  // ---------------------------------------------------------- revision score
  // Components (each mapped to 0..1, then weighted):
  //  A) surprise track record: mean of last 4 surprise%
  //  B) forward growth: nextY vs currentY street EPS
  //  C) rating strength: (buys − sells) / total
  const parts: string[] = [];
  let score: number | null = null;
  const comp: number[] = [];
  const weights: number[] = [];

  const surprises = s.earningsHistory.slice(0, 4).map((e) => e.surprisePct).filter((v): v is number => v !== null);
  if (surprises.length >= 2) {
    const mean = surprises.reduce((a, b) => a + b, 0) / surprises.length;
    comp.push(Math.max(0, Math.min(1, 0.5 + mean / 20))); // ±10% surprise → 0..1
    weights.push(0.35);
    parts.push(`Avg EPS surprise ${mean.toFixed(1)}% (last ${surprises.length})`);
  }

  if (s.epsEstimateCurrentYear !== null && s.epsEstimateNextYear !== null && s.epsEstimateCurrentYear > 0) {
    const g = s.epsEstimateNextYear / s.epsEstimateCurrentYear - 1;
    comp.push(Math.max(0, Math.min(1, 0.5 + g / 0.6))); // ±30% growth → 0..1
    weights.push(0.4);
    parts.push(`Street EPS growth ${(g * 100).toFixed(0)}% (FY+1 vs FY)`);
  }

  const c = s.analystCounts;
  const total = [c.strongBuy, c.buy, c.hold, c.sell, c.strongSell].reduce<number>((a, v) => a + (v ?? 0), 0);
  if (total >= 5) {
    const net = ((c.strongBuy ?? 0) + (c.buy ?? 0) - (c.sell ?? 0) - (c.strongSell ?? 0)) / total;
    comp.push(Math.max(0, Math.min(1, 0.5 + net / 2)));
    weights.push(0.25);
    parts.push(`Rating skew ${(net * 100).toFixed(0)}% net buy (${total} analysts)`);
  }

  if (comp.length > 0) {
    const wsum = weights.reduce((a, b) => a + b, 0);
    score = Math.round(comp.reduce((a, v, i) => a + v * (weights[i]! / wsum), 0) * 100);
  }

  // ---------------------------------------------------------- expectation gap
  const streetFwd = s.epsEstimateNextYear ?? s.epsEstimateCurrentYear;
  let impliedEps: number | null = null;
  let gapPct: number | null = null;
  let reading: ExpectationsResult["gapReading"] = null;
  if (streetFwd !== null && fairMultiple !== null && fairMultiple > 0 && price > 0) {
    impliedEps = price / fairMultiple;
    if (impliedEps > 0) {
      gapPct = ((streetFwd - impliedEps) / impliedEps) * 100;
      reading = gapPct > 8 ? "POSITIVE" : gapPct < -8 ? "NEGATIVE" : "NEUTRAL";
    }
  }

  return {
    symbol: s.identity.symbol,
    revisionScore: score,
    revisionParts: parts,
    streetForwardEps: streetFwd,
    valuationImpliedEps: impliedEps !== null ? Number(impliedEps.toFixed(2)) : null,
    expectationGapPct: gapPct !== null ? Number(gapPct.toFixed(1)) : null,
    gapReading: reading,
    consensus,
  };
}
