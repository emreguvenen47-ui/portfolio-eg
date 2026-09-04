import type { CompanySnapshot } from "@/lib/data/normalize/company";
import type { ClassifiedNews } from "./news-classify";
import type { ExpectationsResult } from "./expectations";

/**
 * STREET VIEW — WHY the consensus says what it says, reconstructed
 * deterministically from the same evidence an analyst note cites: the counts,
 * the target math, the fundamental drivers in the filings, and the actual
 * analyst-action headlines (quoted with dates). No model invents a motive; a
 * driver appears here only when the number behind it clears its bar.
 */

export interface StreetView {
  stance: string; // one-line read of the consensus
  bullDrivers: string[]; // fundamentals the buy side leans on
  bearDrivers: string[]; // what the holds/sells point at
  actions: Array<{ title: string; date: string; url: string; sentiment: string }>;
  targetMath: string | null;
}

const pc = (v: number, d = 0) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;

export function buildStreetView(
  s: CompanySnapshot,
  news: ClassifiedNews[],
  ex: ExpectationsResult,
  price: number,
): StreetView {
  const c = s.analystCounts;
  const buys = (c.strongBuy ?? 0) + (c.buy ?? 0);
  const holds = c.hold ?? 0;
  const sells = (c.sell ?? 0) + (c.strongSell ?? 0);
  const total = buys + holds + sells;

  const stance =
    total === 0
      ? "No graded consensus available for this name."
      : `${buys}/${total} analysts are at Buy or better (${holds} Hold, ${sells} Sell)${
          s.analystRating !== null ? ` — average rating ${s.analystRating.toFixed(1)}/5` : ""
        }${ex.revisionScore !== null ? `, and estimates are being revised ${ex.revisionScore >= 55 ? "UP" : ex.revisionScore <= 45 ? "DOWN" : "sideways"} (revision score ${ex.revisionScore}/100)` : ""}.`;

  const bull: string[] = [];
  const bear: string[] = [];

  // Fundamental drivers — each cites its own number.
  if (s.revenueGrowthYoY !== null && s.revenueGrowthYoY > 0.08)
    bull.push(`Top-line is compounding: revenue ${pc(s.revenueGrowthYoY, 1)} YoY — growth stories keep price targets moving up.`);
  if (s.epsEstimateNextYear !== null && s.epsTtm !== null && s.epsTtm > 0 && s.epsEstimateNextYear > s.epsTtm * 1.1)
    bull.push(`The street models EPS $${s.epsEstimateNextYear.toFixed(2)} next FY vs $${s.epsTtm.toFixed(2)} trailing (${pc(s.epsEstimateNextYear / s.epsTtm - 1)}) — forward earnings power anchors the Buy case.`);
  if (s.grossMarginTtm !== null && s.grossMarginTtm > 0.5)
    bull.push(`Gross margin ${(s.grossMarginTtm * 100).toFixed(0)}% — pricing power the models capitalize at a premium multiple.`);
  if (s.roic !== null && s.roic > 0.2)
    bull.push(`ROIC ${(s.roic * 100).toFixed(0)}% on reported statements — capital returns well above any cost of capital.`);
  if (s.fcfYield !== null && s.fcfYield > 0.045)
    bull.push(`FCF yield ${(s.fcfYield * 100).toFixed(1)}% funds buybacks/dividends without leverage.`);
  if (s.netDebt !== null && s.netDebt < 0) bull.push("Net-cash balance sheet removes financing risk from the thesis.");

  if (s.peTtm !== null && s.peTtm > 35)
    bear.push(`${s.peTtm.toFixed(0)}× trailing earnings — the Holds argue the story is already paid for.`);
  if (s.revenueGrowthYoY !== null && s.revenueGrowthYoY < 0.02)
    bear.push(`Revenue ${pc(s.revenueGrowthYoY, 1)} YoY — without growth, multiple expansion is the only driver left.`);
  if (s.netDebtToEbitda !== null && s.netDebtToEbitda > 2.5)
    bear.push(`Leverage ${s.netDebtToEbitda.toFixed(1)}× net debt/EBITDA limits flexibility in a downturn.`);
  if (ex.revisionScore !== null && ex.revisionScore <= 45)
    bear.push("Estimate revisions point down — targets usually follow estimates, not the other way.");
  if (ex.expectationGapPct !== null && ex.expectationGapPct < -8)
    bear.push(`Price already implies more than the street models (expectation gap ${ex.expectationGapPct.toFixed(0)}%).`);

  // The actual analyst-action headlines, quoted.
  const actions = news
    .filter((n) => n.category === "ANALYST_ACTION")
    .slice(0, 5)
    .map((n) => ({ title: n.title, date: n.date.slice(0, 10), url: n.url, sentiment: n.sentiment }));

  const targetMath =
    s.analystTargetPrice !== null && price > 0
      ? `Consensus target $${s.analystTargetPrice.toFixed(2)} = ${pc(s.analystTargetPrice / price - 1, 1)} vs price${
          s.epsEstimateNextYear !== null
            ? ` — equivalent to ${(s.analystTargetPrice / s.epsEstimateNextYear).toFixed(1)}× the street's next-FY EPS of $${s.epsEstimateNextYear.toFixed(2)}`
            : ""
        }.`
      : null;

  return { stance, bullDrivers: bull.slice(0, 5), bearDrivers: bear.slice(0, 4), actions, targetMath };
}
