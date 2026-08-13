import type { Facts } from "@/lib/scanner/metrics";
import type { Sector } from "@/lib/scanner/types";

/**
 * The metric registry the custom screener filters on.
 *
 * One entry per filterable field, carrying its label, unit, group and whether
 * a higher reading is better. The screener builds its whole UI from this, so
 * adding a metric is one entry rather than a change in four files.
 *
 * `appliesTo` is how banks stay out of industrial logic: a metric absent from
 * a company's sector list cannot be filtered on for that company, and a bank
 * therefore never fails an EV/EBITDA test it should never have been given.
 */

export type MetricGroup =
  | "Valuation"
  | "Growth"
  | "Profitability"
  | "Balance Sheet"
  | "Technical"
  | "Bank"
  | "Score";

export type Unit = "pct" | "x" | "money" | "num";

/** Extra fields the screener computes beyond the shared scanner facts. */
export interface ScreenerExtras {
  /** Not in the shared scanner facts, so it lives here. */
  peg: number | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  evEbit: number | null;
  ebitdaMargin: number | null;
  earningsYield: number | null;
  dividendYield: number | null;
  netDebtToEbitda: number | null;
  cashToDebt: number | null;
  quickRatio: number | null;
  netDebt: number | null;
  cash: number | null;
  rsi: number | null;
  fromHigh52: number | null;
  fromLow52: number | null;
  from20dma: number | null;
  from50dma: number | null;
  from200dma: number | null;
  returnYtd: number | null;
  return1d: number | null;
  return1w: number | null;
  relativeStrength: number | null;
  avgDollarVolume: number | null;
  qualityScore: number | null;
  opportunityScore: number | null;
  fairValueUpside: number | null;
  bookValueGrowthYoy: number | null;
  revenueGrowthQoq: number | null;
  epsGrowthQoq: number | null;
  operatingIncomeGrowth: number | null;
  fcfGrowth: number | null;
}

export type Row = Facts & ScreenerExtras;
export type MetricKey = keyof Omit<Row, "symbol">;

export interface MetricDef {
  key: MetricKey;
  label: string;
  group: MetricGroup;
  unit: Unit;
  higherIsBetter: boolean | null;
  /**
   * Sectors this metric is meaningful for. Undefined means all of them.
   * A bank has no `evEbitda` entry, so that filter simply never applies to it.
   */
  appliesTo?: Sector[];
  /** Excluded for these sectors even though it applies broadly. */
  notFor?: Sector[];
}

const BANKS: Sector[] = ["Banks", "Financials"];

