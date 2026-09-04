import "server-only";
import type {
  EarningsPoint,
  FinancialPeriod,
  KeyMetrics,
  Recommendation,
} from "@/lib/providers/fundamentals";
import type { CompanySnapshot, StatementRow } from "../normalize/company";

/**
 * EODHD → legacy research-stack adapter.
 *
 * The ticker page's research panels (health, key metrics, statements, trends,
 * analyst) were written against Finnhub's shapes. For US symbols those panels
 * must now render EODHD data only (single source of truth); rather than
 * rewriting ten panels, this adapter converts the validated CompanySnapshot
 * into the exact legacy shapes. BIST keeps its original Yahoo/FMP path.
 *
 * Unit conventions matter: Finnhub's metric endpoint reports ratios as
 * PERCENTAGES (grossMarginTTM: 62.3), the normalized snapshot as FRACTIONS
 * (0.623). Conversions are explicit below — this is exactly the kind of unit
 * seam the integrity engine exists to guard, so keep it in one file.
 */

const pct = (v: number | null): number | undefined => (v === null ? undefined : v * 100);
const und = <T,>(v: T | null): T | undefined => (v === null ? undefined : v);

export function toKeyMetrics(s: CompanySnapshot): KeyMetrics {
  const debtToEquity =
    s.totalDebt !== null && s.equity !== null && s.equity > 0
      ? (s.totalDebt / s.equity) * 100
      : undefined;
  return {
    peTTM: und(s.peTtm),
    forwardPE: und(s.forwardPe),
    pegTTM: und(s.peg),
    pbQuarterly: und(s.priceToBook),
    psTTM: und(s.priceToSales),
    evEbitdaTTM: und(s.evToEbitda),
    evRevenueTTM: und(s.evToRevenue),
    enterpriseValue: und(s.enterpriseValue),
    grossMarginTTM: pct(s.grossMarginTtm),
    operatingMarginTTM: pct(s.operatingMarginTtm),
    netProfitMarginTTM: pct(s.netMarginTtm),
    roeTTM: pct(s.roe),
    roaTTM: pct(s.roa),
    revenueGrowthTTMYoy: pct(s.revenueGrowthYoY),
    epsGrowthTTMYoy: pct(s.epsGrowthYoY),
    currentRatioQuarterly: und(s.currentRatio),
    quickRatioQuarterly: und(s.quickRatio),
    "totalDebt/totalEquityQuarterly": debtToEquity,
    bookValuePerShareQuarterly: und(s.bookValuePerShare),
    payoutRatioTTM: pct(s.payoutRatio),
    dividendYieldIndicatedAnnual: pct(s.dividendYield),
  };
}

function toPeriod(r: StatementRow, kind: "quarterly" | "annual"): FinancialPeriod {
  const [y, m] = r.date.split("-").map(Number);
  return {
    year: y ?? 0,
    quarter: kind === "annual" ? 0 : Math.max(1, Math.min(4, Math.ceil((m ?? 3) / 3))),
    endDate: r.date,
    discrete: true, // EODHD quarterly statements are discrete quarters
    revenue: r.revenue,
    costOfRevenue:
      r.costOfRevenue ??
      (r.revenue !== null && r.grossProfit !== null ? r.revenue - r.grossProfit : null),
    grossProfit: r.grossProfit,
    rnd: r.rnd,
    sga: r.sga,
    operatingIncome: r.operatingIncome,
    pretaxIncome: r.pretaxIncome,
    taxExpense: r.taxExpense,
    netIncome: r.netIncome,
    eps: r.eps, // reported diluted EPS mapped from earnings history by period
    dilutedShares: r.sharesOutstanding,
    operatingCashFlow: r.operatingCashFlow,
    capex: r.capex !== null ? -Math.abs(r.capex) : null, // legacy: negative outflow
    freeCashFlow: r.freeCashFlow,
    depreciation: r.depreciation,
    stockComp: r.stockComp,
    dividendsPaid: r.dividendsPaid,
    buybacks: r.buybacks,
    stockIssued: null,
    debtIssued: null,
    debtRepaid: null,
    cash: r.cash,
    shortTermInvestments: null,
    totalAssets: r.totalAssets,
    currentAssets: r.currentAssets,
    currentLiabilities: r.currentLiabilities,
    totalLiabilities:
      r.totalAssets !== null && r.equity !== null ? r.totalAssets - r.equity : null,
    equity: r.equity,
    shortTermDebt: r.shortTermDebt,
    longTermDebt: r.longTermDebt ?? r.totalDebt,
    inventory: r.inventory,
  };
}

export function toFinancialPeriods(s: CompanySnapshot, kind: "quarterly" | "annual"): FinancialPeriod[] {
  const rows = kind === "quarterly" ? s.quarterly : s.annual;
  return rows.map((r) => toPeriod(r, kind));
}

export function toEarningsPoints(s: CompanySnapshot): EarningsPoint[] {
  return s.earningsHistory.map((e) => ({
    period: e.periodEnd,
    actual: e.epsActual,
    estimate: e.epsEstimate,
    surprise:
      e.epsActual !== null && e.epsEstimate !== null ? e.epsActual - e.epsEstimate : null,
    surprisePercent: e.surprisePct,
  }));
}

export function toRecommendations(s: CompanySnapshot): Recommendation[] {
  const c = s.analystCounts;
  if ([c.strongBuy, c.buy, c.hold, c.sell, c.strongSell].every((v) => v === null)) return [];
  return [
    {
      period: new Date().toISOString().slice(0, 7) + "-01",
      strongBuy: c.strongBuy ?? 0,
      buy: c.buy ?? 0,
      hold: c.hold ?? 0,
      sell: c.sell ?? 0,
      strongSell: c.strongSell ?? 0,
    },
  ];
}
