import type { CompanySnapshot } from "@/lib/data/normalize/company";
import type { ClassifiedNews } from "./news-classify";
import type { FinancialStory } from "./financial-story";

/**
 * COMPANY PLAN — "what is this company doing and where is it going", derived
 * deterministically from CITED sources: classified company news (each line
 * carries its headline + date), street forward estimates, and the reported
 * statements. Nothing is invented: a company with no initiative headlines gets
 * an honest empty section, never boilerplate strategy prose.
 */

export interface PlanItem {
  text: string;
  source: { title: string; date: string; url: string } | null;
}

export interface CompanyPlan {
  growthOutlook: string[]; // street numbers, revenue trajectory
  initiatives: PlanItem[]; // product / capex / M&A / contracts — news-cited
  capitalAllocation: string[]; // buybacks / dividends / capex from filings
  watchouts: PlanItem[]; // regulatory / legal / supply news-cited
}

const money = (v: number) =>
  Math.abs(v) >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`;

export function buildCompanyPlan(
  s: CompanySnapshot,
  news: ClassifiedNews[],
  story: FinancialStory,
): CompanyPlan {
  const growthOutlook: string[] = [];
  const initiatives: PlanItem[] = [];
  const capitalAllocation: string[] = [];
  const watchouts: PlanItem[] = [];

  // ---- Growth outlook: only numbers the street or the filings actually give.
  if (s.revenueGrowthYoY !== null)
    growthOutlook.push(
      `Reported: revenue ${s.revenueGrowthYoY >= 0 ? "growing" : "shrinking"} ${(s.revenueGrowthYoY * 100).toFixed(1)}% YoY (TTM), trend ${story.revenue.toLowerCase()}.`,
    );
  const today = new Date().toISOString().slice(0, 10);
  const future = s.forwardEstimates.filter((e) => e.periodEnd > today && e.revenueAvg !== null);
  if (future.length >= 1 && s.revenueTtm !== null && s.revenueTtm > 0) {
    const horizon = future[future.length - 1]!;
    growthOutlook.push(
      `Street path: revenue estimate ${money(horizon.revenueAvg!)} for the period ending ${horizon.periodEnd}${horizon.analystCount ? ` (${horizon.analystCount} analysts)` : ""}.`,
    );
  }
  if (s.epsEstimateNextYear !== null && s.epsTtm !== null && s.epsTtm > 0) {
    const g = (s.epsEstimateNextYear / s.epsTtm - 1) * 100;
    growthOutlook.push(
      `Street models EPS $${s.epsEstimateNextYear.toFixed(2)} next FY vs $${s.epsTtm.toFixed(2)} trailing (${g >= 0 ? "+" : ""}${g.toFixed(0)}%).`,
    );
  }

  // ---- Initiatives: strictly news-cited, grouped by what the company is DOING.
  const initiativeCats = new Set(["PRODUCT", "CAPEX", "M_A", "CONTRACT_ORDER"]);
  const catLabel: Record<string, string> = {
    PRODUCT: "Product",
    CAPEX: "Investment",
    M_A: "M&A",
    CONTRACT_ORDER: "Commercial",
  };
  for (const n of news.filter((n) => initiativeCats.has(n.category)).slice(0, 6)) {
    initiatives.push({
      text: `${catLabel[n.category]}: ${n.title}`,
      source: { title: n.title, date: n.date.slice(0, 10), url: n.url },
    });
  }

  // ---- Capital allocation: straight from the cash-flow statements (TTM).
  const q4 = s.quarterly.slice(0, 4);
  const sum = (pick: (r: (typeof q4)[number]) => number | null): number | null => {
    if (q4.length < 4) return null;
    let t = 0;
    for (const r of q4) {
      const v = pick(r);
      if (v === null) return null;
      t += v;
    }
    return t;
  };
  const buybacks = sum((r) => r.buybacks);
  const dividends = sum((r) => r.dividendsPaid);
  const capex = sum((r) => r.capex);
  const rnd = sum((r) => r.rnd);
  if (buybacks !== null && buybacks < 0)
    capitalAllocation.push(`Buying back stock: ${money(Math.abs(buybacks))} net repurchases over the last 4 quarters.`);
  if (dividends !== null && dividends < 0)
    capitalAllocation.push(`Paying dividends: ${money(Math.abs(dividends))} TTM${s.dividendYield !== null ? ` (yield ${(s.dividendYield * 100).toFixed(2)}%)` : ""}.`);
  if (capex !== null && s.revenueTtm !== null && s.revenueTtm > 0)
    capitalAllocation.push(`Capex ${money(capex)} TTM (${((capex / s.revenueTtm) * 100).toFixed(1)}% of revenue).`);
  if (rnd !== null && s.revenueTtm !== null && s.revenueTtm > 0)
    capitalAllocation.push(`R&D ${money(rnd)} TTM (${((rnd / s.revenueTtm) * 100).toFixed(1)}% of revenue).`);
  if (story.debt === "NET_CASH") capitalAllocation.push("Runs a net-cash balance sheet.");

  // ---- Watchouts: regulatory/legal/supply headlines, cited.
  const riskCats = new Set(["REGULATION", "LAWSUIT", "SUPPLY_CHAIN"]);
  for (const n of news.filter((n) => riskCats.has(n.category)).slice(0, 4)) {
    watchouts.push({
      text: n.title,
      source: { title: n.title, date: n.date.slice(0, 10), url: n.url },
    });
  }

  return { growthOutlook, initiatives, capitalAllocation, watchouts };
}