export const METRICS: MetricDef[] = [
  // ------------------------------------------------------------- valuation
  { key: "marketCap", label: "Market Cap", group: "Valuation", unit: "money", higherIsBetter: null },
  { key: "enterpriseValue", label: "Enterprise Value", group: "Valuation", unit: "money", higherIsBetter: null, notFor: BANKS },
  { key: "pe", label: "P/E", group: "Valuation", unit: "x", higherIsBetter: false },
  { key: "forwardPe", label: "Forward P/E", group: "Valuation", unit: "x", higherIsBetter: false },
  { key: "peg", label: "PEG", group: "Valuation", unit: "x", higherIsBetter: false },
  { key: "ps", label: "P/S", group: "Valuation", unit: "x", higherIsBetter: false, notFor: BANKS },
  { key: "pb", label: "P/B", group: "Valuation", unit: "x", higherIsBetter: false },
  { key: "evSales", label: "EV/Revenue", group: "Valuation", unit: "x", higherIsBetter: false, notFor: BANKS },
  { key: "evEbitda", label: "EV/EBITDA", group: "Valuation", unit: "x", higherIsBetter: false, notFor: BANKS },
  { key: "evEbit", label: "EV/EBIT", group: "Valuation", unit: "x", higherIsBetter: false, notFor: BANKS },
  { key: "pFcf", label: "P/FCF per share", group: "Valuation", unit: "x", higherIsBetter: false, notFor: BANKS },
  { key: "fcfYield", label: "FCF Yield", group: "Valuation", unit: "pct", higherIsBetter: true, notFor: BANKS },
  { key: "earningsYield", label: "Earnings Yield", group: "Valuation", unit: "pct", higherIsBetter: true },
  { key: "dividendYield", label: "Dividend Yield", group: "Valuation", unit: "pct", higherIsBetter: true },
  { key: "fairValueUpside", label: "Fair Value Upside", group: "Valuation", unit: "pct", higherIsBetter: true },

  // ---------------------------------------------------------------- growth
  { key: "revenueGrowth", label: "Revenue Growth YoY", group: "Growth", unit: "pct", higherIsBetter: true },
  { key: "revenueGrowthQoq", label: "Revenue Growth QoQ", group: "Growth", unit: "pct", higherIsBetter: true },
  { key: "epsGrowth", label: "EPS Growth YoY", group: "Growth", unit: "pct", higherIsBetter: true },
  { key: "epsGrowthQoq", label: "EPS Growth QoQ", group: "Growth", unit: "pct", higherIsBetter: true },
  { key: "fcfGrowth", label: "FCF Growth YoY", group: "Growth", unit: "pct", higherIsBetter: true, notFor: BANKS },
  { key: "operatingIncomeGrowth", label: "Operating Income Growth", group: "Growth", unit: "pct", higherIsBetter: true },
  { key: "bookValueGrowthYoy", label: "Book Value Growth", group: "Growth", unit: "pct", higherIsBetter: true },

  // --------------------------------------------------------- profitability
  { key: "grossMargin", label: "Gross Margin", group: "Profitability", unit: "pct", higherIsBetter: true, notFor: BANKS },
  { key: "operatingMargin", label: "Operating Margin", group: "Profitability", unit: "pct", higherIsBetter: true },
  { key: "netMargin", label: "Net Margin", group: "Profitability", unit: "pct", higherIsBetter: true },
  { key: "ebitdaMargin", label: "EBITDA Margin", group: "Profitability", unit: "pct", higherIsBetter: true, notFor: BANKS },
  { key: "fcfMargin", label: "FCF Margin", group: "Profitability", unit: "pct", higherIsBetter: true, notFor: BANKS },
  { key: "roe", label: "ROE", group: "Profitability", unit: "pct", higherIsBetter: true },
  { key: "roa", label: "ROA", group: "Profitability", unit: "pct", higherIsBetter: true },
  { key: "roic", label: "ROIC", group: "Profitability", unit: "pct", higherIsBetter: true, notFor: BANKS },

  // --------------------------------------------------------- balance sheet
  { key: "cash", label: "Cash", group: "Balance Sheet", unit: "money", higherIsBetter: true },
  { key: "netDebt", label: "Net Debt", group: "Balance Sheet", unit: "money", higherIsBetter: false, notFor: BANKS },
  { key: "netCashToAssets", label: "Net Cash / Assets", group: "Balance Sheet", unit: "pct", higherIsBetter: true, notFor: BANKS },
  { key: "debtToEquity", label: "Debt / Equity", group: "Balance Sheet", unit: "pct", higherIsBetter: false, notFor: BANKS },
  { key: "netDebtToEbitda", label: "Net Debt / EBITDA", group: "Balance Sheet", unit: "x", higherIsBetter: false, notFor: BANKS },
  { key: "currentRatio", label: "Current Ratio", group: "Balance Sheet", unit: "x", higherIsBetter: true, notFor: BANKS },
  { key: "quickRatio", label: "Quick Ratio", group: "Balance Sheet", unit: "x", higherIsBetter: true, notFor: BANKS },
  { key: "cashToDebt", label: "Cash / Debt", group: "Balance Sheet", unit: "x", higherIsBetter: true, notFor: BANKS },
  { key: "interestCover", label: "Interest Cover", group: "Balance Sheet", unit: "x", higherIsBetter: true, notFor: BANKS },

  // ------------------------------------------------------------------ bank
  { key: "equityToAssets", label: "Equity / Assets", group: "Bank", unit: "pct", higherIsBetter: true, appliesTo: BANKS },

  // ------------------------------------------------------------- technical
  { key: "return1d", label: "1D Return", group: "Technical", unit: "pct", higherIsBetter: true },
  { key: "return1w", label: "1W Return", group: "Technical", unit: "pct", higherIsBetter: true },
  { key: "return3m", label: "3M Return", group: "Technical", unit: "pct", higherIsBetter: true },
  { key: "return6m", label: "6M Return", group: "Technical", unit: "pct", higherIsBetter: true },
  { key: "return12m", label: "1Y Return", group: "Technical", unit: "pct", higherIsBetter: true },
  { key: "returnYtd", label: "YTD Return", group: "Technical", unit: "pct", higherIsBetter: true },
  { key: "from20dma", label: "vs 20DMA", group: "Technical", unit: "pct", higherIsBetter: null },
  { key: "from50dma", label: "vs 50DMA", group: "Technical", unit: "pct", higherIsBetter: null },
  { key: "from200dma", label: "vs 200DMA", group: "Technical", unit: "pct", higherIsBetter: null },
  { key: "fromHigh52", label: "vs 52W High", group: "Technical", unit: "pct", higherIsBetter: null },
  { key: "fromLow52", label: "vs 52W Low", group: "Technical", unit: "pct", higherIsBetter: null },
  { key: "rsi", label: "RSI(14)", group: "Technical", unit: "num", higherIsBetter: null },
  { key: "relativeStrength", label: "Relative Strength vs Benchmark", group: "Technical", unit: "pct", higherIsBetter: true },
  { key: "volatility", label: "Volatility", group: "Technical", unit: "pct", higherIsBetter: false },
  { key: "beta", label: "Beta", group: "Technical", unit: "num", higherIsBetter: null },
  { key: "avgDollarVolume", label: "Avg Daily Value Traded", group: "Technical", unit: "money", higherIsBetter: true },

  // ----------------------------------------------------------------- score
  { key: "qualityScore", label: "Quality Score", group: "Score", unit: "num", higherIsBetter: true },
  { key: "opportunityScore", label: "Opportunity Score", group: "Score", unit: "num", higherIsBetter: true },
  { key: "analystScore", label: "Analyst Consensus", group: "Score", unit: "num", higherIsBetter: true },
];

