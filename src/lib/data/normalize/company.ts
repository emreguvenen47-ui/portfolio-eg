/**
 * Provider-independent company fundamentals.
 *
 * The application schema never carries provider names in field names
 * (`pe_ttm`, not `eodhd_pe`); provenance lives in `meta`. Every numeric field
 * is `number | null`, and null ALWAYS means "not available" — never zero.
 */

export interface DataMeta {
  source: "eodhd" | "yahoo" | "finnhub" | "fmp" | "derived";
  fetchedAt: string; // ISO
  /** Reporting period the newest statement covers, e.g. "2026-07-31 (Q)". */
  period: string | null;
  currency: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "INVALID";
  issues: string[];
  /**
   * PERIOD-BASED freshness (spec §19–21): "recently fetched" is not
   * "financially current". `dataDelayed` is true when the provider's own
   * earnings history shows a REPORTED quarter that the normalized statements
   * do not contain yet — the UI must label the statements as the older
   * period and surface the newer headline result separately, never merge.
   */
  latestStatementPeriod: string | null;
  latestReportedPeriod: string | null;
  latestReportDate: string | null;
  dataDelayed: boolean;
}

export interface StatementRow {
  /** Period end date, ISO yyyy-mm-dd. */
  date: string;
  filingDate: string | null;
  revenue: number | null;
  costOfRevenue: number | null;
  grossProfit: number | null;
  rnd: number | null;
  sga: number | null;
  operatingIncome: number | null;
  /** Reported EBIT line when present (falls back to operating income in ratios). */
  ebit: number | null;
  ebitda: number | null;
  pretaxIncome: number | null;
  taxExpense: number | null;
  netIncome: number | null;
  /** Diluted EPS actually reported for this quarter (from earnings history). */
  eps: number | null;
  /** Balance sheet. */
  totalAssets: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  inventory: number | null;
  shortTermDebt: number | null;
  longTermDebt: number | null;
  totalDebt: number | null;
  cash: number | null;
  equity: number | null;
  sharesOutstanding: number | null;
  /** Cash flow. */
  operatingCashFlow: number | null;
  capex: number | null;
  freeCashFlow: number | null;
  depreciation: number | null;
  stockComp: number | null;
  /** Negative = cash paid out (outflow convention, matches legacy shapes). */
  dividendsPaid: number | null;
  /** Net share issuance/repurchase; negative = net buyback. */
  buybacks: number | null;
}

export interface CompanyIdentity {
  symbol: string;
  name: string | null;
  exchange: string | null;
  currency: string | null;
  sector: string | null;
  industry: string | null;
  description: string | null;
  country: string | null;
  employees: number | null;
  /** GicSector-style hint used by sector-aware engines. */
  companyType:
    | "BANK"
    | "INSURANCE"
    | "REIT"
    | "SEMICONDUCTOR"
    | "SAAS"
    | "ENERGY"
    | "UTILITY"
    | "CONSUMER"
    | "INDUSTRIAL"
    | "BIOTECH"
    | "GENERAL";
}

export interface CompanySnapshot {
  identity: CompanyIdentity;

  // Size and shares
  marketCap: number | null;
  sharesOutstanding: number | null;
  floatShares: number | null;

  // Valuation multiples (TTM unless stated)
  peTtm: number | null;
  forwardPe: number | null;
  peg: number | null;
  priceToSales: number | null;
  priceToBook: number | null;
  enterpriseValue: number | null;
  evToEbitda: number | null;
  evToRevenue: number | null;
  fcfYield: number | null; // derived: fcf_ttm / market_cap

  // Per share / profitability
  epsTtm: number | null;
  bookValuePerShare: number | null;
  dividendYield: number | null;
  payoutRatio: number | null;
  grossMarginTtm: number | null;
  operatingMarginTtm: number | null;
  netMarginTtm: number | null;
  fcfMargin: number | null; // derived: fcf_ttm / revenue_ttm
  roe: number | null;
  roa: number | null;
  /**
   * Return on invested capital, computed from reported statements only:
   * NOPAT_TTM (EBIT × (1 − effective tax rate)) over AVERAGE invested capital
   * (equity + total debt − cash, averaged between the latest quarter and the
   * same quarter one year ago when both are available). Fraction, not percent.
   */
  roic: number | null;
  /** Return on capital employed: EBIT_TTM / avg(totalAssets − currentLiabilities). */
  roce: number | null;

