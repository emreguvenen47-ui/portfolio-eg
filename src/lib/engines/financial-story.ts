import type { CompanySnapshot } from "@/lib/data/normalize/company";
import { sumComplete, yoyGrowth } from "@/lib/data/normalize/company";

/**
 * FINANCIAL STORY (master spec §9) — deterministic trend labels for the
 * simple Financials view. The AI may narrate these; it may not change them.
 */

export type TrendWord = "ACCELERATING" | "STABLE" | "SLOWING" | "N/A";
export type MarginWord = "EXPANDING" | "STABLE" | "COMPRESSING" | "N/A";
export type StrengthWord = "STRONG" | "ADEQUATE" | "WEAK" | "N/A";
export type DebtWord = "LOW" | "MANAGEABLE" | "ELEVATED" | "NET_CASH" | "N/A";

export interface FinancialStory {
  revenue: TrendWord;
  margins: MarginWord;
  eps: TrendWord;
  fcf: StrengthWord;
  debt: DebtWord;
  overall: "IMPROVING" | "STABLE" | "DETERIORATING" | "N/A";
}

function ttmAt(rows: Array<number | null>, offset: number): number | null {
  return sumComplete(rows.slice(offset), 4);
}

export function buildFinancialStory(s: CompanySnapshot | null): FinancialStory {
  const na: FinancialStory = { revenue: "N/A", margins: "N/A", eps: "N/A", fcf: "N/A", debt: "N/A", overall: "N/A" };
  if (!s || s.quarterly.length < 8) return na;

  const rev = s.quarterly.map((q) => q.revenue);
  const ni = s.quarterly.map((q) => q.netIncome);

  const revNow = ttmAt(rev, 0);
  const revPrev = ttmAt(rev, 4);
  const revPrev2 = s.quarterly.length >= 12 ? ttmAt(rev, 8) : null;
  const gNow = yoyGrowth(revNow, revPrev);
  const gPrev = yoyGrowth(revPrev, revPrev2);

  const revenue: TrendWord =
    gNow === null ? "N/A"
    : gPrev === null ? (gNow > 0.02 ? "ACCELERATING" : gNow < -0.02 ? "SLOWING" : "STABLE")
    : gNow > gPrev + 0.02 ? "ACCELERATING"
    : gNow < gPrev - 0.02 ? "SLOWING"
    : "STABLE";

  const marginNow = revNow && revNow > 0 && ttmAt(ni, 0) !== null ? ttmAt(ni, 0)! / revNow : null;
  const marginPrev = revPrev && revPrev > 0 && ttmAt(ni, 4) !== null ? ttmAt(ni, 4)! / revPrev : null;
  const margins: MarginWord =
    marginNow === null || marginPrev === null ? "N/A"
    : marginNow > marginPrev + 0.01 ? "EXPANDING"
    : marginNow < marginPrev - 0.01 ? "COMPRESSING"
    : "STABLE";

  const niNow = ttmAt(ni, 0);
  const niPrev = ttmAt(ni, 4);
  const eGrowth = yoyGrowth(niNow, niPrev);
  const eps: TrendWord =
    eGrowth === null ? "N/A" : eGrowth > 0.05 ? "ACCELERATING" : eGrowth < -0.05 ? "SLOWING" : "STABLE";

  const fcf: StrengthWord =
    s.freeCashFlowTtm === null || s.revenueTtm === null || s.revenueTtm <= 0 ? "N/A"
    : s.freeCashFlowTtm / s.revenueTtm > 0.12 ? "STRONG"
    : s.freeCashFlowTtm > 0 ? "ADEQUATE"
    : "WEAK";

  const debt: DebtWord =
    s.netDebt === null ? "N/A"
    : s.netDebt < 0 ? "NET_CASH"
    : s.netDebtToEbitda === null ? "MANAGEABLE"
    : s.netDebtToEbitda < 1 ? "LOW"
    : s.netDebtToEbitda < 3 ? "MANAGEABLE"
    : "ELEVATED";

  const goodness =
    (revenue === "ACCELERATING" ? 1 : revenue === "SLOWING" ? -1 : 0) +
    (margins === "EXPANDING" ? 1 : margins === "COMPRESSING" ? -1 : 0) +
    (eps === "ACCELERATING" ? 1 : eps === "SLOWING" ? -1 : 0) +
    (fcf === "STRONG" ? 1 : fcf === "WEAK" ? -1 : 0) +
    (debt === "ELEVATED" ? -1 : 0);

  return {
    revenue, margins, eps, fcf, debt,
    overall: goodness >= 2 ? "IMPROVING" : goodness <= -2 ? "DETERIORATING" : "STABLE",
  };
}
