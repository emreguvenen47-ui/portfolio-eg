import type { CompanySnapshot } from "@/lib/data/normalize/company";
import type { ValuationResult } from "./valuation";
import type { ExpectationsResult } from "./expectations";
import type { TechnicalMap } from "./technical";

/**
 * Stock Decision Card (master spec §8): one deterministic verdict assembled
 * from the four engines. Everything here is derived; nothing is invented.
 */

export type EgView = "ATTRACTIVE" | "FAIR" | "EXPENSIVE" | "HIGH_RISK" | "DATA_INCOMPLETE";

export interface DecisionCard {
  view: EgView;
  fairValue: number | null;
  fairLow: number | null;
  fairHigh: number | null;
  upsidePct: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  technicalState: TechnicalMap["state"];
  primarySupport: number | null;
  primaryResistance: number | null;
  consensusLabel: string | null;
  revisionScore: number | null;
  nextCatalyst: string | null;
  reasons: string[];
  risks: string[];
}

export function buildDecisionCard(args: {
  snapshot: CompanySnapshot | null;
  valuation: ValuationResult;
  expectations: ExpectationsResult;
  technical: TechnicalMap;
}): DecisionCard {
  const { snapshot, valuation, expectations, technical } = args;

  const consensus = expectations.consensus;
  const totalAnalysts = [consensus.strongBuy, consensus.buy, consensus.hold, consensus.sell, consensus.strongSell]
    .reduce<number>((a, v) => a + (v ?? 0), 0);
  const consensusLabel =
    totalAnalysts > 0 && consensus.rating !== null
      ? `${consensus.rating >= 4 ? "Buy" : consensus.rating >= 3 ? "Hold" : "Sell"}-leaning (${consensus.rating.toFixed(1)}/5, ${totalAnalysts} analysts)`
      : null;

  // Next catalyst: the next unreported estimate period end, if known.
  const today = new Date().toISOString().slice(0, 10);
  const nextPeriod = snapshot?.forwardEstimates.find((e) => e.periodEnd > today)?.periodEnd ?? null;
  const nextCatalyst = nextPeriod ? `Results for period ending ${nextPeriod}` : null;

  if (valuation.verdict === "INVALID") {
    return {
      view: "DATA_INCOMPLETE",
      fairValue: null, fairLow: null, fairHigh: null, upsidePct: null,
      confidence: "LOW",
      technicalState: technical.state,
      primarySupport: technical.primarySupport,
      primaryResistance: technical.primaryResistance,
      consensusLabel,
      revisionScore: expectations.revisionScore,
      nextCatalyst,
      reasons: [],
      risks: [valuation.invalidReason ?? "Valuation could not be computed"],
    };
  }

  const upside = valuation.upsidePct ?? 0;
  const riskFlags =
    (snapshot?.meta.confidence === "LOW" ? 1 : 0) +
    (snapshot?.netDebtToEbitda !== null && snapshot !== null && (snapshot.netDebtToEbitda ?? 0) > 4 ? 1 : 0) +
    (technical.trend === "DOWNTREND" || technical.trend === "BREAKDOWN" ? 1 : 0);

  const view: EgView =
    riskFlags >= 2 ? "HIGH_RISK"
    : upside >= 15 ? "ATTRACTIVE"
    : upside <= -15 ? "EXPENSIVE"
    : "FAIR";

  return {
    view,
    fairValue: valuation.base,
    fairLow: valuation.bear,
    fairHigh: valuation.bull,
    upsidePct: valuation.upsidePct,
    confidence: valuation.confidence,
    technicalState: technical.state,
    primarySupport: technical.primarySupport,
    primaryResistance: technical.primaryResistance,
    consensusLabel,
    revisionScore: expectations.revisionScore,
    nextCatalyst,
    reasons: valuation.reasons,
    risks: valuation.risks,
  };
}