  // TTM absolutes (derived from quarterly statements)
  revenueTtm: number | null;
  netIncomeTtm: number | null;
  ebitdaTtm: number | null;
  operatingCashFlowTtm: number | null;
  capexTtm: number | null;
  freeCashFlowTtm: number | null;

  // Balance snapshot (most recent quarter)
  cash: number | null;
  totalDebt: number | null;
  netDebt: number | null;
  equity: number | null;
  netDebtToEbitda: number | null;
  debtToEquity: number | null; // totalDebt / equity, null when equity ≤ 0
  currentRatio: number | null;
  quickRatio: number | null; // (currentAssets − inventory) / currentLiabilities

  // Growth (derived)
  revenueGrowthYoY: number | null;
  epsGrowthYoY: number | null;
  revenueCagr3y: number | null;
  epsCagr3y: number | null;

  // Analyst / expectations
  analystRating: number | null; // 1..5
  analystTargetPrice: number | null;
  analystCounts: {
    strongBuy: number | null;
    buy: number | null;
    hold: number | null;
    sell: number | null;
    strongSell: number | null;
  };
  epsEstimateCurrentYear: number | null;
  epsEstimateNextYear: number | null;
  forwardEstimates: Array<{
    periodEnd: string;
    epsAvg: number | null;
    epsLow: number | null;
    epsHigh: number | null;
    revenueAvg: number | null;
    analystCount: number | null;
  }>;

  // Ownership
  insiderOwnershipPct: number | null;
  institutionalOwnershipPct: number | null;

  // Statements (newest first)
  quarterly: StatementRow[];
  annual: StatementRow[];

  // Earnings surprise history (newest first)
  earningsHistory: Array<{
    reportDate: string;
    periodEnd: string;
    epsActual: number | null;
    epsEstimate: number | null;
    surprisePct: number | null;
  }>;

  meta: DataMeta;
}

/** Classify company type from sector/industry text. Deterministic. */
export function classifyCompany(
  sector: string | null,
  industry: string | null,
): CompanyIdentity["companyType"] {
  const s = (sector ?? "").toLowerCase();
  const i = (industry ?? "").toLowerCase();
  if (i.includes("bank")) return "BANK";
  if (i.includes("insurance")) return "INSURANCE";
  if (i.includes("reit") || s.includes("real estate")) return "REIT";
  if (i.includes("semiconductor")) return "SEMICONDUCTOR";
  if (i.includes("software") || i.includes("internet content")) return "SAAS";
  if (s.includes("energy") || i.includes("oil")) return "ENERGY";
  if (s.includes("utilities")) return "UTILITY";
  if (i.includes("biotech")) return "BIOTECH";
  if (s.includes("consumer")) return "CONSUMER";
  if (s.includes("industrial")) return "INDUSTRIAL";
  return "GENERAL";
}

/** Sum of the newest `n` values, or null unless ALL of them are present. */
export function sumComplete(rows: Array<number | null>, n: number): number | null {
  if (rows.length < n) return null;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const v = rows[i];
    if (v === null || v === undefined) return null;
    total += v;
  }
  return total;
}

/** YoY growth from a series of same-period values (newest first). */
export function yoyGrowth(newest: number | null, yearAgo: number | null): number | null {
  if (newest === null || yearAgo === null) return null;
  if (yearAgo === 0) return null;
  // A negative base makes growth-% meaningless; report null, not a sign trick.
  if (yearAgo < 0) return null;
  return (newest - yearAgo) / yearAgo;
}

/** n-year CAGR between two positive values. */
export function cagr(latest: number | null, past: number | null, years: number): number | null {
  if (latest === null || past === null) return null;
  if (past <= 0 || latest <= 0) return null;
  return Math.pow(latest / past, 1 / years) - 1;
}