export const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));

export const METRIC_GROUPS: MetricGroup[] = [
  "Valuation",
  "Growth",
  "Profitability",
  "Balance Sheet",
  "Bank",
  "Technical",
  "Score",
];

/**
 * Does this metric mean anything for this sector?
 *
 * The gate that keeps banks out of industrial logic. A filter on a metric that
 * does not apply excludes the company from that criterion rather than failing
 * it — see `evaluate` in `filter.ts`.
 */
export function metricApplies(def: MetricDef, sector: Sector): boolean {
  if (def.appliesTo && !def.appliesTo.includes(sector)) return false;
  if (def.notFor && def.notFor.includes(sector)) return false;
  return true;
}

export const formatMetric = (v: number | null, unit: Unit, symbol = "$"): string => {
  if (v === null || !Number.isFinite(v)) return "N/A";
  switch (unit) {
    case "pct":
      return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
    case "x":
      return `${v.toFixed(2)}×`;
    case "money": {
      const a = Math.abs(v);
      const s = v < 0 ? "-" : "";
      if (a >= 1e12) return `${s}${symbol}${(a / 1e12).toFixed(2)}T`;
      if (a >= 1e9) return `${s}${symbol}${(a / 1e9).toFixed(2)}B`;
      if (a >= 1e6) return `${s}${symbol}${(a / 1e6).toFixed(1)}M`;
      if (a >= 1e3) return `${s}${symbol}${(a / 1e3).toFixed(1)}K`;
      return `${s}${symbol}${a.toFixed(0)}`;
    }
    default:
      return v.toFixed(2);
  }
};
