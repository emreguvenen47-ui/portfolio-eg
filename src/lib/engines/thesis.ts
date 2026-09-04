import type { CompanySnapshot } from "@/lib/data/normalize/company";
import type { DecisionCard } from "./decision";
import type { ValuationResult } from "./valuation";
import type { ExpectationsResult } from "./expectations";
import type { FinancialStory } from "./financial-story";
import type { TechnicalDecision } from "./technical-v3";
import type { ClassifiedNews } from "./news-classify";

/**
 * QUICK THESIS — the six questions a professional asks first, answered
 * deterministically from data already computed. No model call, no invented
 * facts: every line cites a number the engines produced. Empty arrays render
 * as honest empties, never filler.
 */
export interface QuickThesis {
  bull: string[]; // ≤4
  bear: string[]; // ≤4
  whatChanged: string | null;
  marketPricing: string | null;
  mainCatalyst: string | null;
  mainRisk: string | null;
}

const pct = (v: number | null, d = 1) =>
  v === null ? null : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;
const pts = (v: number | null, d = 1) =>
  v === null ? null : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`;

export function buildThesis(args: {
  snapshot: CompanySnapshot;
  decision: DecisionCard;
  valuation: ValuationResult;
  expectations: ExpectationsResult;
  story: FinancialStory;
  technicalDecision: TechnicalDecision;
  news: ClassifiedNews[];
}): QuickThesis {
  const { snapshot: s, decision, valuation, expectations, story, technicalDecision: t, news } = args;

  const bull: string[] = [];
  const bear: string[] = [];

  // Growth
  if (s.revenueGrowthYoY !== null && s.revenueGrowthYoY > 0.1)
    bull.push(`Revenue growing ${pct(s.revenueGrowthYoY)} YoY (TTM vs prior TTM).`);
  else if (s.revenueGrowthYoY !== null && s.revenueGrowthYoY < 0)
    bear.push(`Revenue shrinking ${pct(s.revenueGrowthYoY)} YoY.`);

  // Profitability / returns
  if (s.roic !== null && s.roic > 0.15)
    bull.push(`High capital returns — ROIC ${pct(s.roic)} on reported statements.`);
  if (s.netMarginTtm !== null && s.netMarginTtm > 0.2)
    bull.push(`Net margin ${pct(s.netMarginTtm)} — strong profitability.`);
  if (s.netMarginTtm !== null && s.netMarginTtm < 0)
    bear.push(`Loss-making on a TTM basis (net margin ${pct(s.netMarginTtm)}).`);
  if (story.margins === "COMPRESSING") bear.push("Margins compressing versus a year ago.");
  if (story.margins === "EXPANDING") bull.push("Margins expanding versus a year ago.");

  // Balance sheet
  if (story.debt === "NET_CASH") bull.push("Net-cash balance sheet.");
  if (story.debt === "ELEVATED")
    bear.push(
      `Elevated leverage${s.netDebtToEbitda !== null ? ` — net debt ${s.netDebtToEbitda.toFixed(1)}× EBITDA` : ""}.`,
    );

  // Valuation
  if (valuation.verdict === "OK" && valuation.upsidePct !== null) {
    if (valuation.upsidePct > 10)
      bull.push(`Models put fair value ${pts(valuation.upsidePct)} above the price.`);
    if (valuation.upsidePct < -10)
      bear.push(`Models put fair value ${pts(valuation.upsidePct)} below the price.`);
  }
  if (s.peTtm !== null && s.peTtm > 45) bear.push(`Rich multiple — ${s.peTtm.toFixed(0)}× trailing earnings.`);

  // Street
  if (expectations.revisionScore !== null && expectations.revisionScore >= 60)
    bull.push(`Analyst estimates being revised UP (revision score ${expectations.revisionScore}/100).`);
  if (expectations.revisionScore !== null && expectations.revisionScore <= 40)
    bear.push(`Analyst estimates being revised DOWN (revision score ${expectations.revisionScore}/100).`);

  // Technical
  if (["BUY", "STRONG_BUY", "BREAKOUT_BUY", "BUY_ON_RETEST", "TACTICAL_BUY"].includes(t.signal))
    bull.push(`Technical ${t.signal.replaceAll("_", " ").toLowerCase()} — ${t.setup.replaceAll("_", " ").toLowerCase()}.`);
  if (["SELL", "REDUCE", "INVALIDATED"].includes(t.signal))
    bear.push(`Technical ${t.signal.replaceAll("_", " ").toLowerCase()}.`);

  // Recent negative/positive high-impact news
  const hi = news.filter((n) => n.impact === "HIGH");
  const negNews = hi.find((n) => n.sentiment === "NEGATIVE");
  if (negNews) bear.push(`Recent high-impact negative headline: “${negNews.title.slice(0, 80)}”.`);

  // What changed — newest quarter vs a year ago, one line.
  const q0 = s.quarterly[0] ?? null;
  const q4 = s.quarterly[4] ?? null;
  let whatChanged: string | null = null;
  if (q0?.revenue != null && q4?.revenue != null && q4.revenue > 0) {
    const g = (q0.revenue / q4.revenue - 1) * 100;
    const m0 = q0.netIncome !== null && q0.revenue > 0 ? (q0.netIncome / q0.revenue) * 100 : null;
    const m4 = q4.netIncome !== null && q4.revenue > 0 ? (q4.netIncome / q4.revenue) * 100 : null;
    whatChanged =
      `Latest quarter (${q0.date}): revenue ${g >= 0 ? "+" : ""}${g.toFixed(1)}% YoY` +
      (m0 !== null && m4 !== null
        ? `, net margin ${m0.toFixed(1)}% (${(m0 - m4) >= 0 ? "+" : ""}${(m0 - m4).toFixed(1)}pp YoY)`
        : "") +
      ".";
  }

  // What the market is pricing — implied EPS vs street forward EPS.
  let marketPricing: string | null = null;
  if (expectations.valuationImpliedEps !== null && expectations.streetForwardEps !== null) {
    const gap = expectations.expectationGapPct;
    marketPricing =
      `Price implies ~$${expectations.valuationImpliedEps.toFixed(2)} forward EPS at the fair multiple; ` +
      `street models $${expectations.streetForwardEps.toFixed(2)}` +
      (gap !== null ? ` (${gap > 0 ? "street sees MORE than priced" : "street sees LESS than priced"}, gap ${pts(gap)})` : "") +
      ".";
  } else if (s.forwardPe !== null) {
    marketPricing = `Trading at ${s.forwardPe.toFixed(1)}× next-year street EPS.`;
  }

  return {
    bull: bull.slice(0, 4),
    bear: bear.slice(0, 4),
    whatChanged,
    marketPricing,
    mainCatalyst: decision.nextCatalyst,
    mainRisk: decision.risks[0] ?? valuation.risks[0] ?? null,
  };
}
