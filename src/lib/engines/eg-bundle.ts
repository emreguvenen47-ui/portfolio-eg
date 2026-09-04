import "server-only";
import { getCompanySnapshot } from "@/lib/data/eodhd/fundamentals";
import { getClassifiedNews } from "@/lib/data/eodhd/news";
import { recordSnapshot } from "@/lib/data/snapshots";
import { buildDecisionCard, type DecisionCard } from "@/lib/engines/decision";
import { computeExpectations, type ExpectationsResult } from "@/lib/engines/expectations";
import { buildFinancialStory, type FinancialStory } from "@/lib/engines/financial-story";
import { buildTechnicalDecision, type TechnicalDecision } from "@/lib/engines/technical-v3";
import { buildFinancialsView, type FinancialsView } from "@/lib/engines/financials-view";
import { computeValuation, type ValuationResult } from "@/lib/engines/valuation";
import { buildThesis, type QuickThesis } from "@/lib/engines/thesis";
import type { ClassifiedNews } from "@/lib/engines/news-classify";
import type { CompanySnapshot } from "@/lib/data/normalize/company";
import type { Candle } from "@/lib/types";

/**
 * EG BUNDLE — every deterministic engine computed ONCE per page render, shared
 * by all ticker tabs. Null for symbols EODHD does not carry (BIST keeps the
 * legacy page). Also writes the daily time-machine snapshot.
 */
export interface EgBundle {
  snapshot: CompanySnapshot;
  price: number;
  technicalDecision: TechnicalDecision;
  valuation: ValuationResult;
  expectations: ExpectationsResult;
  decision: DecisionCard;
  story: FinancialStory;
  financialsView: FinancialsView;
  thesis: QuickThesis;
  news: ClassifiedNews[];
}

export async function buildEgBundle(
  symbol: string,
  price: number | null,
  candles: Candle[],
): Promise<EgBundle | null> {
  const snapshot = await getCompanySnapshot(symbol).catch(() => null);
  if (!snapshot) return null;

  const px = price ?? candles[candles.length - 1]?.close ?? 0;
  const technicalDecision = buildTechnicalDecision(symbol, candles);
  const valuation = computeValuation(snapshot, px);
  const fairMultiple =
    typeof valuation.assumptions.fwdMultiple === "number" ? valuation.assumptions.fwdMultiple : null;
  const expectations = computeExpectations(snapshot, px, fairMultiple);
  const decision = buildDecisionCard({
    snapshot,
    valuation,
    expectations,
    technical: technicalDecision.daily,
  });
  const story = buildFinancialStory(snapshot);
  const financialsView = buildFinancialsView(snapshot);
  const news = await getClassifiedNews(symbol, 25, snapshot.identity.name).catch(() => []);
  const thesis = buildThesis({ snapshot, decision, valuation, expectations, story, technicalDecision, news });

  // Time-machine memory: what EG believed today (once per day, never rewritten).
  recordSnapshot(symbol, {
    price: px || null,
    fairValue: decision.fairValue,
    fairLow: decision.fairLow,
    fairHigh: decision.fairHigh,
    upsidePct: decision.upsidePct,
    confidence: decision.confidence,
    consensusTarget: expectations.consensus.target,
    forwardEps: expectations.streetForwardEps,
    revisionScore: expectations.revisionScore,
    technicalState: technicalDecision.daily.state,
    primarySupport: technicalDecision.daily.primarySupport,
    primaryResistance: technicalDecision.daily.primaryResistance,
  });

  return {
    snapshot,
    price: px,
    technicalDecision,
    valuation,
    expectations,
    decision,
    story,
    financialsView,
    thesis,
    news,
  };
}
